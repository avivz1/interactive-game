import { describe, expect, it } from 'vitest';
import { Creature, funStars, type Arena, type CreatureEvent, type Kid } from '../../src/games/creature';
import {
  buildShape,
  EXIT_SPEED,
  fitToSquare,
  fromImage,
  isClosed,
  MAX_POINTS,
  MIN_INK,
  Sheet,
  simplify,
  toImage,
  trimExitTail,
} from '../../src/games/drawing';
import type { Pt } from '../../src/shared/body';
import { cleanText, sanitizeTraits } from '../../src/shared/creature-api';

const circle = (cx: number, cy: number, r: number, n = 40, turns = 1): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 * turns;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

/** Feeds a path to one pen at a steady speed (sheet units per second). */
function drawPath(sheet: Sheet, hand: number, pts: Pt[], speed: number, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      t += d / speed;
    }
    sheet.update(hand, pts[i], true, t);
  }
  return t;
}

describe('drawing sheet', () => {
  it('records a stroke while the hand is on the board and ends it when it leaves', () => {
    const sheet = new Sheet();
    const t = drawPath(sheet, 0, circle(0.6, 0.5, 0.2), 0.5);
    expect(sheet.isDrawing(0)).toBe(true);
    expect(sheet.ink()).toBeGreaterThan(1.2);
    sheet.update(0, { x: 2, y: 2 }, false, t + 0.05);
    expect(sheet.isDrawing(0)).toBe(false);
    expect(sheet.strokes).toHaveLength(1);
    expect(sheet.ink()).toBeGreaterThan(MIN_INK);
  });

  it('ignores jitter smaller than a step and drops taps', () => {
    const sheet = new Sheet();
    for (let i = 0; i < 30; i++) sheet.update(0, { x: 0.5 + (i % 2) * 0.001, y: 0.5 }, true, i / 30);
    sheet.lift(0);
    expect(sheet.strokes).toHaveLength(0);
    expect(sheet.ink()).toBe(0);
  });

  it('trims the fast tail when the hand rushes off the board', () => {
    const slow = Array.from({ length: 20 }, (_, i) => ({ x: 0.2 + i * 0.02, y: 0.5, t: i * 0.1 }));
    const fast = Array.from({ length: 5 }, (_, i) => ({ x: 0.6 + (i + 1) * 0.06, y: 0.5, t: 1.9 + (i + 1) * 0.02 }));
    const kept = trimExitTail(slow.concat(fast));
    expect(kept).toHaveLength(slow.length);
    // a slow ending stays
    expect(trimExitTail(slow)).toHaveLength(slow.length);
    expect(EXIT_SPEED).toBeGreaterThan(1);
  });

  it('starts the line where the hand slows down, not where it swooped in', () => {
    const sheet = new Sheet();
    // swoop in fast from the bottom edge (3 board heights/s) ...
    for (let i = 0; i <= 5; i++) sheet.update(0, { x: 0.5, y: 1 - i * 0.08 }, true, i / 30);
    // ... then draw slowly to the right
    for (let i = 1; i <= 20; i++) sheet.update(0, { x: 0.5 + i * 0.02, y: 0.6 }, true, 5 / 30 + i * 0.05);
    sheet.lift(0);
    expect(sheet.strokes).toHaveLength(1);
    expect(Math.max(...sheet.strokes[0].map((p) => p.y))).toBeLessThan(0.65);
  });

  it('keeps a quick zigzag drawn in the middle of the board; only the straight exit is trimmed', () => {
    const sheet = new Sheet();
    sheet.width = 1.4;
    // a fast zigzag right in the middle (not swooping in from the border) ...
    const zig = Array.from({ length: 9 }, (_, i) => ({ x: 0.4 + i * 0.05, y: i % 2 ? 0.45 : 0.55 }));
    zig.forEach((p, i) => sheet.update(0, p, true, i / 30));
    // ... then straight off the board to the right
    for (let i = 1; i <= 4; i++) sheet.update(0, { x: 0.8 + i * 0.07, y: 0.55 }, true, (8 + i) / 30);
    sheet.update(0, { x: 3, y: 0.55 }, false, 13 / 30);
    expect(sheet.strokes).toHaveLength(1);
    const kept = sheet.strokes[0];
    expect(kept[0].x).toBeCloseTo(0.4);
    expect(kept[kept.length - 1].x).toBeLessThanOrEqual(0.81);
    expect(kept.length).toBeGreaterThanOrEqual(8);
  });

  it('counts ink as if the hand left now, and gives each line its own pen colour', () => {
    const sheet = new Sheet();
    sheet.width = 1.4;
    const line = (x0: number, x1: number, y: number) => Array.from({ length: 16 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 15, y }));
    drawPath(sheet, 0, line(0.3, 0.9, 0.5), 0.3);
    const before = sheet.ink();
    expect(before).toBeCloseTo(0.6, 2);
    // rush on toward the border without leaving yet
    for (let i = 1; i <= 3; i++) sheet.update(0, { x: 0.9 + i * 0.08, y: 0.5 }, true, 2 + i / 30);
    expect(sheet.ink()).toBeLessThan(before + 0.1);
    drawPath(sheet, 1, line(0.5, 0.7, 0.7), 0.3, 3);
    expect(sheet.colorOf(0)).not.toBe(sheet.colorOf(1));
    const c1 = sheet.colorOf(1);
    sheet.liftAll();
    expect(sheet.colors).toContain(c1);
    expect(sheet.colors).toHaveLength(2);
  });

  it('starts a new stroke after a tracking glitch instead of drawing a long line', () => {
    const sheet = new Sheet();
    drawPath(sheet, 0, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.3, y: 0.1 }], 0.3);
    sheet.update(0, { x: 1.2, y: 0.9 }, true, 2);
    sheet.update(0, { x: 1.3, y: 0.9 }, true, 2.3);
    sheet.lift(0, false);
    expect(sheet.strokes).toHaveLength(2);
    expect(sheet.strokes[0][sheet.strokes[0].length - 1].x).toBeCloseTo(0.3);
  });

  it('draws with both hands at once and clears', () => {
    const sheet = new Sheet();
    drawPath(sheet, 0, circle(0.4, 0.5, 0.1), 0.4);
    drawPath(sheet, 1, circle(0.9, 0.5, 0.1), 0.4);
    expect(sheet.liveStrokes).toHaveLength(2);
    sheet.liftAll();
    expect(sheet.strokes).toHaveLength(2);
    sheet.clear();
    expect(sheet.strokes).toHaveLength(0);
    expect(sheet.ink()).toBe(0);
  });

  it('caps the number of points', () => {
    const sheet = new Sheet();
    for (let i = 0; i < MAX_POINTS * 2; i++) sheet.update(0, { x: (i % 100) * 0.01, y: Math.floor(i / 100) * 0.01 }, true, i * 0.05);
    sheet.lift(0, false);
    expect(sheet.strokes.reduce((n, s) => n + s.length, 0)).toBeLessThanOrEqual(MAX_POINTS);
  });
});

describe('drawing shapes', () => {
  it('simplifies a line and keeps its ends', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i / 49, y: 0.3 + (i % 2) * 0.001 }));
    const s = simplify(line, 0.004);
    expect(s.length).toBe(2);
    expect(s[0]).toEqual({ x: 0, y: line[0].y });
    expect(s[1].x).toBe(1);
  });

  it('knows a loose circle is closed and a line is not', () => {
    const loose = circle(0.5, 0.5, 0.2, 40, 0.93);
    expect(isClosed(loose)).toBe(true);
    expect(isClosed([{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.6, y: 0.01 }, { x: 0.9, y: 0 }])).toBe(false);
  });

  it('fills a closed body and puts the face on it', () => {
    const shape = buildShape([circle(0.6, 0.5, 0.25)])!;
    expect(shape.fills).toHaveLength(1);
    expect(shape.fills[0].main).toBe(true);
    expect(shape.blob).toBeNull();
    expect(shape.height).toBeCloseTo(1, 1);
    // origin at the bottom centre, face in the upper half
    expect(shape.face.y).toBeLessThan(-0.5);
    expect(Math.abs(shape.face.x)).toBeLessThan(0.05);
  });

  it('gives stick drawings a soft blob body', () => {
    const stick = [
      [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }],
      [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }],
      [{ x: 0.5, y: 0.6 }, { x: 0.35, y: 0.9 }],
      [{ x: 0.5, y: 0.6 }, { x: 0.65, y: 0.9 }],
    ];
    const shape = buildShape(stick)!;
    expect(shape.fills).toHaveLength(0);
    expect(shape.blob!.length).toBeGreaterThan(3);
  });

  it('puts the face on the body, not on a small drawn eye', () => {
    // a round body drawn in two halves (not closed), plus two small closed eyes
    const left = circle(0.6, 0.5, 0.3, 30, 0.5).map((p) => ({ x: p.x, y: p.y }));
    const right = circle(0.6, 0.5, 0.3, 30, 0.5).map((p) => ({ x: 1.2 - p.x, y: 1 - p.y }));
    const shape = buildShape([left, right, circle(0.5, 0.4, 0.045), circle(0.7, 0.4, 0.045)])!;
    expect(shape.blob).not.toBeNull();
    // centred on the body, between the drawn eyes
    expect(Math.abs(shape.face.x)).toBeLessThan(0.1);
    expect(shape.eyeR).toBeGreaterThan(0.06);
  });

  it('uses the AI face spot only when it lies on the drawing', () => {
    const body = circle(0.6, 0.5, 0.25);
    const onIt = buildShape([body], { x: 0.7, y: 0.45 })!;
    const off = buildShape([body], { x: 3, y: 3 })!;
    const plain = buildShape([body])!;
    expect(onIt.face.x).toBeGreaterThan(plain.face.x);
    expect(off.face).toEqual(plain.face);
  });

  it('maps between the AI image and the board both ways', () => {
    const fit = fitToSquare({ x: 0.2, y: 0.1, w: 0.8, h: 0.4 }, 256, 20);
    const p = { x: 0.5, y: 0.3 };
    const back = fromImage(fit, toImage(fit, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    // the larger side fills the image minus padding, centred
    expect(toImage(fit, { x: 0.2, y: 0.1 }).x).toBeCloseTo(20);
    expect(toImage(fit, { x: 1.0, y: 0.5 }).x).toBeCloseTo(236);
  });
});

const ARENA: Arena = { left: 0, right: 1280, top: 0, ground: 650, unit: 150 };
const KID_CENTER = { x: 640, y: 250 };

function run(c: Creature, sec: number, kid: (t: number) => Kid, from = 0): CreatureEvent[] {
  const out: CreatureEvent[] = [];
  const dt = 1 / 30;
  for (let t = from; t < from + sec; t += dt) out.push(...c.update(dt, ARENA, kid(t)));
  return out;
}

const standing = (): Kid => ({ hands: [{ x: 560, y: 470 }, { x: 720, y: 470 }], head: { x: 640, y: 120 }, center: KID_CENTER });

describe('creature', () => {
  it('drops from the drawing to the floor and lands', () => {
    const c = new Creature('bouncy', 'walk', { x: 640, y: 300 }, 300, 1);
    const events = run(c, 2, standing);
    expect(c.y).toBe(ARENA.ground);
    expect(events.some((e) => e.type === 'land')).toBe(true);
    expect(c.size).toBeCloseTo(ARENA.unit * 1.5, 0);
  });

  it('is petted by a moving hand, not by a hand resting on it', () => {
    const c = new Creature('bouncy', 'walk', { x: 900, y: ARENA.ground }, 225, 2);
    run(c, 1.5, standing);
    const target = c.middle;
    // a hand that stays still on the creature (after it arrives there)
    const stillKid = (): Kid => ({ hands: [{ x: target.x, y: target.y }, null], head: { x: 640, y: 120 }, center: KID_CENTER });
    run(c, 1, stillKid, 1.5);
    const still = run(c, 1.5, stillKid, 2.5);
    expect(still.filter((e) => e.type === 'touch')).toHaveLength(0);
    // a petting hand moving over it
    const pets = run(c, 2, (t) => ({ hands: [{ x: c.x + Math.sin(t * 12) * 30, y: c.middle.y }, null], head: { x: 640, y: 120 }, center: KID_CENTER }), 4);
    expect(pets.filter((e) => e.type === 'touch').length).toBeGreaterThanOrEqual(2);
    expect(c.fun).toBeGreaterThanOrEqual(2);
  });

  it('a kick pets it; a hand hanging at the side does not', () => {
    const c = new Creature('bouncy', 'walk', { x: 900, y: ARENA.ground }, 225, 9);
    run(c, 1.5, standing);
    const at = () => c.middle;
    // a swinging hand that hangs at the side (not a toucher)
    const hanging = run(c, 1.5, (t) => ({ hands: [{ x: at().x + Math.sin(t * 12) * 30, y: at().y }, null], touchHands: [null, null], head: { x: 640, y: 120 }, center: KID_CENTER }), 1.5);
    expect(hanging.filter((e) => e.type === 'touch')).toHaveLength(0);
    const kicked = run(c, 1, () => ({ hands: [null, null], kicks: [at(), null], head: { x: 640, y: 120 }, center: KID_CENTER }), 3);
    expect(kicked.some((e) => e.type === 'touch')).toBe(true);
  });

  it('jumps when the child jumps', () => {
    const c = new Creature('bouncy', 'walk', { x: 400, y: ARENA.ground }, 225, 3);
    run(c, 2, standing);
    const jumpKid = (t: number): Kid => {
      const up = t > 2.5 && t < 2.8 ? (t - 2.5) * 500 : t >= 2.8 && t < 3.1 ? (3.1 - t) * 500 : 0;
      return { hands: [null, null], head: { x: 640, y: 120 - up }, center: { x: 640, y: 250 - up } };
    };
    const events = run(c, 1.5, jumpKid, 2);
    expect(events.some((e) => e.type === 'jump')).toBe(true);
    expect(c.fun).toBeGreaterThanOrEqual(1);
  });

  it('does not count standing up after crouching as a jump', () => {
    const c = new Creature('bouncy', 'walk', { x: 400, y: ARENA.ground }, 225, 6);
    run(c, 2, standing);
    const feet = { x: 640, y: ARENA.ground };
    const crouchKid = (t: number): Kid => {
      // crouch 1.5 units for 3 s, then stand up quickly
      const down = t < 2.3 ? (t - 2) / 0.3 : t < 5.3 ? 1 : t < 5.7 ? 1 - (t - 5.3) / 0.4 : 0;
      const dy = Math.max(0, Math.min(1, down)) * 1.5 * ARENA.unit;
      return { hands: [null, null], head: { x: 640, y: 120 + dy }, center: { x: 640, y: 250 + dy }, feet };
    };
    const events = run(c, 5, crouchKid, 2);
    expect(events.some((e) => e.type === 'jump')).toBe(false);
  });

  it('jumps along when the feet leave the floor too', () => {
    const c = new Creature('bouncy', 'walk', { x: 400, y: ARENA.ground }, 225, 7);
    run(c, 2, standing);
    const jumpKid = (t: number): Kid => {
      const up = t > 2.5 && t < 2.8 ? (t - 2.5) * 500 : t >= 2.8 && t < 3.1 ? (3.1 - t) * 500 : 0;
      return { hands: [null, null], head: { x: 640, y: 120 - up }, center: { x: 640, y: 250 - up }, feet: { x: 640, y: ARENA.ground - up } };
    };
    expect(run(c, 1.5, jumpKid, 2).some((e) => e.type === 'jump')).toBe(true);
  });

  it('sleepy flying creatures fall asleep too', () => {
    const c = new Creature('sleepy', 'fly', { x: 640, y: 300 }, 225, 8);
    const events = run(c, 10, () => ({ hands: [null, null], head: { x: 640, y: 120 }, center: KID_CENTER }));
    expect(events.some((e) => e.type === 'sleep')).toBe(true);
  });

  it('hides while the child covers their eyes and says boo after', () => {
    const c = new Creature('silly', 'hop', { x: 400, y: ARENA.ground }, 225, 4);
    run(c, 2, standing);
    const head = { x: 640, y: 120 };
    const covered = (): Kid => ({ hands: [{ x: 610, y: 125 }, { x: 670, y: 125 }], head, center: KID_CENTER });
    const hide = run(c, 1, covered, 2);
    expect(hide.some((e) => e.type === 'hide')).toBe(true);
    expect(c.mood).toBe('hide');
    const boo = run(c, 1, standing, 3);
    expect(boo.some((e) => e.type === 'boo')).toBe(true);
    expect(c.mood).not.toBe('hide');
  });

  it('flying creatures stay inside the picture', () => {
    const c = new Creature('bouncy', 'fly', { x: 640, y: 200 }, 225, 5);
    run(c, 6, (t) => ({ hands: [{ x: 640 + Math.sin(t) * 800, y: -400 }, null], head: { x: 640, y: 120 }, center: KID_CENTER }));
    expect(c.x).toBeGreaterThanOrEqual(ARENA.left);
    expect(c.x).toBeLessThanOrEqual(ARENA.right);
    expect(c.y).toBeLessThanOrEqual(ARENA.ground);
    expect(c.y - c.size).toBeGreaterThanOrEqual(ARENA.top - 1);
  });

  it('turns fun into stars', () => {
    expect([0, 3, 6, 14, 40].map(funStars)).toEqual([1, 1, 2, 3, 3]);
  });
});

describe('creature traits', () => {
  it('accepts the AI answer and cleans it', () => {
    const t = sanitizeTraits({
      looks_like: 'cat',
      name: '‮מיצי החתולה הכי חמודה בעולם',
      greeting: 'שלום!\n\n',
      personality: 'shy',
      move: 'walk',
      body_color: '#FFAA00',
      accent_color: '#000000',
      face_x: 0.4,
      face_y: 0.3,
    })!;
    expect(t.name).not.toContain('‮');
    expect(Array.from(t.name).length).toBeLessThanOrEqual(14);
    expect(t.greeting).toBe('שלום!');
    expect(t.bodyColor).toBe('#ffaa00');
    expect(t.accentColor).not.toBe('#000000'); // too dark: replaced
    expect(t.face).toEqual({ x: 0.4, y: 0.3 });
  });

  it('falls back on unknown values and rejects a missing name', () => {
    const t = sanitizeTraits({ name: 'Zog', personality: 'angry', move: 'teleport', body_color: 'red', face_x: 2, face_y: 0.5 })!;
    expect(t.personality).toBe('bouncy');
    expect(t.move).toBe('hop');
    expect(t.bodyColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.face).toBeNull();
    expect(sanitizeTraits({ name: '   ' })).toBeNull();
    expect(sanitizeTraits('x')).toBeNull();
  });

  it('reads its own camelCase output again (server reply on the TV)', () => {
    const first = sanitizeTraits({ name: 'Bo', body_color: '#ff7eb6', face_x: 0.5, face_y: 0.2 })!;
    expect(sanitizeTraits(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });

  it('cuts text by characters, not bytes', () => {
    expect(cleanText('😀😀😀😀', 2)).toBe('😀😀');
  });
});
