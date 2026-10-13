// A quick sideways sweep of a hand in front of the body (like flipping pages
// on a phone), used to flip the game menu's pages. Only sweeps at chest height
// count, below the game bubbles, so reaching up for a bubble (or moving from
// one bubble to another) never flips the page.

import type { Pt } from '../shared/body';

/** How far the hand must travel sideways (shoulder widths)... */
export const SWIPE_DIST = 1.3;
/** ...within this time (seconds). */
export const SWIPE_SEC = 0.6;
/** No new swipe right after one (seconds)... */
export const SWIPE_COOLDOWN_SEC = 0.8;
/** ...and none the other way for longer: bringing the hand back is part of the gesture. */
export const SWIPE_BACK_SEC = 1.4;

/** The chest-height band where swipes count (screen y, top < bottom). */
export interface SwipeBand {
  top: number;
  bottom: number;
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

export class SwipeDetector {
  private trails: Sample[][] = [[], []];
  private time = 0;
  private cooldown = 0;
  private lastDir = 0;
  private lastAt = -100;
  private lastBody: number | null = null;

  /**
   * Feed the hands each frame (null when not tracked) and the middle of the
   * shoulders (`bodyX`), so stepping sideways or bouncing doesn't count.
   * Returns -1 for a sweep toward the screen's left, 1 toward its right, 0 otherwise.
   */
  update(hands: ReadonlyArray<Pt | null>, unit: number, dt: number, band: SwipeBand, bodyX = 0): -1 | 0 | 1 {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    // tracking jumped (to someone else, or a glitch): start over
    if (this.lastBody !== null && Math.abs(bodyX - this.lastBody) > unit) this.trails = [[], []];
    this.lastBody = bodyX;
    // right after a swipe nothing is recorded, so the hand coming back can't swipe
    if (this.cooldown > 0 || unit <= 0) {
      this.trails = [[], []];
      return 0;
    }
    const moves: number[] = [0, 0];
    let found = -1;
    for (let i = 0; i < this.trails.length; i++) {
      const h = hands[i];
      const trail = this.trails[i];
      // a hand that is lost, jumps, or leaves the chest band starts over
      const last = trail[trail.length - 1];
      if (!h || h.y < band.top || h.y > band.bottom || (last && Math.abs(h.x - bodyX - last.x) > unit)) {
        trail.length = 0;
        continue;
      }
      trail.push({ x: h.x - bodyX, y: h.y, t: this.time });
      while (trail.length && this.time - trail[0].t > SWIPE_SEC) trail.shift();
      for (const p of trail) {
        const dx = h.x - bodyX - p.x;
        if (Math.abs(dx) > Math.abs(moves[i])) moves[i] = dx;
        if (found < 0 && Math.abs(dx) >= unit * SWIPE_DIST && Math.abs(h.y - p.y) <= Math.abs(dx) * 0.6) found = i;
      }
    }
    if (found < 0) return 0;
    const dx = moves[found];
    const other = moves[1 - found];
    // both hands moving toward each other (or apart) at once: a clap, not a swipe
    if (other * dx < 0 && Math.abs(other) >= Math.abs(dx) * 0.5) return 0;
    const dir: -1 | 1 = dx < 0 ? -1 : 1;
    if (dir === -this.lastDir && this.time - this.lastAt < SWIPE_BACK_SEC) return 0;
    this.cooldown = SWIPE_COOLDOWN_SEC;
    this.trails = [[], []];
    this.lastDir = dir;
    this.lastAt = this.time;
    return dir;
  }

  reset(): void {
    this.trails = [[], []];
    this.cooldown = 0;
    this.lastDir = 0;
    this.lastBody = null;
  }
}
