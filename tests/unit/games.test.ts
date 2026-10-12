import { describe, expect, it } from 'vitest';
import { Dwell } from '../../src/games/dwell';
import { evaluateFit } from '../../src/games/fit';
import { mulberry32 } from '../../src/games/rng';
import { TicklePop, starsFor, type Envelope, type GameEvent, type Hits } from '../../src/games/tickle-pop';
import type { Landmark } from '../../src/shared/landmarks';

const env: Envelope = { centerX: 640, unit: 120, left: 0, right: 1280, top: 0, bottom: 720 };
const noHits: Hits = { hands: [], feet: [], handRadius: 40, footRadius: 40 };

function run(game: TicklePop, seconds: number, hits: (g: TicklePop) => Hits = () => noHits): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 30) events.push(...game.update(1 / 30, env, hits(game)));
  return events;
}

describe('TicklePop', () => {
  it('spawns bubbles inside the reach envelope', () => {
    const game = new TicklePop({ durationSec: 60, tickleSec: 0.45, seed: 7 });
    run(game, 5);
    expect(game.bubbles.length).toBeGreaterThan(0);
    for (const b of game.bubbles) {
      expect(b.baseX).toBeGreaterThanOrEqual(env.centerX - env.unit * 2.2);
      expect(b.baseX).toBeLessThanOrEqual(env.centerX + env.unit * 2.2);
    }
  });

  it('pops a bubble after it is tickled long enough, with giggle stages first', () => {
    const game = new TicklePop({ durationSec: 60, tickleSec: 0.45, seed: 3 });
    run(game, 1);
    const target = game.bubbles[0];
    expect(target.kind).toBe('normal');
    const events = run(game, 1, (g) => {
      const b = g.bubbles.find((x) => x.id === target.id);
      return { ...noHits, hands: b ? [{ x: b.x, y: b.y }] : [] };
    });
    const stages = events.filter((e) => e.type === 'giggle' && e.bubble.id === target.id).map((e) => (e as { stage: number }).stage);
    expect(stages).toEqual([1, 2, 3]);
    expect(events.some((e) => e.type === 'pop' && e.bubble.id === target.id)).toBe(true);
    expect(game.popped).toBeGreaterThanOrEqual(1);
  });

  it('sleepy bubbles nap near the feet and wake with a kick (or a hand)', () => {
    const game = new TicklePop({ durationSec: 60, tickleSec: 0.3, seed: 1 });
    game.bubbles.push({ id: 999, kind: 'sleepy', x: 600, y: env.bottom + 50, baseX: 600, r: 50, color: 0, tickle: 0, stage: 0, age: 0, phase: 0, touched: false });
    run(game, 4);
    const b = game.bubbles.find((x) => x.id === 999)!;
    // still napping at shin height, not floating away
    expect(b.y).toBeGreaterThan(env.bottom - env.unit * 1.5);
    const kicked = run(game, 0.6, (g) => {
      const n = g.bubbles.find((x) => x.id === 999);
      return { ...noHits, feet: n ? [{ x: n.x, y: n.y }] : [] };
    });
    expect(kicked.some((e) => e.type === 'pop' && e.bubble.id === 999 && e.cause === 'touch')).toBe(true);

    game.bubbles.push({ id: 1000, kind: 'sleepy', x: 300, y: 500, baseX: 300, r: 50, color: 0, tickle: 0, stage: 0, age: 0, phase: 0, touched: false });
    const byHand = run(game, 0.6, (g) => {
      const n = g.bubbles.find((x) => x.id === 1000);
      return { ...noHits, hands: n ? [{ x: n.x, y: n.y }] : [] };
    });
    expect(byHand.some((e) => e.type === 'pop' && e.bubble.id === 1000)).toBe(true);
  });

  it('sneezy bubbles pop their neighbours', () => {
    const game = new TicklePop({ durationSec: 60, tickleSec: 0.3, seed: 1 });
    const mk = (id: number, kind: 'sneezy' | 'normal', x: number) =>
      ({ id, kind, x, y: 400, baseX: x, r: 50, color: 0, tickle: kind === 'sneezy' ? 0.99 : 0, stage: 3, age: 0, phase: 0, touched: false });
    game.bubbles.push(mk(1, 'sneezy', 600), mk(2, 'normal', 680), mk(3, 'normal', 1100));
    const events = game.update(0.1, env, { ...noHits, hands: [{ x: 600, y: 400 }] });
    const popped = events.filter((e) => e.type === 'pop').map((e) => (e as { bubble: { id: number } }).bubble.id);
    expect(popped).toContain(1);
    expect(popped).toContain(2);
    expect(popped).not.toContain(3);
  });

  it('announces the finale and ends with at least one star', () => {
    const game = new TicklePop({ durationSec: 10, tickleSec: 0.45, seed: 2 });
    const events = run(game, 11);
    expect(events.filter((e) => e.type === 'finale')).toHaveLength(1);
    const end = events.find((e) => e.type === 'end') as { popped: number; stars: number };
    expect(end.stars).toBeGreaterThanOrEqual(1);
    expect(game.ended).toBe(true);
  });

  it('awards stars by bubbles popped', () => {
    expect(starsFor(0)).toBe(1);
    expect(starsFor(10)).toBe(2);
    expect(starsFor(25)).toBe(3);
  });

  it('is deterministic for a seed', () => {
    const a = new TicklePop({ durationSec: 60, tickleSec: 0.45, seed: 42 });
    const b = new TicklePop({ durationSec: 60, tickleSec: 0.45, seed: 42 });
    run(a, 6);
    run(b, 6);
    expect(a.bubbles.map((x) => [x.kind, Math.round(x.baseX)])).toEqual(b.bubbles.map((x) => [x.kind, Math.round(x.baseX)]));
  });
});

describe('Dwell', () => {
  it('fires after holding and drains when leaving', () => {
    const d = new Dwell(1000);
    expect(d.update(true, 600)).toBe(false);
    expect(d.update(false, 100)).toBe(false);
    expect(d.progress).toBeCloseTo(0.4);
    expect(d.update(true, 700)).toBe(true);
    expect(d.progress).toBe(0);
  });
});

describe('evaluateFit', () => {
  const body = (over: Record<number, Partial<Landmark> | null> = {}) => {
    const pts: (Landmark | null)[] = new Array(33).fill(null);
    const base: Record<number, [number, number]> = { 0: [0.5, 0.2], 11: [0.58, 0.33], 12: [0.42, 0.33], 23: [0.55, 0.6], 24: [0.45, 0.6], 27: [0.57, 0.9], 28: [0.43, 0.9] };
    for (const k in base) pts[Number(k)] = { x: base[k][0], y: base[k][1], visibility: 1 };
    for (const k in over) pts[Number(k)] = over[k] === null ? null : { ...(pts[Number(k)] as Landmark), ...over[k] };
    return pts;
  };

  it('accepts a whole body', () => expect(evaluateFit(body())).toBe('ok'));
  it('asks to step in', () => expect(evaluateFit(new Array(33).fill(null))).toBe('no-body'));
  it('asks to step back for the head', () => expect(evaluateFit(body({ 0: null }))).toBe('head-cut'));
  it('asks to step back for hips', () => expect(evaluateFit(body({ 23: null }))).toBe('too-close'));
  it('asks to step back for feet', () => expect(evaluateFit(body({ 27: { y: 0.99 } }))).toBe('feet-cut'));
  it('asks to come closer', () => expect(evaluateFit(body({ 11: { x: 0.52 }, 12: { x: 0.48 } }))).toBe('too-far'));
});

describe('mulberry32', () => {
  it('is in [0,1) and repeatable', () => {
    const r1 = mulberry32(5);
    const r2 = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(r2());
    }
  });
});

describe('menu layout', () => {
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };
  it('puts the game bubbles in an arc above the head, within raised-hand reach', async () => {
    const { menuLayout } = await import('../../src/tv/scenes/menu');
    const s = 150;
    const shoulderY = 500;
    const { r, at } = menuLayout(2, 960, shoulderY, s, rect);
    expect(at).toHaveLength(2);
    for (const p of at) {
      // above the head (head top is about one shoulder width above the shoulders)
      expect(p.y + r).toBeLessThanOrEqual(shoulderY - s * 0.85);
      // reachable: about 1.65 shoulder widths from the shoulders
      expect(Math.hypot(p.x - 960, p.y - shoulderY)).toBeLessThanOrEqual(s * 1.7);
    }
    expect(at[0].x).toBeGreaterThan(960); // first game on the right
    expect(at[1].x).toBeLessThan(960);
  });

  it('with little room above the head, stays high and clear of the face', async () => {
    const { menuLayout } = await import('../../src/tv/scenes/menu');
    const s = 150;
    const shoulderY = 180;
    const { r, at } = menuLayout(2, 960, shoulderY, s, rect);
    for (const p of at) {
      expect(p.y - r).toBeGreaterThanOrEqual(0); // inside the picture
      expect(p.y).toBeLessThan(shoulderY - s * 0.4); // still up high, not beside the body
      expect(Math.hypot(p.x - 960, p.y - (shoulderY - s * 0.75))).toBeGreaterThanOrEqual(s * 0.55 + r - 1); // not over the face
    }
  });
});

describe('menu layout with three games', () => {
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };
  for (const shoulderY of [180, 300, 500]) {
    it(`never overlaps bubbles or covers the face (shoulders at ${shoulderY})`, async () => {
      const { menuLayout } = await import('../../src/tv/scenes/menu');
      const s = 150;
      const { r, at } = menuLayout(3, 960, shoulderY, s, rect);
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++) expect(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y)).toBeGreaterThanOrEqual(r * 2);
      for (const p of at) {
        expect(Math.hypot(p.x - 960, p.y - (shoulderY - s * 0.75))).toBeGreaterThanOrEqual(r + s * 0.45);
        expect(p.y - r).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe('menu layout at the screen edge', () => {
  it('never stacks bubbles when the child stands at the side of the picture', async () => {
    const { menuLayout } = await import('../../src/tv/scenes/menu');
    const rect = { x: 0, y: 0, w: 1920, h: 1080 };
    for (const cx of [60, 200, 1720, 1860])
      for (const shoulderY of [180, 400]) {
        const { r, at } = menuLayout(3, cx, shoulderY, 150, rect);
        for (let i = 0; i < 3; i++)
          for (let j = i + 1; j < 3; j++) expect(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y)).toBeGreaterThanOrEqual(r * 2);
        for (const p of at) {
          expect(p.x - r).toBeGreaterThanOrEqual(0);
          expect(p.x + r).toBeLessThanOrEqual(1920);
        }
      }
  });
});
