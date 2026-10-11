// Time-ordered buffer of pose samples so landmarks can be drawn for the moment the
// on-screen video frame was captured (the video arrives later than the landmarks).

import type { Landmark } from './landmarks';

export interface TimedPose {
  /** capture time on the TV clock (ms) */
  t: number;
  landmarks: Landmark[] | null;
}

const STALE_MS = 500;

export class PoseTimeline {
  private items: TimedPose[] = [];

  constructor(private readonly keepMs = 3000) {}

  push(p: TimedPose): void {
    const items = this.items;
    let i = items.length;
    while (i > 0 && items[i - 1].t > p.t) i--;
    items.splice(i, 0, p);
    const newest = items[items.length - 1].t;
    let drop = 0;
    while (drop < items.length - 1 && items[drop].t < newest - this.keepMs) drop++;
    if (drop > 0) items.splice(0, drop);
  }

  get size(): number {
    return this.items.length;
  }

  /** Pose at time t (TV clock), linearly interpolated between neighbours. */
  sampleAt(t: number): Landmark[] | null {
    const items = this.items;
    if (items.length === 0) return null;
    const last = items[items.length - 1];
    if (t >= last.t) return t - last.t <= STALE_MS ? last.landmarks : null;
    if (t <= items[0].t) return items[0].landmarks;
    let i = items.length - 2;
    while (i > 0 && items[i].t > t) i--;
    const a = items[i];
    const b = items[i + 1];
    if (!a.landmarks || !b.landmarks || a.landmarks.length !== b.landmarks.length) {
      return t - a.t < b.t - t ? a.landmarks : b.landmarks;
    }
    const span = b.t - a.t;
    const f = span > 0 ? (t - a.t) / span : 0;
    const out: Landmark[] = [];
    for (let k = 0; k < a.landmarks.length; k++) {
      const p = a.landmarks[k];
      const q = b.landmarks[k];
      out.push({
        x: p.x + (q.x - p.x) * f,
        y: p.y + (q.y - p.y) * f,
        visibility: Math.min(p.visibility, q.visibility),
      });
    }
    return out;
  }
}
