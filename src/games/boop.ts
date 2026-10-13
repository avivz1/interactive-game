// Boop to Transform rules (no drawing here, so it can be tested): eggs sit
// around the child, within reach of a hand or a kick. A boop (a reaching hand
// or a lifted foot arriving on one) makes it grow a step: the egg hatches, the
// baby grows up, and the grown-up turns into a sparkly surprise and flies away.
// After each boop it hops to a new place nearby, so the child keeps moving.
// Nothing is ever lost: an egg nobody reaches just hops somewhere easier.

import type { Pt } from '../shared/body';
import type { Rect } from '../shared/mapping';
import { mulberry32 } from './rng';

/** 0 egg, 1 baby, 2 grown-up, 3 surprise (flying away). */
export type Growth = 0 | 1 | 2 | 3;
/** Up high for the hands, out to the side, or down low for a kick. */
export type Zone = 'high' | 'side' | 'low';

export interface Critter {
  id: number;
  stage: Growth;
  color: number;
  /** Which surprise it turns into (for the drawing). */
  surprise: number;
  zone: Zone;
  /** Its place relative to the child, in shoulder widths: from the middle of the shoulders, or from the floor ('low'). */
  ox: number;
  oy: number;
  /** Screen position and radius now. */
  x: number;
  y: number;
  r: number;
  /** Where the current hop (or fall, or flight) started. */
  fromX: number;
  fromY: number;
  /** Hop progress 0..1 (1 = sitting). */
  hop: number;
  /** Seconds to wait before hopping (it shows off its new look first). */
  wait: number;
  age: number;
  /** Seconds since its last boop or hop: after IDLE_SEC it hops somewhere easier. */
  idle: number;
  /** Seconds since it became a surprise. */
  flying: number;
  /** A hand or foot already on it when it landed must move off first: resting doesn't boop. */
  armed: boolean;
  touched: boolean;
}

export type BoopEvent =
  | { type: 'arrive'; critter: Critter }
  | { type: 'boop'; critter: Critter; stage: 1 | 2 }
  | { type: 'surprise'; critter: Critter }
  | { type: 'hop'; critter: Critter }
  | { type: 'end'; transformed: number; boops: number; stars: number };

/** Where the child is (smoothed by the scene). */
export interface BoopEnv {
  cx: number;
  shoulderY: number;
  /** The feet's screen y, or null when the feet are not in the picture. */
  floor: number | null;
  /** Shoulder width in pixels. */
  unit: number;
  rect: Rect;
}

/** What can boop: reaching hands and lifted feet (never the head or body). */
export interface BoopHits {
  hands: Pt[];
  feet: Pt[];
  handRadius: number;
  footRadius: number;
}

export interface BoopConfig {
  durationSec: number;
  seed: number;
}

export const HOP_SEC = 0.6;
export const WAIT_SEC = 0.3;
export const FLY_SEC = 1.6;
export const IDLE_SEC = 7;
export const ARRIVE_GAP_SEC = 0.8;
export const SURPRISES = 4;
/** Radius by stage, in shoulder widths. */
const SIZE = [0.42, 0.42, 0.5, 0.5];

export function boopStars(transformed: number): number {
  return transformed >= 8 ? 3 : transformed >= 4 ? 2 : 1; // one star is always earned
}

/** The head: about 0.75 shoulder widths above the shoulders. */
function headOf(env: BoopEnv): Pt {
  return { x: env.cx, y: env.shoulderY - env.unit * 0.75 };
}

/** The screen position of a place relative to the child (unclamped). */
export function placeOf(zone: Zone, ox: number, oy: number, env: BoopEnv): Pt {
  const u = env.unit;
  // without the feet in the picture, guess the floor from the shoulders
  const base = zone === 'low' ? (env.floor !== null ? env.floor : env.shoulderY + u * 2.6) : env.shoulderY;
  return { x: env.cx + ox * u, y: base + oy * u };
}

function clampTo(p: Pt, r: number, rect: Rect): Pt {
  const m = r * 1.05;
  return {
    x: Math.max(rect.x + m, Math.min(rect.x + rect.w - m, p.x)),
    y: Math.max(rect.y + m, Math.min(rect.y + rect.h - m, p.y)),
  };
}

function radiusFor(stage: Growth, env: BoopEnv): number {
  return Math.max(SIZE[stage] * env.unit, env.rect.h * 0.045);
}

export class BoopGame {
  readonly critters: Critter[] = [];
  transformed = 0;
  boops = 0;
  elapsed = 0;
  ended = false;
  private nextId = 1;
  private arriveIn = 0;
  private readonly rand: () => number;

  constructor(readonly config: BoopConfig) {
    this.rand = mulberry32(config.seed);
  }

  get remaining(): number {
    return Math.max(0, this.config.durationSec - this.elapsed);
  }

  /** Where a critter sits now (its place, kept inside the picture). */
  target(c: Critter, env: BoopEnv): Pt {
    return clampTo(placeOf(c.zone, c.ox, c.oy, env), c.r, env.rect);
  }

  update(dt: number, env: BoopEnv, hits: BoopHits): BoopEvent[] {
    const events: BoopEvent[] = [];
    if (this.ended) return events;
    this.elapsed += dt;

    // a new egg drops in whenever there is room (two at first, then three)
    this.arriveIn -= dt;
    const active = this.critters.filter((c) => c.stage < 3).length;
    if (active < (this.elapsed < 20 ? 2 : 3) && this.arriveIn <= 0) {
      const c = this.spawn(env);
      if (c) {
        this.arriveIn = ARRIVE_GAP_SEC;
        events.push({ type: 'arrive', critter: c });
      }
    }

    for (const c of this.critters.slice()) {
      c.age += dt;
      if (c.stage === 3) {
        // the surprise flies up and away
        c.flying += dt;
        const k = c.flying / FLY_SEC;
        c.x = c.fromX + Math.sin(c.flying * 5) * env.unit * 0.25;
        c.y = c.fromY - k * k * (c.fromY - env.rect.y + c.r * 2);
        if (c.flying >= FLY_SEC) this.critters.splice(this.critters.indexOf(c), 1);
        continue;
      }
      const to = this.target(c, env);
      if (c.wait > 0) {
        c.wait -= dt;
        c.touched = false;
        continue;
      }
      if (c.hop < 1) {
        c.hop = Math.min(1, c.hop + dt / HOP_SEC);
        const k = c.hop * c.hop * (3 - 2 * c.hop);
        c.x = c.fromX + (to.x - c.fromX) * k;
        c.y = c.fromY + (to.y - c.fromY) * k - Math.sin(Math.PI * c.hop) * env.unit * 0.6;
        c.touched = false;
        if (c.hop < 1) continue;
        // landed: a hand or foot already here must move off and come back
        c.x = to.x;
        c.y = to.y;
        c.armed = !this.touching(c, hits);
        c.idle = 0;
        continue;
      }
      c.x = to.x;
      c.y = to.y;
      c.idle += dt;
      const touched = this.touching(c, hits);
      c.touched = touched;
      if (!c.armed && !touched) c.armed = true;
      if (c.armed && touched) {
        this.boop(c, env, events);
      } else if (c.idle >= IDLE_SEC) {
        // out of reach for a while: hop somewhere easier (up high, for the hands)
        this.hopAway(c, env, 'high');
        events.push({ type: 'hop', critter: c });
      }
    }

    if (this.elapsed >= this.config.durationSec) {
      this.ended = true;
      events.push({ type: 'end', transformed: this.transformed, boops: this.boops, stars: boopStars(this.transformed) });
    }
    return events;
  }

  private boop(c: Critter, env: BoopEnv, events: BoopEvent[]): void {
    this.boops++;
    c.stage = (c.stage + 1) as Growth;
    c.armed = false;
    c.idle = 0;
    if (c.stage === 3) {
      this.transformed++;
      c.flying = 0;
      c.fromX = c.x;
      c.fromY = c.y;
      events.push({ type: 'surprise', critter: c });
      return;
    }
    c.r = radiusFor(c.stage, env);
    events.push({ type: 'boop', critter: c, stage: c.stage as 1 | 2 });
    this.hopAway(c, env);
    c.wait = WAIT_SEC;
  }

  private touching(c: Critter, hits: BoopHits): boolean {
    const near = (p: Pt, radius: number) => {
      const reach = radius + c.r * 0.9;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      return dx * dx + dy * dy <= reach * reach;
    };
    for (const h of hits.hands) if (near(h, hits.handRadius)) return true;
    for (const f of hits.feet) if (near(f, hits.footRadius)) return true;
    return false;
  }

  private pickZone(env: BoopEnv, not: Zone | null): Zone {
    const zones: Zone[] = env.floor !== null ? ['high', 'high', 'side', 'low'] : ['high', 'high', 'side'];
    for (let i = 0; i < 4; i++) {
      const z = zones[Math.floor(this.rand() * zones.length) % zones.length];
      if (z !== not) return z;
    }
    return 'high';
  }

  /** A random place in a zone, relative to the child (shoulder widths). */
  private sample(zone: Zone): { ox: number; oy: number } {
    const side = this.rand() < 0.5 ? -1 : 1;
    if (zone === 'side') return { ox: side * (1.3 + this.rand() * 0.6), oy: -0.3 + this.rand() * 0.8 };
    // a kick out to the side, clear of the standing leg
    if (zone === 'low') return { ox: side * (0.85 + this.rand() * 0.45), oy: -0.45 - this.rand() * 0.2 };
    // up high: beside the head, or now and then right over it
    if (this.rand() < 0.25) return { ox: (this.rand() - 0.5) * 0.8, oy: -1.8 - this.rand() * 0.15 };
    return { ox: side * (0.9 + this.rand() * 0.9), oy: -0.4 - this.rand() * 1.1 };
  }

  /**
   * How bad a place is (0 = good): over the face, out of reach, too close to
   * where it was (`away`) or to the others. Judged where it would really sit
   * (kept inside the picture).
   */
  private badness(zone: Zone, ox: number, oy: number, r: number, env: BoopEnv, self: Critter | null, away: Pt | null): number {
    const u = env.unit;
    const p = clampTo(placeOf(zone, ox, oy, env), r, env.rect);
    let bad = 0;
    const head = headOf(env);
    const face = Math.hypot(p.x - head.x, p.y - head.y);
    if (face < r + u * 0.6) bad += (r + u * 0.6 - face) * 4;
    if (zone !== 'low') {
      // a palm reaches about 1.6 shoulder widths from a shoulder
      const reach = Math.min(Math.hypot(p.x - (env.cx - u * 0.5), p.y - env.shoulderY), Math.hypot(p.x - (env.cx + u * 0.5), p.y - env.shoulderY));
      if (reach > u * 1.9) bad += reach - u * 1.9;
    }
    if (away) {
      const moved = Math.hypot(p.x - away.x, p.y - away.y);
      if (moved < u) bad += u - moved;
    }
    for (const o of this.critters) {
      if (o === self || o.stage === 3) continue;
      const q = this.target(o, env);
      const gap = Math.hypot(p.x - q.x, p.y - q.y);
      if (gap < r + o.r + u * 0.3) bad += (r + o.r + u * 0.3 - gap) * 2;
    }
    return bad;
  }

  /** Finds a good free place (the preferred zone first); the least bad one when none is perfect. */
  private findPlace(env: BoopEnv, r: number, self: Critter | null, prefer: Zone | null): { zone: Zone; ox: number; oy: number } {
    const away = self ? { x: self.x, y: self.y } : null;
    let best: { zone: Zone; ox: number; oy: number } | null = null;
    let bestBad = Infinity;
    for (let i = 0; i < 32; i++) {
      const zone = prefer && i < 16 ? prefer : this.pickZone(env, self ? self.zone : null);
      const s = this.sample(zone);
      const bad = this.badness(zone, s.ox, s.oy, r, env, self, away);
      if (bad < bestBad) {
        best = { zone, ox: s.ox, oy: s.oy };
        bestBad = bad;
        if (bad === 0) break;
      }
    }
    return best as { zone: Zone; ox: number; oy: number };
  }

  private hopAway(c: Critter, env: BoopEnv, prefer: Zone | null = null): void {
    const spot = this.findPlace(env, c.r, c, prefer);
    c.zone = spot.zone;
    c.ox = spot.ox;
    c.oy = spot.oy;
    c.fromX = c.x;
    c.fromY = c.y;
    c.hop = 0;
    c.idle = 0;
  }

  private spawn(env: BoopEnv): Critter | null {
    if (env.unit <= 0) return null;
    const r = radiusFor(0, env);
    // the first eggs go up high: the easiest start
    const prefer: Zone | null = this.nextId <= 2 ? 'high' : null;
    const spot = this.findPlace(env, r, null, prefer);
    const p = clampTo(placeOf(spot.zone, spot.ox, spot.oy, env), r, env.rect);
    const c: Critter = {
      id: this.nextId++,
      stage: 0,
      color: Math.floor(this.rand() * 5),
      surprise: Math.floor(this.rand() * SURPRISES) % SURPRISES,
      zone: spot.zone,
      ox: spot.ox,
      oy: spot.oy,
      x: p.x,
      // it drops in from the top of the picture
      y: env.rect.y - r,
      r,
      fromX: p.x,
      fromY: env.rect.y - r,
      hop: 0,
      wait: 0,
      age: 0,
      idle: 0,
      flying: 0,
      armed: false,
      touched: false,
    };
    this.critters.push(c);
    return c;
  }
}
