// Wire formats for the two WebRTC data channels.
//
// 'pose' (unordered, no retransmits) carries binary packets:
//   u8 version | u8 flags | u16 seq | f64 captureTime (phone clock, ms) | u8 count |
//   count x (u16 x | u16 y | u8 visibility)       -- all little-endian
// Coordinates are normalized image coordinates quantized over [-0.5, 1.5].
//
// 'ctl' (reliable, ordered) carries small JSON messages (CtlMessage).

import type { Landmark } from './landmarks';

export const POSE_PACKET_VERSION = 1;
const HEADER_BYTES = 13;
const LANDMARK_BYTES = 5;
const Q_MIN = -0.5;
const Q_RANGE = 2;
const Q_MAX_INT = 65535;

export interface PosePacket {
  seq: number;
  captureTime: number;
  landmarks: Landmark[] | null;
}

function quantize(v: number): number {
  const q = Math.round(((v - Q_MIN) / Q_RANGE) * Q_MAX_INT);
  return q < 0 ? 0 : q > Q_MAX_INT ? Q_MAX_INT : q;
}

function dequantize(q: number): number {
  return (q / Q_MAX_INT) * Q_RANGE + Q_MIN;
}

export function encodePose(seq: number, captureTime: number, landmarks: ReadonlyArray<Landmark> | null): ArrayBuffer {
  const count = landmarks ? Math.min(landmarks.length, 255) : 0;
  const buf = new ArrayBuffer(HEADER_BYTES + count * LANDMARK_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, POSE_PACKET_VERSION);
  view.setUint8(1, count > 0 ? 1 : 0);
  view.setUint16(2, seq & 0xffff, true);
  view.setFloat64(4, captureTime, true);
  view.setUint8(12, count);
  for (let i = 0; i < count; i++) {
    const lm = (landmarks as ReadonlyArray<Landmark>)[i];
    const off = HEADER_BYTES + i * LANDMARK_BYTES;
    view.setUint16(off, quantize(lm.x), true);
    view.setUint16(off + 2, quantize(lm.y), true);
    const vis = Math.round((lm.visibility > 0 ? (lm.visibility < 1 ? lm.visibility : 1) : 0) * 255);
    view.setUint8(off + 4, vis);
  }
  return buf;
}

export function decodePose(buf: ArrayBuffer): PosePacket | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== POSE_PACKET_VERSION) return null;
  const count = view.getUint8(12);
  if (buf.byteLength !== HEADER_BYTES + count * LANDMARK_BYTES) return null;
  const captureTime = view.getFloat64(4, true);
  if (!isFinite(captureTime)) return null;
  let landmarks: Landmark[] | null = null;
  if (count > 0) {
    landmarks = [];
    for (let i = 0; i < count; i++) {
      const off = HEADER_BYTES + i * LANDMARK_BYTES;
      landmarks.push({
        x: dequantize(view.getUint16(off, true)),
        y: dequantize(view.getUint16(off + 2, true)),
        visibility: view.getUint8(off + 4) / 255,
      });
    }
  }
  return { seq: view.getUint16(2, true), captureTime, landmarks };
}

export type CtlMessage =
  | { t: 'hello'; v: 1; width: number; height: number; facing: 'user' | 'environment'; source: 'mediapipe' | 'synthetic' }
  | { t: 'ping'; id: number; tv: number }
  | { t: 'pong'; id: number; tv: number; ph: number }
  | { t: 'stats'; fps: number; inferMs: number; model?: 'lite' | 'full' }
  | { t: 'lang'; lang: 'he' | 'ar' | 'en' }
  | { t: 'bye' };

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

export function parseCtl(raw: unknown): CtlMessage | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    m = parsed as Record<string, unknown>;
  } catch (_e) {
    return null;
  }
  switch (m.t) {
    case 'hello':
      if (m.v !== 1 || !isNum(m.width) || !isNum(m.height)) return null;
      if (m.facing !== 'user' && m.facing !== 'environment') return null;
      if (m.source !== 'mediapipe' && m.source !== 'synthetic') return null;
      return { t: 'hello', v: 1, width: m.width, height: m.height, facing: m.facing, source: m.source };
    case 'ping':
      return isNum(m.id) && isNum(m.tv) ? { t: 'ping', id: m.id, tv: m.tv } : null;
    case 'pong':
      return isNum(m.id) && isNum(m.tv) && isNum(m.ph) ? { t: 'pong', id: m.id, tv: m.tv, ph: m.ph } : null;
    case 'stats': {
      if (!isNum(m.fps) || !isNum(m.inferMs)) return null;
      const model = m.model === 'lite' || m.model === 'full' ? m.model : undefined;
      return model ? { t: 'stats', fps: m.fps, inferMs: m.inferMs, model } : { t: 'stats', fps: m.fps, inferMs: m.inferMs };
    }
    case 'lang':
      return m.lang === 'he' || m.lang === 'ar' || m.lang === 'en' ? { t: 'lang', lang: m.lang } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}
