import { describe, expect, it } from 'vitest';
import { buildBody, palm } from '../../src/shared/body';
import { OneEuro, PoseSmoother } from '../../src/shared/filter';

describe('OneEuro', () => {
  it('reduces jitter on a still point', () => {
    const f = new OneEuro();
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const noisy = 0.5 + (i % 2 === 0 ? 0.01 : -0.01);
      const out = f.filter(noisy, i * 16.7);
      if (i > 30) maxDev = Math.max(maxDev, Math.abs(out - 0.5));
    }
    expect(maxDev).toBeLessThan(0.004);
  });

  it('follows fast motion with little lag', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i <= 30; i++) out = f.filter(i * 0.02, i * 16.7); // 1.2 units/s
    expect(Math.abs(out - 0.6)).toBeLessThan(0.05);
  });
});

describe('PoseSmoother', () => {
  const lm = (x: number, visibility: number) => [{ x, y: 0.5, visibility }];

  it('holds a lost point briefly, then drops it', () => {
    const s = new PoseSmoother({ threshold: 0.3, holdMs: 300 });
    expect(s.update(lm(0.4, 0.9), 0, 1)[0]!.x).toBeCloseTo(0.4);
    expect(s.update(lm(0.9, 0.1), 100, 1)[0]!.x).toBeCloseTo(0.4); // low confidence: held
    expect(s.update(null, 250, 1)[0]).not.toBeNull();
    expect(s.update(null, 401, 1)[0]).toBeNull();
  });

  it('uses points at or above the threshold', () => {
    const s = new PoseSmoother({ threshold: 0.3 });
    expect(s.update(lm(0.2, 0.3), 0, 1)[0]!.x).toBeCloseTo(0.2);
  });

  // a raised arm: shoulder, elbow and a wrist at (or past) the top edge of the picture
  const arm = (wristVis: number, elbowVis = 0.9) => {
    const pts = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 0 }));
    pts[11] = { x: 0.6, y: 0.4, visibility: 0.9 };
    pts[13] = { x: 0.62, y: 0.12, visibility: elbowVis };
    pts[15] = { x: 0.63, y: -0.03, visibility: wristVis };
    return pts;
  };

  it('keeps a hand at the edge of the picture while the arm leading to it is seen', () => {
    const s = new PoseSmoother();
    for (let t = 0; t <= 2000; t += 33) expect(s.update(arm(0.15), t)[15]).not.toBeNull();
  });

  it('drops a low-confidence hand when the arm is not seen either', () => {
    const s = new PoseSmoother();
    s.update(arm(0.9), 0);
    expect(s.update(arm(0.15, 0.1), 300)[15]).not.toBeNull(); // held a while
    expect(s.update(arm(0.15, 0.1), 700)[15]).toBeNull();
  });

  it('never accepts a low-confidence point in the middle of the picture', () => {
    const s = new PoseSmoother();
    const pts = arm(0.15);
    pts[15] = { x: 0.5, y: 0.5, visibility: 0.15 };
    expect(s.update(pts, 0)[15]).toBeNull();
  });
});

describe('body', () => {
  it('extends the forearm to find the palm', () => {
    expect(palm({ x: 10, y: 10 }, { x: 0, y: 0 })).toEqual({ x: 13.5, y: 13.5 });
    expect(palm({ x: 10, y: 10 }, null)).toEqual({ x: 10, y: 10 });
    expect(palm(null, { x: 0, y: 0 })).toBeNull();
  });

  it('builds mirrored screen points and sizes', () => {
    const pts = new Array(33).fill(null);
    pts[11] = { x: 0.6, y: 0.4, visibility: 1 }; // left shoulder
    pts[12] = { x: 0.4, y: 0.4, visibility: 1 }; // right shoulder
    pts[0] = { x: 0.5, y: 0.25, visibility: 1 };
    const body = buildBody(pts, { x: 0, y: 0, w: 1000, h: 500 }, true);
    expect(body.shoulderWidth).toBeCloseTo(200);
    expect(body.points[11]!.x).toBeCloseTo(400); // mirrored
    expect(body.head).toEqual({ x: 500, y: 125 });
    expect(body.headRadius).toBeCloseTo(70);
    expect(body.hands).toEqual([null, null]);
  });

  it('keeps a palm that reaches past the edge of the picture just inside it', () => {
    const pts = new Array(33).fill(null);
    pts[11] = { x: 0.6, y: 0.4, visibility: 1 };
    pts[12] = { x: 0.4, y: 0.4, visibility: 1 };
    pts[13] = { x: 0.62, y: 0.1, visibility: 1 }; // elbow
    pts[15] = { x: 0.63, y: -0.02, visibility: 1 }; // wrist above the picture
    const rect = { x: 100, y: 0, w: 800, h: 500 };
    const body = buildBody(pts, rect, true);
    const hand = body.hands[0]!;
    expect(hand.y).toBeGreaterThan(rect.y);
    expect(hand.x).toBeGreaterThan(rect.x);
    expect(hand.x).toBeLessThan(rect.x + rect.w);
    // reported as moved, so drawing can lift the pen
    expect(body.handsClamped).toEqual([true, false]);
  });
});
