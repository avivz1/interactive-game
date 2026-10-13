import { describe, expect, it } from 'vitest';
import { evaluateFit, handsRoom, roomBelowFeet, viewHint } from '../../src/games/fit';
import { LM } from '../../src/shared/landmarks';
import { BoopGame } from '../../src/games/boop';
import { matchPose, POSES } from '../../src/games/mirror';
import { spotLayout, SPOTS } from '../../src/games/rhythm';
import { menuLayout } from '../../src/tv/scenes/menu';
import { adult, child, landmarks, project, seen, tvBody, type Camera, type Person } from './framing';

const ARMS_UP = { left: 180, right: 180 };
/** Picture y of a wrist raised straight up (0 is the top edge). */
const raisedWrist = (p: Person, cam: Camera) => project(cam, 0, p.shoulder + p.upperArm + p.forearm).y;

describe('framing: room for raised hands', () => {
  it('asks a grown-up standing close to a low upright phone to step back, but not a kneeling one or a child', () => {
    // the reported setup: phone upright on a 50 cm chair
    const cam = { height: 0.5, distance: 2.0, aspect: 3 / 4 };
    expect(evaluateFit(seen(landmarks(adult(), cam)))).toBe('hands-cut');
    expect(raisedWrist(adult(), cam)).toBeLessThan(0);
    expect(evaluateFit(seen(landmarks(adult(1.75, true), cam)))).toBe('ok');
    expect(evaluateFit(seen(landmarks(child(), cam)))).toBe('ok');
  });

  it('passes only when raised hands stay in the picture, for every phone height, distance and picture shape', () => {
    let checked = 0;
    for (const aspect of [16 / 9, 4 / 3, 3 / 4, 9 / 16])
      for (let h = 0.3; h <= 1.21; h += 0.15)
        for (let d = 1.6; d <= 4.51; d += 0.25)
          for (const p of [adult(1.6), adult(1.75), adult(1.9), adult(1.75, true), child(1.0), child(1.12), child(1.3)]) {
            const cam = { height: h, distance: d, aspect };
            const fit = evaluateFit(seen(landmarks(p, cam)));
            const wrist = raisedWrist(p, cam);
            if (fit === 'ok') expect(wrist, `${p.name} h ${h} d ${d} aspect ${aspect}`).toBeGreaterThanOrEqual(-0.02);
            if (fit === 'hands-cut') expect(wrist, `${p.name} h ${h} d ${d} aspect ${aspect}`).toBeLessThan(0.06);
            checked++;
          }
    expect(checked).toBeGreaterThan(1000);
  });

  it('suggests raising the phone when there is room below the feet', () => {
    const low = { height: 0.5, distance: 2.0, aspect: 3 / 4 };
    expect(roomBelowFeet(seen(landmarks(adult(), low)))).toBe(true);
    const pts = seen(landmarks(adult(), { height: 1.4, distance: 2.0, aspect: 16 / 9 }));
    // feet near the bottom edge (or out of it): raising the phone would cut them off
    expect(roomBelowFeet(pts)).toBe(false);
  });

  it('cannot judge without hips, so it does not complain', () => {
    const pts = seen(landmarks(adult(), { height: 0.5, distance: 2.0, aspect: 3 / 4 }));
    pts[LM.leftHip] = null;
    expect(handsRoom(pts)).toBe(true);
  });
});

describe('phone view hint', () => {
  const cam = { height: 1.0, distance: 3.0, aspect: 4 / 3 };
  it('says nobody is in view when no body was found for a second', () => {
    expect(viewHint(null, 0)).toBe('no-one');
    expect(viewHint(landmarks(adult(), cam, ARMS_UP).map((p) => p!), 1500)).toBe('no-one');
  });
  it('says the head or raised hands are cut off', () => {
    const close = landmarks(adult(), { height: 0.5, distance: 2.0, aspect: 3 / 4 }).map((p) => p!);
    expect(viewHint(close, 100)).toBe('cut');
  });
  it('says the picture is on its side when the phone is turned but rotation is locked', () => {
    // the body lies across the picture
    const pts = landmarks(adult(), cam).map((p) => p && { x: 1 - p.y, y: p.x, visibility: p.visibility }).map((p) => p!);
    expect(viewHint(pts, 100)).toBe('rotated');
  });
  it('says cut off when the body is seen but the head is not', () => {
    const pts = landmarks(adult(), cam).map((p) => p!);
    pts[LM.nose] = { ...pts[LM.nose], visibility: 0.05 };
    expect(viewHint(pts, 100)).toBe('cut');
  });
  it('is quiet when everything fits', () => {
    expect(viewHint(landmarks(adult(), cam).map((p) => p!), 100)).toBeNull();
  });
});

/** The menu as the TV lays it out for a person: all six games if they fit, else two, else one at a time. */
function menuFor(p: Person, cam: Camera) {
  const { body, rect } = tvBody(p, cam);
  const ls = body.points[LM.leftShoulder]!;
  const rs = body.points[LM.rightShoulder]!;
  const cx = (ls.x + rs.x) / 2;
  const sy = (ls.y + rs.y) / 2;
  const s = body.shoulderWidth;
  for (const k of [6, 2, 1]) {
    const l = menuLayout(k, cx, sy, s, rect);
    if (l.ok) return { k, l, sy, s, rect };
  }
  return { k: 0, l: menuLayout(1, cx, sy, s, rect), sy, s, rect };
}

describe('menu for grown-ups and children', () => {
  it('always has a page of bubbles above the shoulders and under the top of the picture, once setup passes', () => {
    let checked = 0;
    for (const aspect of [4 / 3, 3 / 4, 16 / 9, 9 / 16])
      for (const h of [0.5, 0.8, 1.0, 1.2])
        for (const d of [2, 2.5, 3, 3.5, 4])
          for (const p of [adult(1.6), adult(1.75), adult(1.9), adult(1.75, true), child(1.0), child(1.12)]) {
            const cam = { height: h, distance: d, aspect };
            if (evaluateFit(seen(landmarks(p, cam))) !== 'ok') continue;
            const m = menuFor(p, cam);
            const where = `${p.name} h ${h} d ${d} aspect ${aspect.toFixed(2)}`;
            expect(m.k, where).toBeGreaterThan(0);
            for (const b of m.l.at) {
              expect(b.y, where).toBeGreaterThanOrEqual(m.rect.y + m.rect.h * 0.08 - 0.5);
              expect(b.y, where).toBeLessThanOrEqual(m.sy - m.s * 0.25 + 0.5);
            }
            checked++;
          }
    expect(checked).toBeGreaterThan(100);
  });

  it('shows all six games to a child who fills the picture, and pages them for one far away', () => {
    const near = { height: 0.8, distance: 1.8, aspect: 4 / 3 };
    expect(evaluateFit(seen(landmarks(child(), near)))).toBe('ok');
    expect(menuFor(child(), near).k).toBe(6);
    // small in the picture: six full-size bubbles don't fit within arm's reach
    expect(menuFor(child(), { height: 1.0, distance: 2.5, aspect: 4 / 3 }).k).toBe(2);
  });

  it('pages the games for a grown-up near a low upright phone, never on the body', () => {
    const cam = { height: 0.5, distance: 2.6, aspect: 3 / 4 };
    expect(evaluateFit(seen(landmarks(adult(), cam)))).toBe('ok');
    const m = menuFor(adult(), cam);
    expect(m.k).toBeGreaterThan(0);
    expect(m.k).toBeLessThan(6);
    for (const b of m.l.at) expect(b.y).toBeLessThanOrEqual(m.sy - m.s * 0.25 + 0.5);
  });
});

/** Framings that pass setup with the head close to the top of the picture (grown-ups near a low phone). */
const TIGHT: Array<[Person, Camera]> = [
  [adult(), { height: 0.5, distance: 2.6, aspect: 3 / 4 }],
  [adult(1.9), { height: 0.6, distance: 3.3, aspect: 4 / 3 }],
  [adult(), { height: 0.75, distance: 3.4, aspect: 16 / 9 }],
];

describe('games for grown-ups near the top of the picture', () => {
  for (const [p, cam] of TIGHT) {
    const where = `${p.name}, phone ${cam.height} m, ${cam.distance} m, aspect ${cam.aspect.toFixed(2)}`;
    it(`Bubble Beat hand spots stay where a reaching hand is still in view (${where})`, () => {
      expect(evaluateFit(seen(landmarks(p, cam)))).toBe('ok');
      const { body, rect } = tvBody(p, cam);
      const ls = body.points[LM.leftShoulder]!;
      const rs = body.points[LM.rightShoulder]!;
      const cx = (ls.x + rs.x) / 2;
      const sy = (ls.y + rs.y) / 2;
      const s = body.shoulderWidth;
      const floor = Math.max(body.points[LM.leftAnkle]!.y, body.points[LM.rightAnkle]!.y);
      const { at, r } = spotLayout(cx, sy, floor, s, rect);
      for (const id of ['handL', 'handR'] as const) {
        expect(at[id].y).toBeGreaterThanOrEqual(rect.y + rect.h * 0.08 - 0.5);
        const fromShoulder = Math.min(Math.hypot(at[id].x - ls.x, at[id].y - ls.y), Math.hypot(at[id].x - rs.x, at[id].y - rs.y));
        expect(fromShoulder - r).toBeLessThanOrEqual(s * 1.5);
        expect(Math.hypot(at[id].x - cx, at[id].y - (sy - s * 0.75))).toBeGreaterThanOrEqual(r + s * 0.5 - 1);
      }
      for (let i = 0; i < SPOTS.length; i++)
        for (let j = i + 1; j < SPOTS.length; j++) expect(Math.hypot(at[SPOTS[i]].x - at[SPOTS[j]].x, at[SPOTS[i]].y - at[SPOTS[j]].y)).toBeGreaterThan(r * 2);
    });

    it(`Boop eggs sit where a reaching hand is still in view (${where})`, () => {
      const { body, rect } = tvBody(p, cam);
      const ls = body.points[LM.leftShoulder]!;
      const rs = body.points[LM.rightShoulder]!;
      const env = { cx: (ls.x + rs.x) / 2, shoulderY: (ls.y + rs.y) / 2, floor: Math.max(body.points[LM.leftAnkle]!.y, body.points[LM.rightAnkle]!.y), unit: body.shoulderWidth, rect };
      const hits = { hands: [] as Array<{ x: number; y: number }>, feet: [], handRadius: env.unit * 0.28, footRadius: env.unit * 0.3 };
      for (let seed = 1; seed <= 15; seed++) {
        const g = new BoopGame({ durationSec: 60, seed });
        for (let i = 0; i < 900; i++) {
          const target = g.critters.find((c) => c.stage < 3 && c.hop >= 1 && c.wait <= 0 && c.armed);
          hits.hands = target && i % 3 === 0 ? [{ x: target.x, y: target.y }] : [];
          g.update(1 / 30, env, hits);
          for (const c of g.critters) if (c.stage < 3 && c.hop >= 1) expect(c.y, `seed ${seed}`).toBeGreaterThanOrEqual(rect.y + rect.h * 0.08 - 1);
        }
        expect(g.boops).toBeGreaterThan(5);
      }
    });
  }

  it('Mirror Monster forgives arms raised out of the top of the picture', () => {
    const pose = POSES.find((x) => x.id === 'arms-up')!;
    const pts: Array<{ x: number; y: number } | null> = new Array(33).fill(null);
    pts[LM.leftShoulder] = { x: 1060, y: 120 };
    pts[LM.rightShoulder] = { x: 860, y: 120 };
    pts[LM.leftHip] = { x: 1040, y: 420 };
    pts[LM.rightHip] = { x: 880, y: 420 };
    // elbows and wrists are above the picture (not tracked)
    expect(matchPose(pts, pose, 0).matched).toBe(true);
    // with plenty of room above, missing arms are just missing
    expect(matchPose(pts, pose, -1000).matched).toBe(false);
    // and arms that should be out to the side are never guessed
    expect(matchPose(pts, POSES.find((x) => x.id === 'airplane')!, 0).matched).toBe(false);
  });
});
