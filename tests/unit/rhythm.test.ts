import { describe, expect, it } from 'vitest';
import { GOOD_SEC, LEAD_SEC, makeChart, PERFECT_SEC, RhythmGame, rhythmStars, spotLayout, SPOTS, type RhythmEvent, type SpotId } from '../../src/games/rhythm';

const PULSE = 120 / 112;
const DT = 1 / 30;

/** Runs the game from `from` to `to` with `touching`, collecting events. */
function run(g: RhythmGame, from: number, to: number, touching: (spot: SpotId, t: number) => boolean): RhythmEvent[] {
  const out: RhythmEvent[] = [];
  for (let t = from; t <= to + 1e-9; t += DT) out.push(...g.update(t, (s) => touching(s, t)));
  return out;
}

describe('rhythm stars', () => {
  it('always gives at least one star', () => {
    expect(rhythmStars(0, 10)).toBe(1);
    expect(rhythmStars(0, 0)).toBe(1);
    expect(rhythmStars(4, 10)).toBe(2);
    expect(rhythmStars(7, 10)).toBe(3);
  });
});

describe('rhythm chart', () => {
  it('lands every bubble on a pulse, in order, and starts with hands only', () => {
    const chart = makeChart({ durationSec: 60, pulseSec: PULSE, seed: 7 });
    expect(chart.length).toBeGreaterThan(10);
    expect(chart[0].hitTime).toBeCloseTo(3 * PULSE);
    for (let i = 0; i < chart.length; i++) {
      const k = chart[i].hitTime / PULSE;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      if (i) expect(chart[i].hitTime).toBeGreaterThanOrEqual(chart[i - 1].hitTime);
      if (chart[i].hitTime < 60 * 0.3) expect(chart[i].spot.indexOf('hand')).toBe(0);
      expect(chart[i].hitTime).toBeLessThan(60);
    }
    expect(chart.some((c) => c.spot.indexOf('foot') === 0)).toBe(true);
  });

  it('is the same for the same seed', () => {
    const cfg = { durationSec: 60, pulseSec: PULSE, seed: 3 };
    expect(makeChart(cfg)).toEqual(makeChart(cfg));
  });

  it('never puts two bubbles on one spot at the same time', () => {
    let doubles = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const chart = makeChart({ durationSec: 60, pulseSec: PULSE, seed });
      for (const spot of SPOTS) {
        const times = chart.filter((c) => c.spot === spot).map((c) => c.hitTime);
        // the next bubble appears only after the previous one is gone
        for (let i = 1; i < times.length; i++) expect(times[i] - LEAD_SEC).toBeGreaterThan(times[i - 1] + GOOD_SEC);
      }
      for (let i = 1; i < chart.length; i++) if (chart[i].hitTime === chart[i - 1].hitTime) doubles++;
    }
    expect(doubles).toBeGreaterThan(0); // two-hands-at-once happens
  });
});

describe('rhythm game', () => {
  const cfg = { durationSec: 16, pulseSec: PULSE, seed: 11 };

  it('shows a bubble LEAD_SEC before its beat and grades a pop on the beat as perfect', () => {
    const g = new RhythmGame(cfg);
    const first = g.notes[0];
    expect(run(g, 0, first.showTime - 0.1, () => false).filter((e) => e.type === 'show')).toHaveLength(0);
    expect(run(g, first.showTime, first.showTime + 0.05, () => false).some((e) => e.type === 'show' && e.note === first)).toBe(true);
    const events = run(g, first.showTime + 0.1, first.hitTime + 0.2, (s, t) => s === first.spot && t >= first.hitTime - 0.05);
    const hit = events.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.grade).toBe('perfect');
    expect(g.hits).toBe(1);
    expect(g.perfects).toBe(1);
  });

  it('grades a late pop as good and an early one as pop', () => {
    const late = new RhythmGame(cfg);
    const n = late.notes[0];
    run(late, 0, n.hitTime + PERFECT_SEC + 0.1, (s, t) => s === n.spot && t >= n.hitTime + PERFECT_SEC + 0.05);
    expect(n.grade).toBe('good');

    const early = new RhythmGame(cfg);
    const m = early.notes[0];
    run(early, 0, m.hitTime, (s, t) => s === m.spot && t >= m.showTime + 0.5);
    expect(m.grade).toBe('pop');
  });

  it('lets an untouched bubble float away after its beat', () => {
    const g = new RhythmGame(cfg);
    const n = g.notes[0];
    const events = run(g, 0, n.hitTime + GOOD_SEC + 0.1, () => false);
    expect(events.some((e) => e.type === 'miss' && e.note === n)).toBe(true);
    expect(n.state).toBe('missed');
    expect(g.misses).toBe(1);
  });

  it('does not pop a bubble for a hand already resting on its spot until it moves off and back', () => {
    const g = new RhythmGame(cfg);
    const n = g.notes[0];
    // the hand rests on the spot from before the bubble appears up to its beat
    run(g, 0, n.hitTime, (s) => s === n.spot);
    expect(n.state).toBe('live');
    run(g, n.hitTime + DT, n.hitTime + 0.1, () => false);
    run(g, n.hitTime + 0.1 + DT, n.hitTime + 0.2, (s) => s === n.spot);
    expect(n.state).toBe('popped');
    expect(n.grade).toBe('perfect');
  });

  it('ends after the round with stars, and then stays quiet', () => {
    const g = new RhythmGame(cfg);
    // pop everything right on its beat
    const events = run(g, 0, 17, (s, t) => g.notes.some((n) => n.spot === s && n.state === 'live' && Math.abs(t - n.hitTime) < 0.05));
    const end = events.find((e) => e.type === 'end');
    expect(end && end.type === 'end' && end.hits).toBe(g.total);
    expect(end && end.type === 'end' && end.stars).toBe(3);
    expect(g.ended).toBe(true);
    expect(g.update(18, () => true)).toHaveLength(0);
    expect(g.remaining).toBe(0);
  });

  it('a child who never touches still gets one star', () => {
    const g = new RhythmGame(cfg);
    const events = run(g, 0, 17, () => false);
    const end = events.find((e) => e.type === 'end');
    expect(end && end.type === 'end' && end.stars).toBe(1);
    expect(g.misses).toBe(g.total);
  });
});

describe('rhythm spots', () => {
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };

  it('puts hand bubbles up and out, foot bubbles low beside the feet', () => {
    const s = 150;
    const { at, r } = spotLayout(960, 400, 950, s, rect);
    expect(at.handL.x).toBeLessThan(960 - s);
    expect(at.handR.x).toBeGreaterThan(960 + s);
    expect(at.handL.y).toBeLessThan(400);
    expect(at.footL.y).toBeGreaterThan(800);
    expect(at.footL.x).toBeLessThan(960);
    expect(at.footR.x).toBeGreaterThan(960);
    // no two spots overlap
    for (let i = 0; i < SPOTS.length; i++)
      for (let j = i + 1; j < SPOTS.length; j++) expect(Math.hypot(at[SPOTS[i]].x - at[SPOTS[j]].x, at[SPOTS[i]].y - at[SPOTS[j]].y)).toBeGreaterThan(r * 2);
  });

  it('keeps every bubble inside the picture when the child is at the edge', () => {
    for (const cx of [40, 1880]) {
      const { at, r } = spotLayout(cx, 60, 1075, 200, rect);
      for (const id of SPOTS) {
        expect(at[id].x - r).toBeGreaterThanOrEqual(0);
        expect(at[id].x + r).toBeLessThanOrEqual(1920);
        expect(at[id].y - r).toBeGreaterThanOrEqual(0);
        expect(at[id].y + r).toBeLessThanOrEqual(1080);
      }
    }
  });
});
