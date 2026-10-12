// Tickle Pop rules (no drawing here, so it can be tested):
// bubble-creatures float up near the child; keeping a hand (or a lifted foot)
// on one tickles it, it giggles louder through 3 stages and pops into confetti.
// Sleepy bubbles nap low, near the feet, until a kick or a hand wakes them.
// Nothing is ever "lost" — bubbles that are not tickled simply float away.

import type { Pt } from '../shared/body';
import { mulberry32 } from './rng';

export type BubbleKind = 'normal' | 'sneezy' | 'sleepy';

export interface Bubble {
  id: number;
  kind: BubbleKind;
  /** Centre position in screen pixels. */
  x: number;
  y: number;
  baseX: number;
  r: number;
  color: number;
  /** 0..1 — pops at 1. */
  tickle: number;
  /** 0 = calm, 1..3 = giggle stages. */
  stage: number;
  age: number;
  phase: number;
  touched: boolean;
  /** A sleepy bubble resting at shin height. */
  napping?: boolean;
}

export type GameEvent =
  | { type: 'giggle'; bubble: Bubble; stage: number }
  | { type: 'pop'; bubble: Bubble; cause: 'touch' | 'sneeze' }
  | { type: 'escape'; bubble: Bubble }
  | { type: 'finale' }
  | { type: 'end'; popped: number; stars: number };

/** What can tickle: reaching hands and lifted feet (never the head or body). */
export interface Hits {
  hands: Pt[];
  feet: Pt[];
  handRadius: number;
  footRadius: number;
}

/** Where bubbles may appear: around the child, inside arm's reach. */
export interface Envelope {
  centerX: number;
  /** Shoulder width in pixels (S). */
  unit: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Where the child's feet are (screen y), if tracked: sleepy bubbles nap just above them. */
  floor?: number | null;
}

export interface TickleConfig {
  durationSec: number;
  /** Seconds of continuous tickling to pop a bubble. */
  tickleSec: number;
  seed: number;
}

export const DEFAULT_CONFIG: TickleConfig = { durationSec: 60, tickleSec: 0.45, seed: 1 };
export const COLORS = 5;
const FINALE_SEC = 8;
/** Sleepy bubbles nap this long near the feet before floating on. */
const NAP_SEC = 9;

export function starsFor(popped: number): number {
  return popped >= 20 ? 3 : popped >= 10 ? 2 : 1; // one star is always earned
}

export class TicklePop {
  readonly bubbles: Bubble[] = [];
  popped = 0;
  elapsed = 0;
  ended = false;
  private nextId = 1;
  private spawnTimer = 0.3;
  private finaleAnnounced = false;
  private readonly rand: () => number;

  constructor(readonly config: TickleConfig = DEFAULT_CONFIG) {
    this.rand = mulberry32(config.seed);
  }

  get remaining(): number {
    return Math.max(0, this.config.durationSec - this.elapsed);
  }

  get inFinale(): boolean {
    return this.remaining <= FINALE_SEC && !this.ended;
  }

  update(dt: number, env: Envelope, hits: Hits): GameEvent[] {
    const events: GameEvent[] = [];
    if (!this.ended) {
      this.elapsed += dt;
      if (this.inFinale && !this.finaleAnnounced) {
        this.finaleAnnounced = true;
        events.push({ type: 'finale' });
      }
      this.spawn(dt, env);
    }

    const riseSpeed = (env.bottom - env.top) / (this.ended ? 2.5 : 7); // px per second
    for (const b of this.bubbles) {
      b.age += dt;
      // shin height: just above the child's feet (or the bottom of the picture)
      const napY = Math.min(env.bottom - env.unit * 0.6, (env.floor != null ? env.floor : env.bottom) - env.unit * 0.8);
      if (b.kind === 'sleepy' && !this.ended && b.age < NAP_SEC && (b.napping || b.y <= napY)) {
        b.napping = true;
        b.y = napY + Math.sin(b.age * 1.3 + b.phase) * env.unit * 0.08; // snoozing at shin height
      } else {
        b.napping = false;
        b.y -= riseSpeed * dt * (b.kind === 'sleepy' ? 0.7 : 1);
      }
      b.x = b.baseX + Math.sin(b.age * 1.6 + b.phase) * env.unit * 0.15;
      b.touched = !this.ended && this.isTouched(b, hits);
      if (b.touched) b.tickle = Math.min(1, b.tickle + dt / this.config.tickleSec);
      else b.tickle = Math.max(0, b.tickle - dt * 0.3);
      const stage = b.tickle <= 0 ? 0 : b.tickle < 0.34 ? 1 : b.tickle < 0.67 ? 2 : 3;
      if (stage > b.stage) events.push({ type: 'giggle', bubble: b, stage });
      b.stage = stage;
    }

    for (const b of this.bubbles.slice()) {
      if (b.tickle >= 1 && this.bubbles.indexOf(b) >= 0) this.pop(b, 'touch', events);
    }
    for (const b of this.bubbles.slice()) {
      if (b.y + b.r < env.top - b.r) {
        this.remove(b);
        events.push({ type: 'escape', bubble: b });
      }
    }

    if (!this.ended && this.remaining <= 0) {
      this.ended = true;
      events.push({ type: 'end', popped: this.popped, stars: starsFor(this.popped) });
    }
    return events;
  }

  private isTouched(b: Bubble, hits: Hits): boolean {
    const near = (p: Pt, radius: number) => {
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const reach = radius + b.r * 0.9;
      return dx * dx + dy * dy <= reach * reach;
    };
    for (const hand of hits.hands) if (near(hand, hits.handRadius)) return true;
    for (const foot of hits.feet) if (near(foot, hits.footRadius)) return true;
    return false;
  }

  private pop(b: Bubble, cause: 'touch' | 'sneeze', events: GameEvent[]): void {
    this.remove(b);
    this.popped++;
    events.push({ type: 'pop', bubble: b, cause });
    if (b.kind === 'sneezy') {
      // Achoo! Nearby bubbles pop too (and may sneeze in turn).
      for (const other of this.bubbles.slice()) {
        const dx = other.x - b.x;
        const dy = other.y - b.y;
        const range = (b.r + other.r) * 2.2;
        if (dx * dx + dy * dy <= range * range && this.bubbles.indexOf(other) >= 0) this.pop(other, 'sneeze', events);
      }
    }
  }

  private remove(b: Bubble): void {
    const i = this.bubbles.indexOf(b);
    if (i >= 0) this.bubbles.splice(i, 1);
  }

  private spawn(dt: number, env: Envelope): void {
    const finale = this.inFinale;
    const max = finale ? 7 : this.elapsed < 15 ? 3 : 5;
    const interval = finale ? 0.5 : 1.3;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.bubbles.length >= max) return;
    this.spawnTimer = interval;

    const r = env.unit * (0.42 + this.rand() * 0.18);
    const half = env.unit * 2.2;
    const minX = Math.max(env.left + r, env.centerX - half);
    const maxX = Math.min(env.right - r, env.centerX + half);
    // Prefer a spot away from existing low bubbles so they don't overlap.
    let x = minX + this.rand() * Math.max(0, maxX - minX);
    for (let tries = 0; tries < 4; tries++) {
      const crowded = this.bubbles.some((o) => o.y > env.bottom - env.unit * 2 && Math.abs(o.x - x) < r + o.r);
      if (!crowded) break;
      x = minX + this.rand() * Math.max(0, maxX - minX);
    }
    const roll = this.rand();
    const kind: BubbleKind = this.elapsed < 8 ? 'normal' : roll < 0.15 ? 'sneezy' : roll < 0.27 ? 'sleepy' : 'normal';
    this.bubbles.push({
      id: this.nextId++,
      kind,
      x,
      y: env.bottom + r,
      baseX: x,
      r,
      color: Math.floor(this.rand() * COLORS),
      tickle: 0,
      stage: 0,
      age: 0,
      phase: this.rand() * Math.PI * 2,
      touched: false,
    });
  }
}
