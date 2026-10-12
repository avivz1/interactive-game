import { describe, expect, it } from 'vitest';
import { FreezeDance, freezeStars, GRACE_SEC, INTRO_SEC, MotionMeter, type FreezeEvent } from '../../src/games/freeze-dance';
import type { Pt } from '../../src/shared/body';

const DT = 1 / 30;

function run(game: FreezeDance, sec: number, motion: (g: FreezeDance) => number): FreezeEvent[] {
  const out: FreezeEvent[] = [];
  for (let t = 0; t < sec; t += DT) out.push(...game.update(DT, motion(game)));
  return out;
}

/** Dances during the music; during freezes moves only if `wiggle` says so. */
const kid = (wiggle: boolean) => (g: FreezeDance) => (g.phase === 'dance' ? 3 : g.phase === 'freeze' && wiggle ? 2 : 0.2);

describe('Freeze Dance', () => {
  it('starts with the intro, then dance, then freeze', () => {
    const game = new FreezeDance({ durationSec: 60, seed: 1 });
    expect(game.phase).toBe('intro');
    const events = run(game, INTRO_SEC + 5.2, kid(false));
    expect(events.map((e) => e.type)).toEqual(['dance', 'freeze']);
    expect(game.phase).toBe('freeze');
  });

  it('a still child is a statue', () => {
    const game = new FreezeDance({ durationSec: 60, seed: 2 });
    const events = run(game, INTRO_SEC + 5 + game.checkLength + 0.2, kid(false));
    expect(events.some((e) => e.type === 'statue')).toBe(true);
    expect(game.statues).toBe(1);
  });

  it('wiggling during the check is a wiggle, but moving right after "Freeze!" is forgiven', () => {
    const game = new FreezeDance({ durationSec: 60, seed: 3 });
    run(game, INTRO_SEC + 5.05, kid(false));
    expect(game.phase).toBe('freeze');
    // still moving for the grace time only: still a statue
    const forgiven = run(game, game.checkLength + 0.1, (g) => (g.checkLength - g.phaseLeft < GRACE_SEC - 0.05 ? 3 : 0.2));
    expect(forgiven.some((e) => e.type === 'statue')).toBe(true);

    const wiggly = new FreezeDance({ durationSec: 60, seed: 3 });
    const events = run(wiggly, INTRO_SEC + 5 + wiggly.checkLength + 0.2, kid(true));
    expect(events.some((e) => e.type === 'wiggle')).toBe(true);
    expect(wiggly.statues).toBe(0);
  });

  it('ends after the round with at least one star', () => {
    const game = new FreezeDance({ durationSec: 20, seed: 4 });
    const events = run(game, 60, kid(true));
    const end = events.find((e) => e.type === 'end') as { stars: number; freezes: number } | undefined;
    expect(end).toBeDefined();
    expect(end!.stars).toBe(1);
    expect(end!.freezes).toBeGreaterThanOrEqual(1);
    expect(game.update(DT, 0)).toEqual([]);
    expect([0, 3, 5].map(freezeStars)).toEqual([1, 2, 3]);
  });

  it('dances last 4–8 s so the stop is a surprise', () => {
    const game = new FreezeDance({ durationSec: 300, seed: 5 });
    const lengths: number[] = [];
    let start = -1;
    let t = 0;
    for (; t < 200; t += DT) {
      for (const e of game.update(DT, 0.2)) {
        if (e.type === 'dance') start = t;
        if (e.type === 'freeze' && start >= 0) lengths.push(t - start);
      }
    }
    expect(lengths.length).toBeGreaterThan(5);
    for (const l of lengths.slice(1)) {
      expect(l).toBeGreaterThanOrEqual(4 - 0.1);
      expect(l).toBeLessThanOrEqual(8 + 0.1);
    }
  });
});

describe('motion meter', () => {
  const pose = (dx: number, jitterJoint = -1, jitter = 0): Array<Pt | null> => {
    const pts: Array<Pt | null> = [];
    for (let i = 0; i < 33; i++) pts.push({ x: 500 + dx + (i === jitterJoint ? jitter : 0), y: 100 + i * 10 });
    return pts;
  };

  it('is about zero when standing still, even if one body point glitches', () => {
    const m = new MotionMeter();
    for (let i = 0; i < 30; i++) m.update(pose(0, 23, i % 2 ? 40 : -40), 150, DT);
    expect(m.value).toBeLessThan(0.2);
  });

  it('stays below the wiggle line with normal small tracking jitter', () => {
    const m = new MotionMeter();
    let max = 0;
    for (let i = 0; i < 90; i++) {
      const pts = pose(0).map((p, j) => (p ? { x: p.x + Math.sin(i * 1.7 + j) * 1.5, y: p.y + Math.cos(i * 1.3 + j) * 1.5 } : p));
      max = Math.max(max, m.update(pts, 150, DT));
    }
    expect(max).toBeLessThan(1);
  });

  it('catches one hand waving from a still elbow', () => {
    const m = new MotionMeter();
    let max = 0;
    for (let i = 0; i < 60; i++) {
      const pts = pose(0);
      pts[15] = { x: 500 + Math.sin(i * 0.31) * 70, y: 250 + Math.cos(i * 0.31) * 20 };
      max = Math.max(max, m.update(pts, 150, DT));
    }
    expect(max).toBeGreaterThan(1);
  });

  it('measures dancing in shoulder widths per second', () => {
    const m = new MotionMeter();
    // the whole body sways 150 px (one shoulder width) per second
    for (let i = 0; i < 60; i++) m.update(pose(i * 5), 150, DT);
    expect(m.value).toBeGreaterThan(0.8);
    expect(m.value).toBeLessThan(1.2);
  });

  it('sees a waving arm', () => {
    const m = new MotionMeter();
    for (let i = 0; i < 60; i++) {
      const pts = pose(0);
      const wave = Math.sin(i * 0.5) * 80;
      for (const j of [11, 13, 15]) pts[j] = { x: 500 + wave * (j === 15 ? 1 : j === 13 ? 0.6 : 0.2), y: 100 + j * 10 };
      m.update(pts, 150, DT);
    }
    expect(m.value).toBeGreaterThan(1);
  });
});

describe('Freeze Dance timing', () => {
  it('a later picture gets a longer grace time', () => {
    const game = new FreezeDance({ durationSec: 60, seed: 6 });
    for (let t = 0; t < INTRO_SEC + 5.05; t += DT) game.update(DT, 3, 0.25);
    expect(game.phase).toBe('freeze');
    expect(game.grace).toBeCloseTo(GRACE_SEC + 0.25);
    // still moving 1.15 s after "Freeze!" (inside the longer grace) is forgiven
    const events: FreezeEvent[] = [];
    for (let t = 0; t < game.checkLength + 0.1; t += DT) events.push(...game.update(DT, t < 1.15 ? 3 : 0.2, 0.25));
    expect(events.some((e) => e.type === 'statue')).toBe(true);
  });

  it('a freeze the child missed (out of the picture) starts over', () => {
    const game = new FreezeDance({ durationSec: 60, seed: 7 });
    const wobble = INTRO_SEC + 5.05 + 1.2;
    for (let t = 0; t < INTRO_SEC + 5.05 + 2; t += DT) game.update(DT, t > wobble && t < wobble + 0.3 ? 3 : 0.2);
    expect(game.phase).toBe('freeze');
    expect(game.wiggleTime).toBeGreaterThan(0);
    game.restartCheck();
    expect(game.wiggleTime).toBe(0);
    expect(game.phaseLeft).toBeCloseTo(game.checkLength);
  });

  it('does not start a new dance with too little time left', () => {
    const game = new FreezeDance({ durationSec: 13, seed: 8 });
    const events: FreezeEvent[] = [];
    for (let t = 0; t < 40; t += DT) events.push(...game.update(DT, 0.2));
    const end = events.findIndex((e) => e.type === 'end');
    expect(end).toBeGreaterThan(0);
    // the round ends within a few seconds of the timer
    expect(game.elapsed).toBeLessThan(13 + 8 + 3 + 1.6);
  });
});
