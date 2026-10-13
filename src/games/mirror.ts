// Mirror Monster rules (no drawing here, so it can be tested): a monster
// strikes a pose, the child copies it like a mirror and holds it for a second.
// Poses are compared by the directions of arms and legs on the screen (not by
// positions), so any body size works and small differences still count.

import type { Pt } from '../shared/body';
import { LM } from '../shared/landmarks';
import { mulberry32 } from './rng';

/** Limb segments, named by the side of the SCREEN they are on (the child sees a mirror). */
export const SEGMENTS = ['lUpper', 'lFore', 'rUpper', 'rFore', 'lThigh', 'lShin', 'rThigh', 'rShin'] as const;
export type Segment = (typeof SEGMENTS)[number];

/** A target direction in screen degrees (0 = right, 90 = down, 180 = left, -90 = up) and how far off is still fine. */
export interface Aim {
  deg: number;
  tol: number;
}

export interface Pose {
  id: string;
  /** Harder poses come after a few successes. */
  level: 1 | 2;
  aims: Partial<Record<Segment, Aim>>;
}

const ARM = 35;
const a = (deg: number, tol = ARM): Aim => ({ deg, tol });

export const POSES: ReadonlyArray<Pose> = [
  { id: 'arms-up', level: 1, aims: { lUpper: a(-115), lFore: a(-110), rUpper: a(-65), rFore: a(-70) } },
  { id: 'airplane', level: 1, aims: { lUpper: a(180), lFore: a(180), rUpper: a(0), rFore: a(0) } },
  { id: 'left-up', level: 1, aims: { lUpper: a(-90), lFore: a(-90), rUpper: a(90, 40), rFore: a(90, 40) } },
  { id: 'right-up', level: 1, aims: { lUpper: a(90, 40), lFore: a(90, 40), rUpper: a(-90), rFore: a(-90) } },
  { id: 'muscles', level: 2, aims: { lUpper: a(180), lFore: a(-90), rUpper: a(0), rFore: a(-90) } },
  // elbows flared out (arms hanging straight down are not "hands on hips")
  { id: 'hips', level: 2, aims: { lUpper: a(130, 22), lFore: a(45, 40), rUpper: a(50, 22), rFore: a(135, 40) } },
  // elbows up and out, hands meeting on top of the head
  { id: 'head', level: 2, aims: { lUpper: a(-120, 30), lFore: a(-20, 40), rUpper: a(-60, 30), rFore: a(-160, 40) } },
  {
    id: 'star',
    level: 2,
    aims: { lUpper: a(-140), lFore: a(-140), rUpper: a(-40), rFore: a(-40), lThigh: a(115, 15), lShin: a(115, 18), rThigh: a(65, 15), rShin: a(65, 18) },
  },
];

/** Joints of each segment for the screen-left and screen-right side of the child. */
interface Side {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
}
const LEFT_BODY: Side = { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle };
const RIGHT_BODY: Side = { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle };

/** The child's joints for each segment's start and end, by screen side (null when not tracked). */
export function segmentJoints(points: ReadonlyArray<Pt | null>): Record<Segment, [Pt | null, Pt | null]> | null {
  const l = points[LM.leftShoulder];
  const r = points[LM.rightShoulder];
  if (!l || !r) return null;
  // the body side that appears on the left of the screen (the picture is mirrored)
  const [sl, sr] = l.x <= r.x ? [LEFT_BODY, RIGHT_BODY] : [RIGHT_BODY, LEFT_BODY];
  const p = (i: number) => points[i] || null;
  return {
    lUpper: [p(sl.shoulder), p(sl.elbow)],
    lFore: [p(sl.elbow), p(sl.wrist)],
    rUpper: [p(sr.shoulder), p(sr.elbow)],
    rFore: [p(sr.elbow), p(sr.wrist)],
    lThigh: [p(sl.hip), p(sl.knee)],
    lShin: [p(sl.knee), p(sl.ankle)],
    rThigh: [p(sr.hip), p(sr.knee)],
    rShin: [p(sr.knee), p(sr.ankle)],
  };
}

/** Smallest difference between two angles, in degrees (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

export interface Match {
  /** Every aimed segment is within its tolerance. */
  matched: boolean;
  /** 0..1, how close overall (for feedback). */
  score: number;
  /** Per aimed segment: within tolerance (null when its joints are not tracked). */
  segs: Partial<Record<Segment, boolean | null>>;
}

/** The segment before each hand or foot segment (forearm after upper arm, shin after thigh). */
const PARENT: Partial<Record<Segment, Segment>> = { lFore: 'lUpper', rFore: 'rUpper', lShin: 'lThigh', rShin: 'rThigh' };

/**
 * How well the child copies `pose`. `topY` is the screen y of the top of the
 * picture: an arm raised out of it (a grown-up, or a phone set low) is
 * forgiven when it should point up.
 */
export function matchPose(points: ReadonlyArray<Pt | null>, pose: Pose, topY = -Infinity): Match {
  const joints = segmentJoints(points);
  const segs: Partial<Record<Segment, boolean | null>> = {};
  const forgiven: Partial<Record<Segment, boolean>> = {};
  const ls = points[LM.leftShoulder];
  const rs = points[LM.rightShoulder];
  const span = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : 0;
  let total = 0;
  let n = 0;
  let matched = !!joints;
  for (const seg of SEGMENTS) {
    const aim = pose.aims[seg];
    if (!aim) continue;
    n++;
    const ends = joints ? joints[seg] : [null, null];
    const [p, q] = ends;
    if (!p || !q || (p.x === q.x && p.y === q.y)) {
      segs[seg] = null;
      // A hand raised (or stretched) out of the picture: if the arm is right and
      // the hand should carry on the same way, it doesn't count against the pose.
      const parent = PARENT[seg];
      const parentAim = parent ? pose.aims[parent] : undefined;
      const outOfPicture = (!!p || (!!parent && !!forgiven[parent])) && !q && !!parent && (segs[parent] === true || !!forgiven[parent]) && !!parentAim && angleDiff(parentAim.deg, aim.deg) <= 45;
      // An upper arm raised out of the top of the picture: the shoulder is near the top and the arm should point up.
      const upAndOut = !!p && !q && !parent && p.y - topY < span * 1.1 && Math.sin((aim.deg * Math.PI) / 180) < -0.5;
      if (outOfPicture || upAndOut) {
        forgiven[seg] = true;
        total += 0.75;
        continue;
      }
      matched = false;
      continue;
    }
    const deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const d = angleDiff(deg, aim.deg);
    segs[seg] = d <= aim.tol;
    if (d > aim.tol) matched = false;
    total += Math.max(0, 1 - d / (aim.tol * 2));
  }
  return { matched, score: n ? total / n : 0, segs };
}

export type MirrorPhase = 'intro' | 'pose' | 'win' | 'miss' | 'end';

export type MirrorEvent =
  | { type: 'pose'; pose: Pose }
  | { type: 'matched' }
  | { type: 'win'; wins: number }
  | { type: 'miss' }
  | { type: 'end'; wins: number; poses: number; stars: number };

export interface MirrorConfig {
  durationSec: number;
  seed: number;
}

export const INTRO_SEC = 3.5;
/** Seconds to copy a pose before the monster moves on (with a shrug, never a "fail"). */
export const POSE_SEC = 9;
/** Seconds the pose must be held. */
export const HOLD_SEC = 1;
export const WIN_SEC = 1.6;
export const MISS_SEC = 1.2;
/** A new pose needs at least this much time left in the round. */
export const MIN_POSE_SEC = 3;

export function mirrorStars(wins: number): number {
  return wins >= 6 ? 3 : wins >= 3 ? 2 : 1; // one star is always earned
}

export class MirrorGame {
  phase: MirrorPhase = 'intro';
  phaseLeft = INTRO_SEC;
  elapsed = 0;
  wins = 0;
  posesShown = 0;
  /** 0..1 while holding the pose. */
  hold = 0;
  pose: Pose = POSES[0];
  private matchedOnce = false;
  private readonly rand: () => number;

  constructor(readonly config: MirrorConfig) {
    this.rand = mulberry32(config.seed);
  }

  get remaining(): number {
    return Math.max(0, this.config.durationSec - this.elapsed);
  }

  /** Picks the next pose: the first two are the easiest, then random, never the same twice in a row. */
  private nextPose(): Pose {
    if (this.posesShown === 0) return POSES[0];
    if (this.posesShown === 1) return POSES[1];
    const pool = POSES.filter((p) => p.id !== this.pose.id && (p.level === 1 || this.wins >= 3));
    return pool[Math.floor(this.rand() * pool.length) % pool.length];
  }

  private startPose(events: MirrorEvent[]): void {
    this.pose = this.nextPose();
    this.posesShown++;
    this.phase = 'pose';
    // the last pose of the round ends with the clock
    this.phaseLeft = Math.min(POSE_SEC, Math.max(MIN_POSE_SEC, this.remaining));
    this.hold = 0;
    this.matchedOnce = false;
    events.push({ type: 'pose', pose: this.pose });
  }

  update(dt: number, match: Match | null): MirrorEvent[] {
    const events: MirrorEvent[] = [];
    if (this.phase === 'end') return events;
    if (this.phase !== 'intro') this.elapsed += dt;
    this.phaseLeft -= dt;

    if (this.phase === 'pose') {
      if (match && match.matched) {
        if (!this.matchedOnce) {
          this.matchedOnce = true;
          events.push({ type: 'matched' });
        }
        this.hold = Math.min(1, this.hold + dt / HOLD_SEC);
      } else {
        this.hold = Math.max(0, this.hold - dt / (HOLD_SEC * 2)); // a short wobble only slows it down
      }
      if (this.hold >= 1) {
        this.wins++;
        this.phase = 'win';
        this.phaseLeft = WIN_SEC;
        events.push({ type: 'win', wins: this.wins });
      } else if (this.phaseLeft <= 0) {
        this.phase = 'miss';
        this.phaseLeft = MISS_SEC;
        events.push({ type: 'miss' });
      }
      return events;
    }

    if (this.phaseLeft > 0) return events;
    if (this.phase !== 'intro' && this.remaining < MIN_POSE_SEC) {
      this.phase = 'end';
      events.push({ type: 'end', wins: this.wins, poses: this.posesShown, stars: mirrorStars(this.wins) });
      return events;
    }
    this.startPose(events);
    return events;
  }
}
