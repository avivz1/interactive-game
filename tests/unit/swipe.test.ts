import { describe, expect, it } from 'vitest';
import { SWIPE_COOLDOWN_SEC, SwipeDetector } from '../../src/games/swipe';
import type { Pt } from '../../src/shared/body';

const U = 150;
const BAND = { top: 400, bottom: 700 };
const DT = 1 / 30;

/** Moves one hand from `a` to `b` over `sec` seconds; returns the swipes seen. */
function move(d: SwipeDetector, a: Pt, b: Pt, sec: number, hand = 0): number[] {
  const out: number[] = [];
  const steps = Math.max(1, Math.round(sec / DT));
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    const hands = hand === 0 ? [p, null] : [null, p];
    const r = d.update(hands, U, DT, BAND);
    if (r) out.push(r);
  }
  return out;
}

describe('swipe', () => {
  it('sees a quick sweep at chest height, either way, with either hand', () => {
    expect(move(new SwipeDetector(), { x: 700, y: 550 }, { x: 1000, y: 560 }, 0.35)).toEqual([1]);
    expect(move(new SwipeDetector(), { x: 1000, y: 550 }, { x: 700, y: 540 }, 0.35, 1)).toEqual([-1]);
  });

  it('ignores slow moves, short moves and mostly vertical ones', () => {
    expect(move(new SwipeDetector(), { x: 700, y: 550 }, { x: 1000, y: 550 }, 1.5)).toEqual([]);
    expect(move(new SwipeDetector(), { x: 700, y: 550 }, { x: 820, y: 550 }, 0.2)).toEqual([]);
    expect(move(new SwipeDetector(), { x: 700, y: 690 }, { x: 900, y: 420 }, 0.3)).toEqual([]);
  });

  it('ignores moves up among the bubbles (above the chest)', () => {
    expect(move(new SwipeDetector(), { x: 600, y: 250 }, { x: 1000, y: 260 }, 0.3)).toEqual([]);
  });

  it('counts one sweep once, then waits a moment', () => {
    const d = new SwipeDetector();
    const first = move(d, { x: 600, y: 550 }, { x: 1100, y: 550 }, 0.5);
    expect(first).toEqual([1]);
    // straight back at once: too soon
    expect(move(d, { x: 1100, y: 550 }, { x: 800, y: 550 }, SWIPE_COOLDOWN_SEC * 0.6)).toEqual([]);
  });

  it('starts over when the hand is lost', () => {
    const d = new SwipeDetector();
    move(d, { x: 700, y: 550 }, { x: 820, y: 550 }, 0.15);
    d.update([null, null], U, DT, BAND);
    expect(move(d, { x: 820, y: 550 }, { x: 900, y: 550 }, 0.1)).toEqual([]);
  });
});
