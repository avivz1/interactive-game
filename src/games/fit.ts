// "Step back until you fit": checks the camera sees the whole child before playing.

import { LM, type Landmark } from '../shared/landmarks';

export type FitState = 'no-body' | 'head-cut' | 'too-close' | 'feet-cut' | 'too-far' | 'ok';

export const FIT_HINTS: Record<FitState, string> = {
  'no-body': 'Stand in front of the camera',
  'head-cut': 'Step back a little so I can see your head',
  'too-close': 'Step back so I can see your tummy and legs',
  'feet-cut': 'Step back a little — I can’t see your feet',
  'too-far': 'Come a little closer',
  ok: 'Perfect! Stay there…',
};

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
  return 'ok';
}
