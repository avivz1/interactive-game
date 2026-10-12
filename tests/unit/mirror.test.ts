import { describe, expect, it } from 'vitest';
import { angleDiff, HOLD_SEC, INTRO_SEC, matchPose, MirrorGame, mirrorStars, POSE_SEC, POSES, type MirrorEvent } from '../../src/games/mirror';
import type { Pt } from '../../src/shared/body';
import { LM } from '../../src/shared/landmarks';

const DT = 1 / 30;
const byId = (id: string) => POSES.find((p) => p.id === id)!;

/**
 * A child on screen (already mirrored): shoulders at x 450/550, y 300. `arms`
 * gives the screen-left and screen-right arm as [upperDeg, foreDeg].
 */
function child(arms: { l: [number, number]; r: [number, number] }, legs?: { l: number; r: number }, swapSides = false): Array<Pt | null> {
  const pts: Array<Pt | null> = new Array(33).fill(null);
  const at = (deg: number, from: Pt, len: number): Pt => ({ x: from.x + Math.cos((deg * Math.PI) / 180) * len, y: from.y + Math.sin((deg * Math.PI) / 180) * len });
  // body landmark "left" is on the right of the screen in a mirror, unless swapped
  const [L, R] = swapSides ? [LM.leftShoulder, LM.rightShoulder] : [LM.rightShoulder, LM.leftShoulder];
  const side = (shoulder: number) => (shoulder === LM.leftShoulder ? { e: LM.leftElbow, w: LM.leftWrist, h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle } : { e: LM.rightElbow, w: LM.rightWrist, h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle });
  const place = (shoulder: number, x: number, arm: [number, number], leg: number) => {
    const s = { x, y: 300 };
    const j = side(shoulder);
    pts[shoulder] = s;
    pts[j.e] = at(arm[0], s, 80);
    pts[j.w] = at(arm[1], pts[j.e]!, 75);
    const hip = { x: x + (x < 500 ? 15 : -15), y: 450 };
    pts[j.h] = hip;
    pts[j.k] = at(leg, hip, 110);
    pts[j.a] = at(leg, pts[j.k]!, 110);
  };
  place(L, 450, arms.l, legs ? legs.l : 92);
  place(R, 550, arms.r, legs ? legs.r : 88);
  return pts;
}

describe('pose matching', () => {
  it('measures angles the short way round', () => {
    expect(angleDiff(170, -170)).toBeCloseTo(20);
    expect(angleDiff(-90, 270)).toBeCloseTo(0);
  });

  it('matches arms up in a Y, by screen side', () => {
    const y = child({ l: [-120, -115], r: [-60, -65] });
    expect(matchPose(y, byId('arms-up')).matched).toBe(true);
    // which body side is on the screen's left doesn't matter
    expect(matchPose(child({ l: [-120, -115], r: [-60, -65] }, undefined, true), byId('arms-up')).matched).toBe(true);
    // arms down is not a Y
    const down = matchPose(child({ l: [95, 92], r: [85, 88] }), byId('arms-up'));
    expect(down.matched).toBe(false);
    expect(down.score).toBeLessThan(0.2);
  });

  it('tells left-arm-up from right-arm-up (like a mirror)', () => {
    const leftUp = child({ l: [-95, -90], r: [92, 90] });
    expect(matchPose(leftUp, byId('left-up')).matched).toBe(true);
    expect(matchPose(leftUp, byId('right-up')).matched).toBe(false);
  });

  it('needs the legs apart for the star', () => {
    const arms = { l: [-140, -140] as [number, number], r: [-40, -40] as [number, number] };
    expect(matchPose(child(arms), byId('star')).matched).toBe(false);
    expect(matchPose(child(arms, { l: 112, r: 68 }), byId('star')).matched).toBe(true);
  });

  it('reports untracked limbs as unknown, not matched', () => {
    const pts = child({ l: [-120, -115], r: [-60, -65] });
    pts[LM.leftWrist] = null;
    const m = matchPose(pts, byId('arms-up'));
    expect(m.matched).toBe(false);
    expect(Object.values(m.segs)).toContain(null);
  });
});

function play(game: MirrorGame, sec: number, holds: (g: MirrorGame) => boolean): MirrorEvent[] {
  const out: MirrorEvent[] = [];
  for (let t = 0; t < sec; t += DT) {
    const ok = holds(game);
    out.push(...game.update(DT, { matched: ok, score: ok ? 1 : 0, segs: {} }));
  }
  return out;
}

describe('Mirror Monster', () => {
  it('starts with the easiest poses and wins after holding for a second', () => {
    const game = new MirrorGame({ durationSec: 60, seed: 1 });
    const events = play(game, INTRO_SEC + HOLD_SEC + 0.2, () => true);
    expect(events[0]).toMatchObject({ type: 'pose' });
    expect(game.pose.id).toBe('arms-up');
    expect(events.some((e) => e.type === 'matched')).toBe(true);
    expect(events.some((e) => e.type === 'win')).toBe(true);
    play(game, 2, () => false);
    expect(game.pose.id).toBe('airplane');
  });

  it('moves on with a shrug when a pose is too hard', () => {
    const game = new MirrorGame({ durationSec: 60, seed: 2 });
    const events = play(game, INTRO_SEC + POSE_SEC + 0.2, () => false);
    expect(events.some((e) => e.type === 'miss')).toBe(true);
    expect(game.wins).toBe(0);
  });

  it('a short wobble only slows the hold down', () => {
    const game = new MirrorGame({ durationSec: 60, seed: 3 });
    play(game, INTRO_SEC + 0.1, () => false);
    play(game, 0.7, () => true);
    play(game, 0.1, () => false);
    const events = play(game, 0.45, () => true);
    expect(events.some((e) => e.type === 'win')).toBe(true);
  });

  it('keeps harder poses for after three wins', () => {
    const game = new MirrorGame({ durationSec: 300, seed: 4 });
    const seen: string[] = [];
    let t = 0;
    for (; t < 60; t += DT) for (const e of game.update(DT, { matched: false, score: 0, segs: {} })) if (e.type === 'pose') seen.push(e.pose.id);
    for (const id of seen) expect(byId(id).level).toBe(1);
  });

  it('ends after the round with at least one star', () => {
    const game = new MirrorGame({ durationSec: 20, seed: 5 });
    const events = play(game, 60, () => false);
    const end = events.find((e) => e.type === 'end') as { stars: number } | undefined;
    expect(end).toBeDefined();
    expect(end!.stars).toBe(1);
    expect([0, 3, 6].map(mirrorStars)).toEqual([1, 2, 3]);
  });
});
