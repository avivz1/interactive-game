// A quick sideways sweep of a hand in front of the body (like flipping pages
// on a phone), used to flip the game menu's pages. Only sweeps at chest height
// count, below the game bubbles, so reaching up for a bubble (or moving from
// one bubble to another) never flips the page.

import type { Pt } from '../shared/body';

/** How far the hand must travel sideways (shoulder widths)... */
export const SWIPE_DIST = 1.3;
/** ...within this time (seconds). */
export const SWIPE_SEC = 0.6;
/** No new swipe right after one (seconds). */
export const SWIPE_COOLDOWN_SEC = 0.8;

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

  /**
   * Feed the hands each frame (null when not tracked). Returns -1 for a sweep
   * toward the screen's left, 1 toward its right, 0 otherwise.
   */
  update(hands: ReadonlyArray<Pt | null>, unit: number, dt: number, band: SwipeBand): -1 | 0 | 1 {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = 0; i < this.trails.length; i++) {
      const h = hands[i];
      const trail = this.trails[i];
      // a hand that is lost or leaves the chest band starts over
      if (!h || h.y < band.top || h.y > band.bottom) {
        trail.length = 0;
        continue;
      }
      trail.push({ x: h.x, y: h.y, t: this.time });
      while (trail.length && this.time - trail[0].t > SWIPE_SEC) trail.shift();
      if (this.cooldown > 0 || unit <= 0) continue;
      for (const p of trail) {
        const dx = h.x - p.x;
        const dy = h.y - p.y;
        if (Math.abs(dx) >= unit * SWIPE_DIST && Math.abs(dy) <= Math.abs(dx) * 0.6) {
          this.cooldown = SWIPE_COOLDOWN_SEC;
          this.trails = [[], []];
          return dx < 0 ? -1 : 1;
        }
      }
    }
    return 0;
  }

  reset(): void {
    this.trails = [[], []];
    this.cooldown = 0;
  }
}
