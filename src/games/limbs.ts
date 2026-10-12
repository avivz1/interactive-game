// Which body parts may touch game creatures: hands and feet only, and only
// when they are really reaching or kicking. A hand hanging at the side and a
// foot standing on the floor never count, so creatures don't react to the body.

import type { Body, Pt } from '../shared/body';
import { LM } from '../shared/landmarks';

export interface Touchers {
  /** Per hand (0 left, 1 right): the palm, or null when hanging at the side or not tracked. */
  hands: Array<Pt | null>;
  /** Per foot: the foot, or null when standing on the floor or not tracked. */
  feet: Array<Pt | null>;
}

/** A foot counts once it is lifted this far above its own floor line (shoulder widths)... */
export const KICK_LIFT = 0.2;
/** ...and this much higher than the other foot (both rising together is a step back). */
export const KICK_LEAD = 0.12;

export class Limbs {
  /** The child's size, steady when they turn sideways (shoulders look narrow then). */
  private unit = 0;
  /** Each foot's floor line (screen y): follows the foot down at once, rises over about a second. */
  private base: Array<number | null> = [null, null];

  update(body: Body, dt: number): Touchers {
    const pts = body.points;
    if (pts[LM.leftShoulder] && pts[LM.rightShoulder]) {
      this.unit = this.unit ? Math.max(body.shoulderWidth, this.unit * (1 - 0.08 * dt)) : body.shoulderWidth;
    }
    const s = this.unit || body.shoulderWidth;

    const hands: Array<Pt | null> = [null, null];
    for (let i = 0; i < 2; i++) {
      const hand = body.hands[i];
      const wrist = pts[i === 0 ? LM.leftWrist : LM.rightWrist];
      const hip = pts[i === 0 ? LM.leftHip : LM.rightHip];
      const hanging = !!wrist && !!hip && wrist.y >= hip.y - s * 0.25 && Math.abs(wrist.x - hip.x) < s * 0.5;
      hands[i] = hand && !hanging ? hand : null;
    }

    const lift = [0, 0];
    const ankles = [pts[LM.leftAnkle], pts[LM.rightAnkle]];
    for (let i = 0; i < 2; i++) {
      const a = ankles[i];
      if (!a) {
        this.base[i] = null;
        continue;
      }
      const b = this.base[i];
      this.base[i] = b === null || a.y > b ? a.y : b + (a.y - b) * Math.min(1, dt / 1);
      lift[i] = (this.base[i] as number) - a.y;
    }
    const feet: Array<Pt | null> = [null, null];
    for (let i = 0; i < 2; i++) {
      const a = ankles[i];
      if (!a || lift[i] <= s * KICK_LIFT) continue;
      const other = ankles[1 - i] ? lift[1 - i] : 0;
      if (lift[i] - other <= s * KICK_LEAD) continue;
      // touch with the middle of the foot (toward the toes) when the toes are tracked
      const toe = pts[i === 0 ? LM.leftFootIndex : LM.rightFootIndex];
      feet[i] = toe ? { x: (a.x + toe.x) / 2, y: (a.y + toe.y) / 2 } : a;
    }
    return { hands, feet };
  }
}

/** The non-null points of a toucher list. */
export function present(list: ReadonlyArray<Pt | null>): Pt[] {
  const out: Pt[] = [];
  for (const p of list) if (p) out.push(p);
  return out;
}
