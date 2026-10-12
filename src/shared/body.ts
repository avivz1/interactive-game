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
  /** Palm centres, one per hand (either may be null). */
  hands: (Pt | null)[];
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
  const hands = [palm(at(LM.leftWrist), at(LM.leftElbow)), palm(at(LM.rightWrist), at(LM.rightElbow))];
  const head = at(LM.nose);
  const le = at(LM.leftEar);
  const re = at(LM.rightEar);
  const headRadius = Math.max(le && re ? dist(le, re) * 0.8 : 0, shoulderWidth * 0.35);
  return { points, hands, head, headRadius, shoulderWidth };
}
