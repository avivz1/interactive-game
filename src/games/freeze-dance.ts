// Freeze Dance rules (no drawing here, so it can be tested): dance while the
// music plays; when it stops, freeze like a statue. A friendly monster checks
// for a few seconds — a statue earns a star, a wiggle earns a giggle. Nobody is
// ever "out".

import type { Pt } from '../shared/body';
import { LM } from '../shared/landmarks';
import { mulberry32 } from './rng';

/** Joints watched for movement (face detail left out on purpose). */
const JOINTS = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];

/**
 * How much the child is moving, in shoulder widths per second. Uses the second
 * fastest joint, so one jittery point can't make a still child "move", while
 * a waving arm (wrist and elbow together) still counts.
 */
export class MotionMeter {
  value = 0;
  /** The fastest-moving hand or foot this frame (for sparkles), or null. */
  hot: Pt | null = null;
  private prev: Array<Pt | null> = [];

  update(points: ReadonlyArray<Pt | null>, unit: number, dt: number): number {
    const speeds: number[] = [];
    let hotSpeed = 0;
    this.hot = null;
    if (dt > 0 && unit > 0) {
      for (const j of JOINTS) {
        const p = points[j];
        const q = this.prev[j];
        if (!p || !q) continue;
        const v = Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)) / dt / unit;
        speeds.push(v);
        const limb = j === LM.leftWrist || j === LM.rightWrist || j === LM.leftAnkle || j === LM.rightAnkle;
        if (limb && v > hotSpeed) {
          hotSpeed = v;
          this.hot = p;
        }
      }
    }
    this.prev = [];
    for (const j of JOINTS) this.prev[j] = points[j] ? { x: points[j]!.x, y: points[j]!.y } : null;
    if (speeds.length >= 2) {
      speeds.sort((a, b) => b - a);
      const robust = speeds[1];
      // smooth over about a fifth of a second
      this.value += (robust - this.value) * Math.min(1, dt / 0.2);
    }
    if (hotSpeed < 1.5) this.hot = null;
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.prev = [];
    this.hot = null;
  }
}

export type FreezePhase = 'intro' | 'dance' | 'freeze' | 'result' | 'end';

export type FreezeEvent =
  | { type: 'dance' }
  | { type: 'freeze' }
  | { type: 'statue'; statues: number }
  | { type: 'wiggle' }
  | { type: 'end'; statues: number; freezes: number; stars: number };

export interface FreezeConfig {
  /** Seconds of play after the intro. */
  durationSec: number;
  seed: number;
}

export const INTRO_SEC = 4;
export const FREEZE_SEC = 3;
/** Kids need a moment to hear "Freeze!" and stop. */
export const GRACE_SEC = 0.7;
export const RESULT_SEC = 1.6;
/** Moving faster than this (shoulder widths / s) counts as wiggling. */
export const WIGGLE_SPEED = 1;
/** This much wiggling during the check is a wiggle (a little wobble is fine). */
export const WIGGLE_SEC = 0.45;

export function freezeStars(statues: number): number {
  return statues >= 5 ? 3 : statues >= 3 ? 2 : 1; // one star is always earned
}

export class FreezeDance {
  phase: FreezePhase = 'intro';
  /** Seconds left in the current phase. */
  phaseLeft = INTRO_SEC;
  elapsed = 0;
  statues = 0;
  wiggles = 0;
  freezes = 0;
  /** Seconds of wiggling counted in this freeze. */
  wiggleTime = 0;
  /** Result of the last freeze, while it is shown. */
  last: 'statue' | 'wiggle' | null = null;
  private readonly rand: () => number;

  constructor(readonly config: FreezeConfig) {
    this.rand = mulberry32(config.seed);
  }

  get remaining(): number {
    return Math.max(0, this.config.durationSec - this.elapsed);
  }

  /** Progress of the freeze check, 0..1 (for the monster's ring). */
  get checkProgress(): number {
    if (this.phase !== 'freeze') return 0;
    return Math.min(1, Math.max(0, (FREEZE_SEC - this.phaseLeft - GRACE_SEC) / (FREEZE_SEC - GRACE_SEC)));
  }

  /** Advance by dt seconds; `motion` comes from MotionMeter. */
  update(dt: number, motion: number): FreezeEvent[] {
    const events: FreezeEvent[] = [];
    if (this.phase === 'end') return events;
    if (this.phase !== 'intro') this.elapsed += dt;
    this.phaseLeft -= dt;

    if (this.phase === 'freeze') {
      const judging = FREEZE_SEC - this.phaseLeft > GRACE_SEC;
      if (judging && motion > WIGGLE_SPEED) this.wiggleTime += dt;
      if (this.wiggleTime >= WIGGLE_SEC) {
        this.wiggles++;
        this.last = 'wiggle';
        this.phase = 'result';
        this.phaseLeft = RESULT_SEC;
        events.push({ type: 'wiggle' });
        return events;
      }
      if (this.phaseLeft <= 0) {
        this.statues++;
        this.last = 'statue';
        this.phase = 'result';
        this.phaseLeft = RESULT_SEC;
        events.push({ type: 'statue', statues: this.statues });
      }
      return events;
    }

    if (this.phaseLeft > 0) return events;
    if (this.phase === 'intro' || this.phase === 'result') {
      if (this.phase === 'result' && this.remaining <= 0) {
        this.phase = 'end';
        this.last = null;
        events.push({ type: 'end', statues: this.statues, freezes: this.freezes, stars: freezeStars(this.statues) });
        return events;
      }
      this.phase = 'dance';
      this.last = null;
      // the first dance is a bit longer, then 4–8 s so the stop is a surprise
      this.phaseLeft = this.freezes === 0 ? 5 : 4 + this.rand() * 4;
      events.push({ type: 'dance' });
    } else if (this.phase === 'dance') {
      this.phase = 'freeze';
      this.phaseLeft = FREEZE_SEC;
      this.wiggleTime = 0;
      this.freezes++;
      events.push({ type: 'freeze' });
    }
    return events;
  }
}
