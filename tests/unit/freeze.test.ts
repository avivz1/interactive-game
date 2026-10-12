import { describe, expect, it } from 'vitest';
import { FREEZE_SEC, FreezeDance, freezeStars, GRACE_SEC, INTRO_SEC, MotionMeter, type FreezeEvent } from '../../src/games/freeze-dance';
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
    const events = run(game, INTRO_SEC + 5 + FREEZE_SEC + 0.2, kid(false));
    expect(events.some((e) => e.type === 'statue')).toBe(true);
    expect(game.statues).toBe(1);
  });

  it('wiggling during the check is a wiggle, but moving right after "Freeze!" is forgiven', () => {
    const game = new FreezeDance({ durationSec: 60, seed: 3 });
    run(game, INTRO_SEC + 5.05, kid(false));
    expect(game.phase).toBe('freeze');
    // still moving for the grace time only: still a statue
    const forgiven = run(game, FREEZE_SEC + 0.1, (g) => (FREEZE_SEC - g.phaseLeft < GRACE_SEC - 0.05 ? 3 : 0.2));
    expect(forgiven.some((e) => e.type === 'statue')).toBe(true);

    const wiggly = new FreezeDance({ durationSec: 60, seed: 3 });
    const events = run(wiggly, INTRO_SEC + 5 + FREEZE_SEC + 0.2, kid(true));
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

  it('is about zero when standing still, even if one point jitters', () => {
    const m = new MotionMeter();
    for (let i = 0; i < 30; i++) m.update(pose(0, 15, i % 2 ? 40 : -40), 150, DT);
    expect(m.value).toBeLessThan(0.2);
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
