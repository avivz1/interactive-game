// Bubble Rhythm Pop rules (no drawing here, so it can be tested): bubbles
// appear at spots around the child (hands up high, feet down low) and a ring
// shrinks onto each one, landing on the beat. Pop it with a reaching hand or a
// kick: right on the beat is "Perfect!", close is "Good!", anything earlier is
// still a pop. Missed bubbles just float away.

import type { Pt } from '../shared/body';
import { mulberry32 } from './rng';

export type SpotId = 'handL' | 'handR' | 'footL' | 'footR';
export const SPOTS: ReadonlyArray<SpotId> = ['handL', 'handR', 'footL', 'footR'];

export type Grade = 'perfect' | 'good' | 'pop';

export interface Note {
  id: number;
  spot: SpotId;
  /** Song time (s) when the ring lands: the moment to pop it. */
  hitTime: number;
  /** Song time when it appears. */
  showTime: number;
  state: 'waiting' | 'live' | 'popped' | 'missed';
  grade: Grade | null;
  /** Song time when it was popped or missed (for the fade-out). */
  doneTime: number;
  /**
   * A hand or foot already resting on the spot when the bubble appeared must
   * move off and come back: holding still on a spot doesn't pop bubbles.
   */
  armed: boolean;
}

export type RhythmEvent =
  | { type: 'show'; note: Note }
  | { type: 'hit'; note: Note; grade: Grade }
  | { type: 'miss'; note: Note }
  | { type: 'end'; hits: number; perfects: number; total: number; stars: number };

export interface RhythmConfig {
  /** Seconds of play. */
  durationSec: number;
  /** Seconds between beats the bubbles land on (the music's kick drum). */
  pulseSec: number;
  seed: number;
}

/** How long a bubble is visible before its beat (the ring shrinks meanwhile). */
export const LEAD_SEC = 2.4;
export const PERFECT_SEC = 0.2;
export const GOOD_SEC = 0.45;
/** The first bubble lands on this pulse (a couple of beats to get ready). */
const FIRST_PULSE = 3;

export function rhythmStars(hits: number, total: number): number {
  if (total <= 0) return 1;
  const share = hits / total;
  return share >= 0.7 ? 3 : share >= 0.4 ? 2 : 1; // one star is always earned
}

/**
 * The chart: which spots get a bubble on which pulse. Starts slow (every few
 * beats, hands only), then every other beat with kicks, then a lively mix with
 * an occasional two-hands-at-once.
 */
export function makeChart(config: RhythmConfig): Array<{ spot: SpotId; hitTime: number }> {
  const rand = mulberry32(config.seed);
  const pulses = Math.floor(config.durationSec / config.pulseSec);
  const out: Array<{ spot: SpotId; hitTime: number }> = [];
  // one bubble per spot at a time: a spot is free once its last bubble is gone before the next appears
  const gone: Record<SpotId, number> = { handL: -Infinity, handR: -Infinity, footL: -Infinity, footR: -Infinity };
  const free = (spot: SpotId, t: number) => gone[spot] < t - LEAD_SEC;
  const add = (spot: SpotId, t: number) => {
    out.push({ spot, hitTime: t });
    gone[spot] = t + GOOD_SEC;
  };
  let last: SpotId = 'handR';
  let n = 0;
  for (let p = FIRST_PULSE; p < pulses; p++) {
    const f = p / pulses;
    const every = f < 0.3 ? 4 : 2;
    if ((p - FIRST_PULSE) % every !== 0) continue;
    const t = p * config.pulseSec;
    const otherHand: SpotId = last === 'handL' ? 'handR' : 'handL';
    let spot: SpotId;
    if (f < 0.3) {
      spot = otherHand;
    } else if (f < 0.65) {
      // hands left/right, and every fourth one a kick
      spot = n % 4 === 3 ? (rand() < 0.5 ? 'footL' : 'footR') : otherHand;
    } else {
      const options = SPOTS.filter((s) => s !== last);
      spot = options[Math.floor(rand() * options.length) % options.length];
      if (spot.indexOf('hand') === 0 && free('handL', t) && free('handR', t) && rand() < 0.2) {
        add('handL', t);
        add('handR', t);
        last = spot;
        n++;
        continue;
      }
    }
    if (!free(spot, t)) {
      const alt = SPOTS.filter((s) => s !== spot && free(s, t));
      if (!alt.length) continue;
      spot = alt[Math.floor(rand() * alt.length) % alt.length];
    }
    add(spot, t);
    last = spot;
    n++;
  }
  return out;
}

export class RhythmGame {
  readonly notes: Note[];
  hits = 0;
  perfects = 0;
  misses = 0;
  ended = false;
  /** Song time of the last update. */
  time = 0;

  constructor(readonly config: RhythmConfig) {
    let id = 1;
    this.notes = makeChart(config).map((c) => ({
      id: id++,
      spot: c.spot,
      hitTime: c.hitTime,
      showTime: c.hitTime - LEAD_SEC,
      state: 'waiting' as const,
      grade: null,
      doneTime: 0,
      armed: false,
    }));
  }

  get total(): number {
    return this.notes.length;
  }

  get remaining(): number {
    return Math.max(0, this.config.durationSec - this.time);
  }

  /** 0 when the bubble appears, 1 on its beat (for the shrinking ring). */
  progress(note: Note): number {
    return Math.max(0, Math.min(1, (this.time - note.showTime) / LEAD_SEC));
  }

  /**
   * Advances to song time `t`. `touching(spot)` says whether a reaching hand
   * or a lifted foot is on that spot's bubble right now. The pose arrives
   * `lagSec` late (over the network), so touches are judged at the moment they
   * really happened; bubbles still appear and land on the music's own time.
   */
  update(t: number, touching: (spot: SpotId) => boolean, lagSec = 0): RhythmEvent[] {
    const events: RhythmEvent[] = [];
    if (this.ended) return events;
    this.time = t;
    const judged = t - lagSec;
    const touch: Partial<Record<SpotId, boolean>> = {};
    const on = (spot: SpotId) => (touch[spot] !== undefined ? touch[spot]! : (touch[spot] = touching(spot)));
    for (const note of this.notes) {
      if (note.state === 'waiting' && t >= note.showTime) {
        note.state = 'live';
        note.armed = !on(note.spot);
        events.push({ type: 'show', note });
      }
      if (note.state !== 'live') continue;
      const dt = judged - note.hitTime;
      if (!note.armed && !on(note.spot)) note.armed = true;
      if (note.armed && on(note.spot)) {
        const grade: Grade = Math.abs(dt) <= PERFECT_SEC ? 'perfect' : Math.abs(dt) <= GOOD_SEC ? 'good' : 'pop';
        note.state = 'popped';
        note.grade = grade;
        note.doneTime = t;
        this.hits++;
        if (grade === 'perfect') this.perfects++;
        events.push({ type: 'hit', note, grade });
      } else if (dt > GOOD_SEC) {
        note.state = 'missed';
        note.doneTime = t;
        this.misses++;
        events.push({ type: 'miss', note });
      }
    }
    const last = this.notes.length ? this.notes[this.notes.length - 1].hitTime + GOOD_SEC + lagSec : 0;
    if (t >= Math.max(this.config.durationSec, last + 0.5)) {
      this.ended = true;
      events.push({ type: 'end', hits: this.hits, perfects: this.perfects, total: this.total, stars: rhythmStars(this.hits, this.total) });
    }
    return events;
  }
}

/** Where the four spots are around the child (screen px). */
export interface SpotLayout {
  at: Record<SpotId, Pt>;
  r: number;
}

/**
 * Hand spots out to the sides at about head height (reach with the arms out),
 * foot spots low to the sides (a kick), sized from the child's shoulder width.
 */
export function spotLayout(cx: number, shoulderY: number, floor: number, s: number, rect: { x: number; y: number; w: number; h: number }): SpotLayout {
  const r = Math.max(s * 0.42, rect.h * 0.05);
  const m = r * 1.1;
  const clamp = (p: Pt): Pt => ({
    x: Math.max(rect.x + m, Math.min(rect.x + rect.w - m, p.x)),
    y: Math.max(rect.y + m, Math.min(rect.y + rect.h - m, p.y)),
  });
  const at: Record<SpotId, Pt> = {
    handL: clamp({ x: cx - s * 1.45, y: shoulderY - s * 0.55 }),
    handR: clamp({ x: cx + s * 1.45, y: shoulderY - s * 0.55 }),
    footL: clamp({ x: cx - s * 0.95, y: floor - s * 0.45 }),
    footR: clamp({ x: cx + s * 0.95, y: floor - s * 0.45 }),
  };
  // Beside a screen edge the outer hand spot gets pushed onto the face: move it
  // above the head, or else low on the roomier side.
  const head = { x: cx, y: shoulderY - s * 0.75 };
  const open = rect.x + rect.w - cx >= cx - rect.x ? 1 : -1;
  let aboveFree = true;
  for (const id of ['handL', 'handR'] as SpotId[]) {
    const p = at[id];
    if (Math.hypot(p.x - head.x, p.y - head.y) >= r + s * 0.5) continue;
    const above = { x: Math.max(rect.x + m, Math.min(rect.x + rect.w - m, cx)), y: head.y - s * 0.5 - r * 1.2 };
    if (aboveFree && above.y >= rect.y + m) {
      at[id] = above;
      aboveFree = false;
    } else at[id] = clamp({ x: cx + open * s * 1.45, y: shoulderY + s * 0.45 });
  }
  return { r, at };
}
