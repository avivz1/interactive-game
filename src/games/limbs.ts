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

/** A foot counts once it is lifted this far above the floor (shoulder widths). */
export const KICK_LIFT = 0.2;

export class Limbs {
  /** The floor line (screen y): follows the lowest foot down at once, rises slowly. */
  private ground: number | null = null;

  update(body: Body, dt: number): Touchers {
    const s = body.shoulderWidth;
    const pts = body.points;
    const hands: Array<Pt | null> = [null, null];
    for (let i = 0; i < 2; i++) {
      const hand = body.hands[i];
      const wrist = pts[i === 0 ? LM.leftWrist : LM.rightWrist];
      const hip = pts[i === 0 ? LM.leftHip : LM.rightHip];
      const hanging = !!wrist && !!hip && wrist.y >= hip.y - s * 0.25 && Math.abs(wrist.x - hip.x) < s * 0.5;
      hands[i] = hand && !hanging ? hand : null;
    }

    const feet: Array<Pt | null> = [null, null];
    const all: Array<Pt | null> = [0, 1].map((i) => {
      const ankle = pts[i === 0 ? LM.leftAnkle : LM.rightAnkle];
      const toe = pts[i === 0 ? LM.leftFootIndex : LM.rightFootIndex];
      if (ankle && toe) return { x: (ankle.x + toe.x) / 2, y: (ankle.y + toe.y) / 2 };
      return ankle || null;
    });
    let lowest = -Infinity;
    for (const f of all) if (f && f.y > lowest) lowest = f.y;
    if (lowest > -Infinity) {
      this.ground = this.ground === null ? lowest : Math.max(lowest, this.ground - s * 0.3 * dt);
      for (let i = 0; i < 2; i++) {
        const f = all[i];
        if (f && this.ground - f.y > s * KICK_LIFT) feet[i] = f;
      }
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
