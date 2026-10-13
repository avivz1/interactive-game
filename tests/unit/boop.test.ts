import { describe, expect, it } from 'vitest';
import { BoopGame, boopStars, FLY_SEC, HOP_SEC, IDLE_SEC, WAIT_SEC, type BoopEnv, type BoopEvent, type BoopHits, type Critter } from '../../src/games/boop';
import type { Pt } from '../../src/shared/body';

const DT = 1 / 30;
const U = 150;
const RECT = { x: 0, y: 0, w: 1920, h: 1080 };
const ENV: BoopEnv = { cx: 960, shoulderY: 400, floor: 900, unit: U, rect: RECT };
const NONE: BoopHits = { hands: [], feet: [], handRadius: U * 0.28, footRadius: U * 0.3 };
const hand = (p: Pt): BoopHits => ({ ...NONE, hands: [{ x: p.x, y: p.y }] });

function run(g: BoopGame, sec: number, hits: BoopHits | ((t: number) => BoopHits) = NONE, env = ENV): BoopEvent[] {
  const out: BoopEvent[] = [];
  for (let t = 0; t < sec - 1e-9; t += DT) out.push(...g.update(DT, env, typeof hits === 'function' ? hits(t) : hits));
  return out;
}

const sitting = (c: Critter) => c.stage < 3 && c.hop >= 1 && c.wait <= 0;
const head = (env: BoopEnv) => ({ x: env.cx, y: env.shoulderY - env.unit * 0.75 });

/** Boops `c` once (it must be sitting and armed) and returns that step's events. */
function boop(g: BoopGame, c: Critter, env = ENV): BoopEvent[] {
  expect(sitting(c)).toBe(true);
  return g.update(DT, env, hand(c));
}

/** Waits until `c` sits again (after its hop). */
function settle(g: BoopGame, c: Critter, env = ENV): void {
  for (let i = 0; i < 200 && !sitting(c); i++) g.update(DT, env, NONE);
  g.update(DT, env, NONE); // one step with nothing on it: armed
}

describe('boop stars', () => {
  it('always gives at least one star', () => {
    expect(boopStars(0)).toBe(1);
    expect(boopStars(4)).toBe(2);
    expect(boopStars(8)).toBe(3);
  });
});

describe('boop game', () => {
  it('drops two eggs in up high, inside the picture, apart and off the face', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = new BoopGame({ durationSec: 60, seed });
      const events = run(g, 3);
      expect(events.filter((e) => e.type === 'arrive')).toHaveLength(2);
      expect(g.critters).toHaveLength(2);
      for (const c of g.critters) {
        expect(c.stage).toBe(0);
        expect(sitting(c)).toBe(true);
        expect(c.zone).toBe('high');
        expect(c.x - c.r).toBeGreaterThanOrEqual(0);
        expect(c.x + c.r).toBeLessThanOrEqual(1920);
        expect(c.y - c.r).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(c.x - head(ENV).x, c.y - head(ENV).y)).toBeGreaterThanOrEqual(c.r + U * 0.6 - 1);
      }
      const [a, b] = g.critters;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + U * 0.3 - 1);
    }
  });

  it('a boop hatches the egg, which then hops somewhere new', () => {
    const g = new BoopGame({ durationSec: 60, seed: 3 });
    run(g, 3);
    const c = g.critters[0];
    const was = { x: c.x, y: c.y };
    const events = boop(g, c);
    expect(events.some((e) => e.type === 'boop' && e.critter === c && e.stage === 1)).toBe(true);
    expect(c.stage).toBe(1);
    expect(g.boops).toBe(1);
    // the hand stays where the egg was: no more boops while it waits and hops
    run(g, WAIT_SEC + HOP_SEC + 0.2, hand(was));
    expect(c.stage).toBe(1);
    expect(sitting(c)).toBe(true);
    expect(Math.hypot(c.x - was.x, c.y - was.y)).toBeGreaterThanOrEqual(U - 1);
  });

  it('a hand resting where it lands must move off and come back to boop', () => {
    const g = new BoopGame({ durationSec: 60, seed: 5 });
    run(g, 3);
    const c = g.critters[0];
    boop(g, c);
    // the hand waits right where it will land
    const landing = g.target(c, ENV);
    run(g, WAIT_SEC + HOP_SEC + 0.5, hand(landing));
    expect(sitting(c)).toBe(true);
    expect(c.stage).toBe(1);
    g.update(DT, ENV, NONE); // moves off
    g.update(DT, ENV, hand(c)); // and back
    expect(c.stage).toBe(2);
  });

  it('a lifted foot boops too', () => {
    const g = new BoopGame({ durationSec: 60, seed: 8 });
    run(g, 3);
    const c = g.critters[1];
    g.update(DT, ENV, { ...NONE, feet: [{ x: c.x, y: c.y }] });
    expect(c.stage).toBe(1);
  });

  it('the third boop turns it into a surprise that flies away, and a new egg comes', () => {
    const g = new BoopGame({ durationSec: 60, seed: 11 });
    run(g, 3);
    const c = g.critters[0];
    boop(g, c);
    settle(g, c);
    boop(g, c);
    settle(g, c);
    const events = boop(g, c);
    expect(events.some((e) => e.type === 'surprise' && e.critter === c)).toBe(true);
    expect(c.stage).toBe(3);
    expect(g.transformed).toBe(1);
    expect(g.boops).toBe(3);
    const more = run(g, FLY_SEC + 0.2);
    expect(g.critters.indexOf(c)).toBe(-1);
    expect(more.some((e) => e.type === 'arrive')).toBe(true);
    expect(g.critters.filter((x) => x.stage < 3)).toHaveLength(2);
  });

  it('an egg nobody reaches hops up high after a while', () => {
    const g = new BoopGame({ durationSec: 60, seed: 13 });
    run(g, 3);
    const events = run(g, IDLE_SEC + 0.5);
    expect(events.filter((e) => e.type === 'hop').length).toBeGreaterThanOrEqual(2);
    for (const c of g.critters) expect(c.zone).toBe('high');
  });

  it('never puts an egg down low when the feet are not in the picture', () => {
    const env = { ...ENV, floor: null };
    for (let seed = 1; seed <= 30; seed++) {
      const g = new BoopGame({ durationSec: 60, seed });
      // boop everything that sits, for a while
      for (let i = 0; i < 900; i++) {
        const target = g.critters.find((c) => sitting(c) && c.armed);
        g.update(DT, env, target && i % 2 === 0 ? hand(target) : NONE);
        for (const c of g.critters) expect(c.zone).not.toBe('low');
      }
      expect(g.boops).toBeGreaterThan(5);
    }
  });

  it('keeps critters inside the picture and off the face when the child stands by an edge', () => {
    for (const cx of [90, 1830])
      for (let seed = 1; seed <= 20; seed++) {
        const env = { ...ENV, cx };
        const g = new BoopGame({ durationSec: 60, seed });
        for (let i = 0; i < 900; i++) {
          const target = g.critters.find((c) => sitting(c) && c.armed);
          g.update(DT, env, target && i % 3 === 0 ? hand(target) : NONE);
          for (const c of g.critters) {
            if (!sitting(c)) continue;
            expect(c.x - c.r).toBeGreaterThanOrEqual(-0.5);
            expect(c.x + c.r).toBeLessThanOrEqual(1920.5);
            expect(Math.hypot(c.x - head(env).x, c.y - head(env).y)).toBeGreaterThanOrEqual(c.r);
          }
        }
      }
  });

  it('ends with the round, gives stars, then stays quiet', () => {
    const g = new BoopGame({ durationSec: 10, seed: 2 });
    const events = run(g, 10.1);
    const end = events.find((e) => e.type === 'end');
    expect(end && end.type === 'end' && end.stars).toBe(1);
    expect(g.ended).toBe(true);
    expect(g.remaining).toBe(0);
    expect(g.update(DT, ENV, NONE)).toHaveLength(0);
  });
});
