// Landmark smoothing: a One Euro filter per coordinate (smooth when still,
// responsive when moving) plus a short hold so a point that briefly loses
// confidence (fast-moving hands) does not vanish.

import type { Landmark } from './landmarks';

function alpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  /** Cutoffs in Hz; beta scales with speed in normalized units per second. */
  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 6,
    private readonly dCutoff = 1,
  ) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 0.001);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export interface SmootherOptions {
  /** Minimum visibility for a landmark to be used. */
  threshold?: number;
  /** How long a lost landmark keeps its last position (ms). */
  holdMs?: number;
}

interface Held {
  x: number;
  y: number;
  visibility: number;
  t: number;
}

export class PoseSmoother {
  private readonly threshold: number;
  private readonly holdMs: number;
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  private held: (Held | null)[] = [];

  constructor(opts: SmootherOptions = {}) {
    this.threshold = opts.threshold !== undefined ? opts.threshold : 0.3;
    this.holdMs = opts.holdMs !== undefined ? opts.holdMs : 300;
  }

  /** Returns one entry per landmark: smoothed point, held point, or null when lost. */
  update(pose: ReadonlyArray<Landmark> | null, tMs: number, count = 33): (Landmark | null)[] {
    const out: (Landmark | null)[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.fx[i]) {
        this.fx[i] = new OneEuro();
        this.fy[i] = new OneEuro();
        this.held[i] = null;
      }
      const lm = pose ? pose[i] : undefined;
      if (lm && lm.visibility >= this.threshold) {
        const p = { x: this.fx[i].filter(lm.x, tMs), y: this.fy[i].filter(lm.y, tMs), visibility: lm.visibility };
        this.held[i] = { x: p.x, y: p.y, visibility: p.visibility, t: tMs };
        out.push(p);
        continue;
      }
      const h = this.held[i];
      if (h && tMs - h.t <= this.holdMs) {
        out.push({ x: h.x, y: h.y, visibility: h.visibility * (1 - (tMs - h.t) / this.holdMs) });
      } else {
        this.held[i] = null;
        this.fx[i].reset();
        this.fy[i].reset();
        out.push(null);
      }
    }
    return out;
  }
}
