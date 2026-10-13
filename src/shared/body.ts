// The player's body in screen pixels: the points games use for hits and the
// sizes everything is scaled by (so it works at any distance and kid size).

import { LM, type Landmark } from './landmarks';
import { toScreen, type Rect } from './mapping';

export interface Pt {
  x: number;
  y: number;
}

export interface Body {
  /** All 33 landmarks in screen space (null when not tracked). */
  points: (Pt | null)[];
  /** Palm centres, one per hand (either may be null), kept inside the picture. */
  hands: (Pt | null)[];
  /** Per hand: the palm was really past the edge of the picture (moved inside). */
  handsClamped: boolean[];
  head: Pt | null;
  headRadius: number;
  /** Shoulder width in pixels (S); falls back to a fraction of the video height. */
  shoulderWidth: number;
}

const dist = (a: Pt, b: Pt) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** Palm centre approximated by extending the forearm past the wrist (finger points are too noisy). */
export function palm(wrist: Pt | null, elbow: Pt | null): Pt | null {
  if (!wrist) return null;
  if (!elbow) return wrist;
  return { x: wrist.x + 0.35 * (wrist.x - elbow.x), y: wrist.y + 0.35 * (wrist.y - elbow.y) };
}

export function buildBody(landmarks: ReadonlyArray<Landmark | null>, rect: Rect, mirror: boolean): Body {
  const points = landmarks.map((lm) => (lm ? toScreen(lm.x, lm.y, rect, mirror) : null));
  const at = (i: number) => points[i] || null;
  const ls = at(LM.leftShoulder);
  const rs = at(LM.rightShoulder);
  const shoulderWidth = ls && rs ? Math.max(dist(ls, rs), rect.h * 0.04) : rect.h * 0.12;
  // a palm reaching past the edge of the picture (a raised hand) stays just inside it
  const inset = Math.min(Math.max(14, shoulderWidth * 0.3), rect.w * 0.1, rect.h * 0.1);
  const inside = (p: Pt | null): Pt | null =>
    p && { x: Math.max(rect.x + inset, Math.min(rect.x + rect.w - inset, p.x)), y: Math.max(rect.y + inset, Math.min(rect.y + rect.h - inset, p.y)) };
  const raw = [palm(at(LM.leftWrist), at(LM.leftElbow)), palm(at(LM.rightWrist), at(LM.rightElbow))];
  const hands = raw.map(inside);
  const handsClamped = raw.map((p, i) => !!p && (p.x !== hands[i]!.x || p.y !== hands[i]!.y));
  const head = at(LM.nose);
  const le = at(LM.leftEar);
  const re = at(LM.rightEar);
  const headRadius = Math.max(le && re ? dist(le, re) * 0.8 : 0, shoulderWidth * 0.35);
  return { points, hands, handsClamped, head, headRadius, shoulderWidth };
}
