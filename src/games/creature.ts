// Draw & Alive, pure logic: how the drawn creature behaves once it is alive.
// It comes to the child's hand to be petted, jumps when the child jumps, hides
// when the child covers their eyes and pops out ("boo!") when they look again.
// Everything is in screen pixels, scaled by the child's shoulder width (unit).

import type { Pt } from '../shared/body';
import type { Move, Personality } from '../shared/creature-api';
import { mulberry32 } from './rng';

export interface Arena {
  left: number;
  right: number;
  top: number;
  /** Where walking creatures stand (the child's feet). */
  ground: number;
  /** Shoulder width in pixels. */
  unit: number;
}

export interface Kid {
  hands: ReadonlyArray<Pt | null>;
  head: Pt | null;
  /** Middle of the shoulders. */
  center: Pt | null;
  /** The lower ankle (feet leave the floor in a real jump, not when standing up). */
  feet?: Pt | null;
  /**
   * The hands that may pet (per hand; null when hanging at the side). Defaults
   * to all hands. Head and body never pet.
   */
  touchHands?: ReadonlyArray<Pt | null>;
  /** Lifted feet: a kick touches too. */
  kicks?: ReadonlyArray<Pt | null>;
}

export type Mood = 'arrive' | 'roam' | 'follow' | 'happy' | 'hide' | 'sleep';

export type CreatureEvent =
  | { type: 'touch'; count: number }
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'hide' }
  | { type: 'boo' }
  | { type: 'sleep' }
  | { type: 'wake' };

interface Style {
  speed: number;
  /** Keeps this far from hands (creature heights) until petted twice. */
  shyDistance: number;
  hopEvery: number;
  wobble: number;
}

const STYLES: Record<Personality, Style> = {
  bouncy: { speed: 2.4, shyDistance: 0, hopEvery: 0.45, wobble: 1 },
  shy: { speed: 1.6, shyDistance: 0.9, hopEvery: 0.7, wobble: 0.7 },
  silly: { speed: 2.1, shyDistance: 0, hopEvery: 0.55, wobble: 1.6 },
  sleepy: { speed: 1.1, shyDistance: 0, hopEvery: 0.9, wobble: 0.6 },
};

/** Creature size (its larger side) in shoulder widths. */
export const SIZE_UNITS = 1.5;
const GRAVITY = 14; // creature heights / s²
const TOUCH_COOLDOWN = 1;
const COVER_HOLD = 0.35;
const UNCOVER_HOLD = 0.25;
const SLEEP_AFTER = 7;

export class Creature {
  x: number;
  /** Feet position (bottom centre). */
  y: number;
  size: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  /** Squash (+) and stretch (−), springy. */
  squash = 0;
  private squashV = 0;
  /** Spin angle (silly creatures and big jumps). */
  spin = 0;
  mood: Mood = 'arrive';
  age = 0;
  blink = 0;
  fun = 0;
  touches = 0;
  readonly style: Style;
  private airborne = true;
  private touchCooldown = 0;
  private happyFor = 0;
  private hopIn = 0;
  private roamTarget: number | null = null;
  private roamIn = 0;
  private blinkIn = 2;
  private quietFor = 0;
  private covered = 0;
  private uncovered = 0;
  private headBase: number | null = null;
  private lastHeadY: number | null = null;
  private headVel = 0;
  private feetBase: number | null = null;
  private jumpCooldown = 0;
  private handPrev: Array<Pt | null> = [null, null];
  /** Smoothed hand speeds (px/s): only a moving hand pets. */
  private handSpeed = [0, 0];
  private rand: () => number;

  constructor(
    readonly personality: Personality,
    readonly move: Move,
    start: Pt,
    startSize: number,
    seed: number,
    /** The drawing's width and height relative to its larger side (each ≤ 1). */
    readonly dims: { w: number; h: number } = { w: 1, h: 1 },
  ) {
    this.style = STYLES[personality];
    this.x = start.x;
    this.y = start.y;
    this.size = startSize;
    this.rand = mulberry32(seed);
  }

  get flies(): boolean {
    return this.move === 'fly' || this.move === 'swim';
  }

  /** Centre of the body (where hands touch it). */
  get middle(): Pt {
    return { x: this.x, y: this.y - this.size * this.dims.h * 0.5 };
  }

  /** Half the touchable width and height (thin drawings stay easy to touch). */
  get reach(): { x: number; y: number } {
    return { x: this.size * Math.max(this.dims.w, 0.6) * 0.55, y: this.size * Math.max(this.dims.h, 0.6) * 0.55 };
  }

  update(dt: number, arena: Arena, kid: Kid): CreatureEvent[] {
    const events: CreatureEvent[] = [];
    this.age += dt;
    this.touchCooldown = Math.max(0, this.touchCooldown - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.happyFor = Math.max(0, this.happyFor - dt);

    // Grow or shrink smoothly to its play size.
    const target = arena.unit * SIZE_UNITS * (this.flies ? 0.9 : 1);
    this.size += (target - this.size) * Math.min(1, dt * 2.5);

    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blink = 0.15;
      this.blinkIn = 2 + this.rand() * 3;
    }
    this.blink = Math.max(0, this.blink - dt);

    const hands = kid.hands.filter((h): h is Pt => !!h);
    for (let i = 0; i < 2; i++) {
      const h = kid.hands[i] || null;
      const prev = this.handPrev[i];
      const v = h && prev && dt > 0 ? Math.sqrt((h.x - prev.x) * (h.x - prev.x) + (h.y - prev.y) * (h.y - prev.y)) / dt : 0;
      this.handSpeed[i] += (v - this.handSpeed[i]) * Math.min(1, dt * 10);
      this.handPrev[i] = h ? { x: h.x, y: h.y } : null;
    }
    this.watchKid(dt, arena, kid, hands, events);

    // Touches: a moving, reaching hand or a kick (a hand that just rests there,
    // the head and the body don't count).
    const mid = this.middle;
    const reach = this.reach;
    const on = (p: Pt) => Math.abs(p.x - mid.x) < reach.x && Math.abs(p.y - mid.y) < reach.y;
    const petters = kid.touchHands || kid.hands;
    let touching = false;
    for (let i = 0; i < 2; i++) {
      const h = petters[i];
      if (h && this.handSpeed[i] > arena.unit * 0.8 && on(h)) touching = true;
    }
    for (const f of kid.kicks || []) if (f && on(f)) touching = true;
    touching = touching && this.mood !== 'hide';
    if (touching && this.touchCooldown === 0 && this.mood !== 'arrive') {
      this.touchCooldown = TOUCH_COOLDOWN;
      this.touches++;
      this.fun++;
      this.quietFor = 0;
      if (this.mood === 'sleep') events.push({ type: 'wake' });
      this.mood = 'happy';
      this.happyFor = 1.1;
      this.squashV -= 6;
      events.push({ type: 'touch', count: this.touches });
    }

    if (this.mood === 'happy' && this.happyFor === 0) this.mood = 'roam';
    if (this.mood === 'hide') {
      this.quietFor = 0;
    } else if (this.mood !== 'sleep' && this.mood !== 'arrive') {
      this.quietFor += dt;
      if (this.personality === 'sleepy' && this.quietFor > SLEEP_AFTER && (this.flies || !this.airborne)) {
        this.mood = 'sleep';
        events.push({ type: 'sleep' });
      }
    }

    this.steer(dt, arena, kid, hands);
    this.physics(dt, arena, events);
    return events;
  }

  /** Jump mirroring and peekaboo, from the child's head and hands. */
  private watchKid(dt: number, arena: Arena, kid: Kid, hands: Pt[], events: CreatureEvent[]): void {
    const unit = arena.unit;
    const head = kid.head;
    if (head) {
      if (this.lastHeadY !== null && dt > 0) {
        const v = (head.y - this.lastHeadY) / dt;
        this.headVel += (v - this.headVel) * Math.min(1, dt * 12);
      }
      this.lastHeadY = head.y;
      // Where the head is when standing: it rises with the head fairly quickly but
      // sinks only slowly, so standing up after crouching is not "above" it.
      if (this.headBase === null) this.headBase = head.y;
      else this.headBase += (head.y - this.headBase) * Math.min(1, dt * (head.y < this.headBase ? 0.8 : 0.1));
      const up = this.headBase - head.y;
      // In a real jump the feet leave the floor too.
      const feet = kid.feet || null;
      let feetUp = true;
      if (feet) {
        if (this.feetBase === null) this.feetBase = feet.y;
        feetUp = this.feetBase - feet.y > unit * 0.12;
        this.feetBase += (feet.y - this.feetBase) * Math.min(1, dt * 1.5);
      } else {
        this.feetBase = null;
      }
      if (up > unit * 0.3 && feetUp && this.headVel < -unit * 1.6 && this.jumpCooldown === 0 && this.mood !== 'hide') {
        this.jumpCooldown = 0.9;
        this.fun++;
        this.quietFor = 0;
        if (this.mood === 'sleep') events.push({ type: 'wake' });
        if (this.mood === 'sleep' || this.mood === 'arrive') this.mood = 'roam';
        this.jump(1.1);
        events.push({ type: 'jump' });
      }
    } else {
      this.lastHeadY = null;
      this.headVel = 0;
    }

    // Peekaboo: both hands on the face.
    const cover = !!head && hands.length === 2 && hands.every((h) => Math.abs(h.x - head.x) < unit * 0.75 && Math.abs(h.y - head.y) < unit * 0.7);
    if (cover) {
      this.covered += dt;
      this.uncovered = 0;
    } else {
      this.uncovered += dt;
      this.covered = 0;
    }
    if (this.mood !== 'hide' && this.mood !== 'arrive' && this.covered >= COVER_HOLD) {
      this.mood = 'hide';
      events.push({ type: 'hide' });
    } else if (this.mood === 'hide' && this.uncovered >= UNCOVER_HOLD) {
      this.mood = 'happy';
      this.happyFor = 1.2;
      this.fun++;
      this.jump(1.3);
      events.push({ type: 'boo' });
    }
  }

  private jump(heights: number): void {
    if (this.flies) {
      this.vy = -Math.sqrt(2 * GRAVITY * heights) * this.size * 0.6;
      this.spin = Math.PI * 2;
    } else if (!this.airborne) {
      this.vy = -Math.sqrt(2 * GRAVITY * heights) * this.size;
      this.airborne = true;
      this.squashV += 5;
    }
  }

  /** Picks where to go and accelerates toward it. */
  private steer(dt: number, arena: Arena, kid: Kid, hands: Pt[]): void {
    const s = this.size;
    const unit = arena.unit;
    const home = kid.center ? kid.center.x : (arena.left + arena.right) / 2;
    let tx = this.x;
    let ty: number | null = null;

    if (this.mood === 'arrive') {
      if (!this.flies && !this.airborne) this.mood = 'roam';
      if (this.flies && this.age > 1.2) this.mood = 'roam';
    }

    const asleep = this.mood === 'sleep' || this.mood === 'hide';
    // The nearest hand that reaches out (away from the body or up to the chest,
    // and below the head); hands resting at the sides are ignored.
    let near: Pt | null = null;
    let nearD = Infinity;
    for (const h of hands) {
      const d = Math.abs(h.x - this.x);
      const c = kid.center;
      const reaching = !c || Math.abs(h.x - c.x) > unit * 0.9 || h.y < c.y + unit * 0.5;
      if (d < nearD && reaching && (!kid.head || h.y > kid.head.y)) {
        near = h;
        nearD = d;
      }
    }
    if (!asleep && this.mood !== 'arrive' && near) {
      this.mood = this.mood === 'happy' ? 'happy' : 'follow';
      const keep = this.personality === 'shy' && this.touches < 2 ? s * this.style.shyDistance : 0;
      const side = this.x >= near.x ? 1 : -1;
      // walkers wait under the hand; fliers hover just beside it, to be caught
      tx = near.x + side * (keep + (this.flies ? s * this.dims.w * 0.9 : 0));
      if (this.flies) ty = near.y + s * this.dims.h * 0.5 + keep * 0.3;
      this.roamTarget = null;
    } else if (!asleep && this.mood !== 'arrive') {
      if (this.mood === 'follow') this.mood = 'roam';
      this.roamIn -= dt;
      if (this.roamTarget === null || this.roamIn <= 0 || Math.abs(this.roamTarget - this.x) < s * 0.2) {
        const side = this.rand() < 0.5 ? -1 : 1;
        this.roamTarget = home + side * unit * (1.3 + this.rand() * 1.2);
        this.roamIn = 2 + this.rand() * 2;
      }
      tx = this.roamTarget;
      if (this.flies) ty = (kid.center ? kid.center.y : arena.ground - unit * 2) + Math.sin(this.age * 0.9) * unit * 0.6;
    }

    const halfW = s * this.dims.w * 0.5;
    tx = Math.max(arena.left + halfW, Math.min(arena.right - halfW, tx));
    const maxV = s * this.style.speed * (this.mood === 'happy' ? 1.3 : 1);
    if (asleep) {
      this.vx *= Math.max(0, 1 - dt * 6);
    } else {
      const want = Math.max(-maxV, Math.min(maxV, (tx - this.x) * 3));
      this.vx += (want - this.vx) * Math.min(1, dt * 5);
    }
    if (Math.abs(this.vx) > s * 0.15) this.facing = this.vx > 0 ? 1 : -1;

    if (this.flies) {
      const goal = ty !== null ? Math.max(arena.top + s, Math.min(arena.ground, ty)) : this.y;
      if (!asleep) this.vy += ((goal - this.y) * 4 - this.vy) * Math.min(1, dt * 3);
      else this.vy *= Math.max(0, 1 - dt * 4);
    }

    // Hoppers (and silly walkers) bounce along while moving.
    const moving = Math.abs(this.vx) > s * 0.4;
    if (!this.flies && !asleep && this.mood !== 'arrive') {
      this.hopIn -= dt;
      const hops = this.move === 'hop' || this.personality === 'silly';
      if (hops && moving && this.hopIn <= 0 && !this.airborne) {
        this.hopIn = this.style.hopEvery;
        this.jump(0.35);
      }
    }
    if (this.personality === 'silly' && this.mood === 'happy' && this.spin === 0 && this.rand() < dt * 0.8) this.spin = Math.PI * 2;
  }

  private physics(dt: number, arena: Arena, events: CreatureEvent[]): void {
    this.x += this.vx * dt;
    if (this.flies) {
      this.y += this.vy * dt;
      if (this.mood !== 'arrive') this.y = Math.max(arena.top + this.size, Math.min(arena.ground, this.y));
    } else {
      if (this.airborne || this.y < arena.ground - 1) {
        this.airborne = true;
        this.vy += GRAVITY * this.size * dt;
        this.y += this.vy * dt;
        if (this.y >= arena.ground) {
          this.y = arena.ground;
          if (this.vy > this.size * 2) {
            this.squashV += Math.min(8, (this.vy / this.size) * 0.9);
            events.push({ type: 'land' });
          }
          this.vy = 0;
          this.airborne = false;
        }
      } else {
        this.y = arena.ground;
      }
    }
    // springy squash
    this.squashV += (-this.squash * 90 - this.squashV * 9) * dt;
    this.squash = Math.max(-0.35, Math.min(0.35, this.squash + this.squashV * dt));
    if (this.spin > 0) this.spin = Math.max(0, this.spin - dt * Math.PI * 3);
  }
}

/** Stars for the results screen, from pets, jumps and peekaboos (always at least one, like Tickle Pop). */
export function funStars(fun: number): number {
  return fun >= 14 ? 3 : fun >= 6 ? 2 : 1;
}
