import { describe, expect, it } from 'vitest';
import { ClockSync } from '../../src/shared/clock';
import { containRect, toScreen } from '../../src/shared/mapping';
import { PoseTimeline } from '../../src/shared/sync';

describe('ClockSync', () => {
  it('uses the lowest-RTT sample', () => {
    const c = new ClockSync();
    expect(c.offset).toBeNull();
    // phone clock = tv clock + 5000
    c.add(100, 5000 + 150, 200); // rtt 100, symmetric -> offset 5000
    c.add(300, 5000 + 390, 310); // rtt 10, phone answered at tv=305+85 -> skewed but lower rtt
    expect(c.rtt).toBe(10);
    expect(c.offset).toBe(5000 + 390 - 305);
    expect(c.toTv(6000)).toBe(6000 - (5000 + 390 - 305));
  });

  it('ignores impossible samples', () => {
    const c = new ClockSync();
    c.add(100, 0, 50);
    c.add(0, 0, 10_000);
    expect(c.offset).toBeNull();
  });
});

describe('PoseTimeline', () => {
  const pose = (x: number) => [{ x, y: 0.5, visibility: 1 }];

  it('interpolates between samples and tolerates out-of-order arrival', () => {
    const tl = new PoseTimeline();
    tl.push({ t: 200, landmarks: pose(0.4) });
    tl.push({ t: 100, landmarks: pose(0.2) });
    expect(tl.sampleAt(150)![0].x).toBeCloseTo(0.3);
    expect(tl.sampleAt(50)![0].x).toBeCloseTo(0.2);
    expect(tl.sampleAt(250)![0].x).toBeCloseTo(0.4);
  });

  it('returns null for stale data and nearest when a body is missing', () => {
    const tl = new PoseTimeline();
    tl.push({ t: 0, landmarks: pose(0.1) });
    tl.push({ t: 100, landmarks: null });
    expect(tl.sampleAt(10)![0].x).toBeCloseTo(0.1);
    expect(tl.sampleAt(90)).toBeNull();
    expect(tl.sampleAt(1000)).toBeNull();
  });

  it('drops samples older than the window', () => {
    const tl = new PoseTimeline(1000);
    for (let t = 0; t <= 5000; t += 100) tl.push({ t, landmarks: pose(t / 5000) });
    expect(tl.size).toBe(11);
  });
});

describe('mapping', () => {
  it('fits 16:9 video into a 16:9 screen exactly', () => {
    expect(containRect(1280, 720, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('pillarboxes portrait video', () => {
    const r = containRect(720, 1280, 1920, 1080);
    expect(r.h).toBe(1080);
    expect(r.w).toBeCloseTo(607.5);
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2);
  });

  it('mirrors horizontally', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 };
    expect(toScreen(0.25, 0.5, r, true)).toEqual({ x: 85, y: 45 });
    expect(toScreen(0.25, 0.5, r, false)).toEqual({ x: 35, y: 45 });
  });
});
