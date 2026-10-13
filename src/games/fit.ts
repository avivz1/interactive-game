// "Step back until you fit": checks the camera sees the whole player (a child
// or a grown-up) before playing, with room above the head for raised hands.

import { LM, type Landmark } from '../shared/landmarks';

export type FitState = 'no-body' | 'head-cut' | 'too-close' | 'feet-cut' | 'too-far' | 'hands-cut' | 'ok';

/** Shoulder width as a share of the frame width below which the child is too far away. */
const MIN_SHOULDER_WIDTH = 0.06;

export function evaluateFit(points: ReadonlyArray<Landmark | null>): FitState {
  const p = (i: number) => points[i] || null;
  const ls = p(LM.leftShoulder);
  const rs = p(LM.rightShoulder);
  if (!ls || !rs) return 'no-body';
  const nose = p(LM.nose);
  if (!nose || nose.y < 0.03) return 'head-cut';
  if (!p(LM.leftHip) || !p(LM.rightHip)) return 'too-close';
  const la = p(LM.leftAnkle);
  const ra = p(LM.rightAnkle);
  if (!la || !ra || la.y > 0.98 || ra.y > 0.98) return 'feet-cut';
  if (Math.abs(ls.x - rs.x) < MIN_SHOULDER_WIDTH) return 'too-far';
  if (!handsRoom(points)) return 'hands-cut';
  return 'ok';
}

/**
 * Whether hands raised straight up stay in the picture. An arm is about 1.15
 * times as long as the body from shoulders to hips, for grown-ups and children
 * alike, so this needs no size guess. True when it can't be judged.
 */
export function handsRoom(points: ReadonlyArray<Landmark | null>): boolean {
  const p = (i: number) => points[i] || null;
  const ls = p(LM.leftShoulder);
  const rs = p(LM.rightShoulder);
  const lh = p(LM.leftHip);
  const rh = p(LM.rightHip);
  if (!ls || !rs || !lh || !rh) return true;
  const sy = (ls.y + rs.y) / 2;
  const hy = (lh.y + rh.y) / 2;
  return sy - 1.15 * (hy - sy) >= 0;
}

/** With 'hands-cut': room below the feet, so raising the phone (rather than stepping back) helps. */
export function roomBelowFeet(points: ReadonlyArray<Landmark | null>): boolean {
  const la = points[LM.leftAnkle];
  const ra = points[LM.rightAnkle];
  return !!la && !!ra && Math.max(la.y, ra.y) < 0.85;
}

export type ViewHint = 'no-one' | 'cut' | null;

/**
 * What the phone tells whoever set it up: nobody found for a second, or the
 * head or raised hands would be cut off (raise the phone or step back).
 */
export function viewHint(points: ReadonlyArray<Landmark | null> | null, msSinceBody: number): ViewHint {
  if (!points || msSinceBody > 1000) return 'no-one';
  const seen = points.map((p) => (p && p.visibility >= 0.3 ? p : null));
  const nose = seen[LM.nose];
  if (nose && nose.y < 0.03) return 'cut';
  return handsRoom(seen) ? null : 'cut';
}
