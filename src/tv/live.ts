// Live view on the TV: the phone's camera video (mirrored) with the tracked body
// drawn on top, plus connection stats. This is the M1 "does this TV work?" test.

import { ClockSync } from '../shared/clock';
import { h, mount } from '../shared/dom';
import { BODY_CONNECTIONS, HAND_POINTS, LM, type Landmark } from '../shared/landmarks';
import { containRect, toScreen, type Rect } from '../shared/mapping';
import { decodePose, parseCtl } from '../shared/protocol';
import { getSelectedPair } from '../shared/rtc';
import { PoseTimeline } from '../shared/sync';
import type { Receiver } from './receiver';

export type EndReason = 'stopped' | 'lost';

export interface LiveDebug {
  videoWidth: number;
  videoHeight: number;
  videoFps: number;
  poseHz: number;
  codec: string;
  delayMs: number;
  clockRttMs: number | null;
  lan: boolean | null;
  works: boolean;
}

declare global {
  interface Window {
    __tvDebug?: LiveDebug;
  }
}

const VISIBLE = 0.5;
/** Phone capture + encode + TV render time not covered by WebRTC stats (rough, tuned on devices later). */
const UNMEASURED_DELAY_MS = 60;
const OFFSET_KEY = 'tv.syncOffsetMs';

interface StatsSnapshot {
  at: number;
  framesDecoded: number;
  jitterDelay: number;
  jitterCount: number;
  decodeTime: number;
}

function readOffset(): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY));
    return isFinite(v) ? v : 0;
  } catch (_e) {
    return 0;
  }
}

function writeOffset(v: number): void {
  try {
    localStorage.setItem(OFFSET_KEY, String(v));
  } catch (_e) {
    // storage unavailable
  }
}

export function startLive(root: HTMLElement, rx: Receiver, lan: boolean | null, onEnd: (reason: EndReason) => void): () => void {
  const video = h('video', { class: 'live-video', testid: 'live-video' });
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  const canvas = h('canvas', { class: 'live-canvas' });
  const chip = h('div', { class: 'chip', testid: 'live-status', text: 'Connected — waiting for video…' });
  const hud = h('pre', { class: 'hud hidden', testid: 'live-hud' });
  const lostBanner = h('div', { class: 'banner hidden', text: 'Phone connection lost — waiting…' });
  const hint = h('div', { class: 'hint', text: 'Press OK for details' });
  mount(root, h('div', { class: 'live', testid: 'live' }, video, canvas, chip, lostBanner, hud, hint));

  const ctx = canvas.getContext('2d');
  const timeline = new PoseTimeline();
  const clock = new ClockSync();
  let disposed = false;
  let userOffset = readOffset();
  let estimateMs = 150;
  let videoFps = 0;
  let codec = '?';
  let phoneFps = 0;
  let phoneInferMs = 0;
  let phoneSource = '?';
  let rttMs: number | null = null;
  let posePackets = 0;
  let poseWithBody = 0;
  let poseHz = 0;
  let lastHzAt = performance.now();
  let rvfcFrames = 0;
  let rvfcDelayMs: number | null = null;
  let works = false;
  let goodSeconds = 0;
  let noVideoSeconds = 0;
  let prevStats: StatsSnapshot | null = null;
  let lostTimer: ReturnType<typeof setTimeout> | null = null;

  const end = (reason: EndReason) => {
    if (disposed) return;
    dispose();
    onEnd(reason);
  };

  const attach = (stream: MediaStream) => {
    video.srcObject = stream;
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  };
  if (rx.stream) attach(rx.stream);
  rx.onStream = attach;

  // ---- data channels ----
  rx.pose.onmessage = (e: MessageEvent) => {
    const pkt = e.data instanceof ArrayBuffer ? decodePose(e.data) : null;
    if (!pkt) return;
    posePackets++;
    if (pkt.landmarks) poseWithBody++;
    const t = clock.toTv(pkt.captureTime);
    if (t !== null) timeline.push({ t, landmarks: pkt.landmarks });
  };

  rx.ctl.onmessage = (e: MessageEvent) => {
    const msg = parseCtl(e.data);
    if (!msg) return;
    if (msg.t === 'pong') clock.add(msg.tv, msg.ph, performance.now());
    else if (msg.t === 'stats') {
      phoneFps = msg.fps;
      phoneInferMs = msg.inferMs;
    } else if (msg.t === 'hello') phoneSource = msg.source;
    else if (msg.t === 'bye') end('stopped');
  };

  let pingId = 0;
  const ping = () => rx.sendCtl({ t: 'ping', id: ++pingId, tv: performance.now() });
  let pingTimer = setInterval(() => {
    ping();
    if (pingId >= 5) {
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, 2000);
    }
  }, 200);

  // ---- connection state ----
  const onIce = () => {
    const s = rx.pc.iceConnectionState;
    if (s === 'failed' || s === 'closed') end('lost');
    else if (s === 'disconnected') {
      lostBanner.className = 'banner';
      if (!lostTimer) lostTimer = setTimeout(() => end('lost'), 10000);
    } else if (s === 'connected' || s === 'completed') {
      lostBanner.className = 'banner hidden';
      if (lostTimer) clearTimeout(lostTimer);
      lostTimer = null;
    }
  };
  rx.pc.addEventListener('iceconnectionstatechange', onIce);

  // ---- frame timing (optional API) ----
  type FrameCb = (now: number, meta: { captureTime?: number }) => void;
  const vfc = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCb) => number };
  if (typeof vfc.requestVideoFrameCallback === 'function') {
    const onFrame: FrameCb = (now, meta) => {
      if (disposed) return;
      rvfcFrames++;
      if (typeof meta.captureTime === 'number' && meta.captureTime > 0) rvfcDelayMs = now - meta.captureTime;
      vfc.requestVideoFrameCallback!(onFrame);
    };
    vfc.requestVideoFrameCallback(onFrame);
  }

  // ---- stats (1 Hz) ----
  const statsTimer = setInterval(() => {
    void collectStats();
  }, 1000);

  async function collectStats(): Promise<void> {
    let report: RTCStatsReport;
    try {
      report = await rx.pc.getStats();
    } catch (_e) {
      return;
    }
    if (disposed) return;
    const byId: Record<string, Record<string, unknown>> = {};
    const all: Record<string, unknown>[] = [];
    report.forEach((r: Record<string, unknown>) => {
      byId[String(r.id)] = r;
      all.push(r);
    });
    const inbound = all.filter((r) => r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video'))[0];
    const now = performance.now();
    if (inbound) {
      const s = inbound;
      const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : 0);
      const snap: StatsSnapshot = {
        at: now,
        framesDecoded: num('framesDecoded'),
        jitterDelay: num('jitterBufferDelay'),
        jitterCount: num('jitterBufferEmittedCount'),
        decodeTime: num('totalDecodeTime'),
      };
      if (prevStats) {
        const dt = (snap.at - prevStats.at) / 1000;
        const frames = snap.framesDecoded - prevStats.framesDecoded;
        videoFps = dt > 0 ? frames / dt : 0;
        const jc = snap.jitterCount - prevStats.jitterCount;
        const jitterMs = jc > 0 ? ((snap.jitterDelay - prevStats.jitterDelay) / jc) * 1000 : 0;
        const decodeMs = frames > 0 ? ((snap.decodeTime - prevStats.decodeTime) / frames) * 1000 : 0;
        estimateMs = jitterMs + decodeMs + (rttMs !== null ? rttMs / 2 : 5) + UNMEASURED_DELAY_MS;
      }
      prevStats = snap;
      const c = typeof s.codecId === 'string' ? byId[s.codecId] : undefined;
      if (c && typeof c.mimeType === 'string') codec = c.mimeType.replace('video/', '');
    }
    try {
      const pair = await getSelectedPair(rx.pc);
      if (pair && pair.rttMs !== null) rttMs = pair.rttMs;
    } catch (_e) {
      // stats unavailable
    }

    const elapsed = (now - lastHzAt) / 1000;
    poseHz = elapsed > 0 ? poseWithBody / elapsed : 0;
    const packetHz = elapsed > 0 ? posePackets / elapsed : 0;
    posePackets = 0;
    poseWithBody = 0;
    lastHzAt = now;

    // The TV passes when video plays and the data channel delivers; body tracking
    // speed depends on the phone and the scene, so it is reported separately.
    const hasVideo = video.videoWidth > 0 && videoFps > 5;
    if (hasVideo && packetHz > 0) goodSeconds++;
    else goodSeconds = 0;
    if (goodSeconds >= 2) works = true;
    noVideoSeconds = hasVideo ? 0 : noVideoSeconds + 1;

    if (works) {
      let body: string;
      if (poseHz >= 10) body = 'Body ' + Math.round(poseHz) + '/s';
      else if (packetHz >= 10) body = 'Step back so the camera sees your whole body';
      else body = 'Body tracking is slow on the phone (' + packetHz.toFixed(0) + '/s)';
      chip.textContent = '✅ This TV works!  Video ' + Math.round(videoFps) + ' fps · ' + body;
      chip.className = 'chip ok';
    } else if (noVideoSeconds >= 10) {
      chip.textContent = '⚠️ Connected, but no video is showing. This TV may not support it.';
      chip.className = 'chip warn';
    }

    hud.textContent = [
      'video     ' + video.videoWidth + 'x' + video.videoHeight + ' @ ' + videoFps.toFixed(1) + ' fps  (' + codec + ')',
      'body      ' + poseHz.toFixed(1) + '/s   packets ' + packetHz.toFixed(1) + '/s   source ' + phoneSource,
      'phone     tracking ' + phoneFps.toFixed(1) + ' fps, ' + phoneInferMs.toFixed(1) + ' ms per frame',
      'network   rtt ' + (rttMs === null ? '?' : rttMs.toFixed(0) + ' ms') + '   same Wi-Fi ' + (lan === null ? '?' : lan ? 'yes' : 'NO'),
      'sync      delay ' + estimateMs.toFixed(0) + ' ms + adjust ' + userOffset + ' ms (←/→)   clock rtt ' +
        (clock.rtt === null ? '?' : clock.rtt.toFixed(0) + ' ms') +
        (rvfcDelayMs === null ? '' : '   frame-meta ' + rvfcDelayMs.toFixed(0) + ' ms'),
      'frames    ' + rvfcFrames + ' shown',
    ].join('\n');

    window.__tvDebug = {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      videoFps,
      poseHz,
      codec,
      delayMs: estimateMs + userOffset,
      clockRttMs: clock.rtt,
      lan,
      works,
    };
  }

  // ---- drawing ----
  let raf = 0;
  const draw = () => {
    if (disposed) return;
    raf = requestAnimationFrame(draw);
    if (!ctx) return;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    ctx.clearRect(0, 0, w, hgt);
    if (video.videoWidth === 0) return;
    const rect = containRect(video.videoWidth, video.videoHeight, w, hgt);
    const pose = timeline.sampleAt(performance.now() - (estimateMs + userOffset));
    if (pose) drawBody(ctx, pose, rect);
  };
  raf = requestAnimationFrame(draw);

  // ---- remote keys ----
  const onKey = (e: KeyboardEvent) => {
    const key = e.key || '';
    const code = e.keyCode;
    if (key === 'Enter' || code === 13) {
      hud.className = hud.className.indexOf('hidden') >= 0 ? 'hud' : 'hud hidden';
      hint.className = 'hint hidden';
    } else if (key === 'ArrowLeft' || code === 37) {
      userOffset -= 20;
      writeOffset(userOffset);
    } else if (key === 'ArrowRight' || code === 39) {
      userOffset += 20;
      writeOffset(userOffset);
    }
  };
  document.addEventListener('keydown', onKey);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    clearInterval(pingTimer);
    clearInterval(statsTimer);
    if (lostTimer) clearTimeout(lostTimer);
    document.removeEventListener('keydown', onKey);
    rx.pc.removeEventListener('iceconnectionstatechange', onIce);
    rx.onStream = null;
    rx.pose.onmessage = null;
    rx.ctl.onmessage = null;
    video.srcObject = null;
  }

  return dispose;
}

function drawBody(ctx: CanvasRenderingContext2D, pose: Landmark[], rect: Rect): void {
  const pt = (i: number) => {
    const lm = pose[i];
    return lm && lm.visibility >= VISIBLE ? toScreen(lm.x, lm.y, rect, true) : null;
  };
  const unit = Math.max(4, rect.h * 0.012);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
  ctx.lineWidth = unit;
  ctx.beginPath();
  for (const [a, b] of BODY_CONNECTIONS) {
    const p = pt(a);
    const q = pt(b);
    if (!p || !q) continue;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();

  const nose = pt(LM.nose);
  const le = pose[LM.leftEar];
  const re = pose[LM.rightEar];
  if (nose && le && re) {
    const r = Math.max(unit * 2, Math.abs(le.x - re.x) * rect.w * 0.6);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 214, 0, 0.9)';
  for (const i of HAND_POINTS) {
    const p = pt(i);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, unit * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
