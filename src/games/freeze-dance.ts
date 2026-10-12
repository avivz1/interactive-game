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

const LIMB_TIPS: ReadonlyArray<number> = [LM.nose, LM.leftWrist, LM.rightWrist, LM.leftAnkle, LM.rightAnkle];
/** How much a single moving hand, foot or head counts compared with the body. */
const TIP_WEIGHT = 0.45;

/**
 * How much the child is moving, in shoulder widths per second. Each joint's
 * speed is smoothed over about a quarter of a second. The body term is the
 * second-fastest joint (one jittery point can't make a still child "move");
 * the tip term catches a single hand waving from the elbow or a foot tapping
 * from the knee, at a lower weight.
 */
export class MotionMeter {
  value = 0;
  /** The fastest-moving hand or foot this frame (for sparkles), or null. */
  hot: Pt | null = null;
  private prev: Array<Pt | null> = [];
  private speed: number[] = [];

  update(points: ReadonlyArray<Pt | null>, unit: number, dt: number): number {
    this.hot = null;
    if (!(dt > 0) || !(unit > 0)) return this.value;
    const k = Math.min(1, dt / 0.25);
    let hotSpeed = 0;
    for (const j of JOINTS) {
      const p = points[j];
      const q = this.prev[j];
      const v = p && q ? Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)) / dt / unit : 0;
      // a joint that just (re)appeared has no speed yet
      this.speed[j] = p && q ? (this.speed[j] || 0) + (v - (this.speed[j] || 0)) * k : 0;
      const limb = j === LM.leftWrist || j === LM.rightWrist || j === LM.leftAnkle || j === LM.rightAnkle;
      if (p && limb && v > hotSpeed) {
        hotSpeed = v;
        this.hot = p;
      }
    }
    this.prev = [];
    for (const j of JOINTS) this.prev[j] = points[j] ? { x: points[j]!.x, y: points[j]!.y } : null;
    const sorted = JOINTS.map((j) => this.speed[j] || 0).sort((a, b) => b - a);
    let tips = 0;
    for (const j of LIMB_TIPS) tips = Math.max(tips, this.speed[j] || 0);
    this.value = Math.max(sorted[1] || 0, tips * TIP_WEIGHT);
    if (hotSpeed < 1.5) this.hot = null;
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.prev = [];
    this.speed = [];
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

/** The shortest dance; a round with less time left than this ends instead. */
export const MIN_DANCE_SEC = 4;

export const INTRO_SEC = 4;
export const FREEZE_SEC = 3;
/**
 * Kids need a moment to hear "Freeze!" and stop, and the movement the TV sees
 * is a little late (video delay plus smoothing): add the delay to this.
 */
export const GRACE_SEC = 1;
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
  /** Grace time for the current freeze (GRACE_SEC plus the picture's delay). */
  grace = GRACE_SEC;
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
    return Math.min(1, Math.max(0, (this.checkLength - this.phaseLeft - this.grace) / (this.checkLength - this.grace)));
  }

  /** The freeze lasts the grace time plus about 2.3 s of watching. */
  get checkLength(): number {
    return FREEZE_SEC + (this.grace - GRACE_SEC);
  }

  /**
   * Starts the current freeze check over (the child was out of the picture):
   * nothing seen so far counts.
   */
  restartCheck(): void {
    if (this.phase !== 'freeze') return;
    this.phaseLeft = this.checkLength;
    this.wiggleTime = 0;
  }

  /**
   * Advance by dt seconds; `motion` comes from MotionMeter, `delaySec` is how
   * late the picture is (it lengthens the grace time of the next freeze).
   */
  update(dt: number, motion: number, delaySec = 0): FreezeEvent[] {
    const events: FreezeEvent[] = [];
    if (this.phase === 'end') return events;
    if (this.phase !== 'intro') this.elapsed += dt;
    this.phaseLeft -= dt;

    if (this.phase === 'freeze') {
      const judging = this.checkLength - this.phaseLeft > this.grace;
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
      if (this.phase === 'result' && this.remaining < MIN_DANCE_SEC) {
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
      this.grace = GRACE_SEC + Math.max(0, Math.min(0.5, delaySec));
      this.phaseLeft = this.checkLength;
      this.wiggleTime = 0;
      this.freezes++;
      events.push({ type: 'freeze' });
    }
    return events;
  }
}
