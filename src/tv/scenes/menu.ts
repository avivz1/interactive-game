// Menu: games float in an arc above the child's head, where raised hands reach
// (measured from the shoulders); raise a hand onto one and hold to start it
// (or use the remote). Too close to the top of the picture, they move to the
// sides instead.

import type { Pt } from '../../shared/body';
import { Dwell } from '../../games/dwell';
import { Limbs } from '../../games/limbs';
import { t, type TextKey } from '../../shared/i18n';
import { drawCritter } from '../critters';
import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { distance, fitLabel, label, ring } from '../ui';
import type { Rect } from '../../shared/mapping';

export interface MenuItem {
  id: string;
  title: TextKey;
  color: number;
  start: () => Scene;
}

interface Tile {
  item: MenuItem;
  at: Pt;
  r: number;
  dwell: Dwell;
}

export class MenuScene implements Scene {
  readonly name = 'menu';
  private tiles: Tile[];
  private focus = 0;
  private age = 0;
  private chosen = false;
  /** A hand resting at the side never picks a game, wherever a bubble ends up. */
  private readonly limbs = new Limbs();

  constructor(
    private readonly stage: Stage,
    items: MenuItem[],
    private readonly openCheck: () => Scene,
  ) {
    this.tiles = items.map((item) => ({ item, at: { x: 0, y: 0 }, r: 0, dwell: new Dwell(1500) }));
  }

  private sinceSpoken = 0;

  enter(): void {
    this.chosen = false;
    this.sinceSpoken = 0;
    this.stage.sound.speak('menu', 0);
    for (const t of this.tiles) {
      t.dwell.reset();
      t.r = 0;
    }
  }

  private choose(tile: Tile): void {
    if (this.chosen) return;
    this.chosen = true;
    this.stage.sound.select();
    this.stage.go(tile.item.start());
  }

  update(frame: Frame): void {
    this.age += frame.dt;
    // Remind every 20 s while nobody chooses.
    this.sinceSpoken += frame.dt;
    if (this.sinceSpoken > 20) {
      this.sinceSpoken = 0;
      this.stage.sound.speak('menu', 0);
    }
    const { rect, body } = frame;
    const s = body.shoulderWidth;
    const ls = body.points[11];
    const rs = body.points[12];
    const cx = ls && rs ? (ls.x + rs.x) / 2 : body.head ? body.head.x : rect.x + rect.w / 2;
    const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : rect.y + rect.h * 0.35;
    const targets = menuLayout(this.tiles.length, cx, shoulderY, s, rect);
    const r = targets.r;
    // each hand counts only for the nearest bubble it is over
    const hovered = new Set<Tile>();
    for (const hand of this.limbs.update(body, frame.dt).hands) {
      if (!hand) continue;
      let best: Tile | null = null;
      let bestD = Infinity;
      for (const tile of this.tiles) {
        const d = distance(hand, tile.at);
        if (tile.r > 0 && d <= tile.r + s * 0.2 && d < bestD) {
          best = tile;
          bestD = d;
        }
      }
      if (best) hovered.add(best);
    }
    this.tiles.forEach((t, i) => {
      const target = targets.at[i];
      if (t.r === 0) {
        t.at = target;
        t.r = r;
      } else {
        t.at = { x: t.at.x + (target.x - t.at.x) * 0.08, y: t.at.y + (target.y - t.at.y) * 0.08 };
        t.r += (r - t.r) * 0.08;
      }
      if (t.dwell.update(hovered.has(t), frame.dt * 1000)) this.choose(t);
    });
  }

  onKey(key: Key): void {
    if (key === 'left' || key === 'right') {
      // bubbles are laid out right to left (around the child) in list order, so the remote follows the list
      const n = this.tiles.length;
      this.focus = key === 'left' ? Math.min(n - 1, this.focus + 1) : Math.max(0, this.focus - 1);
    } else if (key === 'ok' && this.stage.sound.ready) this.choose(this.tiles[this.focus]);
    else if (key === 'down') this.stage.go(this.openCheck());
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height } = frame;
    drawBody(ctx, frame.body, 0.35);
    this.tiles.forEach((tile, i) => {
      const bob = Math.sin(this.age * 2 + i) * tile.r * 0.05;
      const at = { x: tile.at.x, y: tile.at.y + bob };
      const look = frame.body.hands[0] || frame.body.hands[1];
      drawCritter(ctx, { x: at.x, y: at.y, r: tile.r, color: tile.item.color, kind: 'normal', stage: tile.dwell.progress > 0 ? 2 : 0, age: this.age, touched: false }, look);
      ring(ctx, at, tile.r * 1.12, tile.dwell.progress, '#ffd600', Math.max(6, tile.r * 0.1));
      if (i === this.focus && this.tiles.length > 1) ring(ctx, at, tile.r * 1.3, 0, '#fff', 3);
      // names shrink to their bubble's width so neighbours never overlap; a name
      // that would cover the child's face goes above its bubble instead
      const head = frame.body.head;
      const half = tile.r * 1.05;
      const below = at.y + tile.r * 1.45;
      const nearX = Math.max(at.x - half, Math.min(at.x + half, head ? head.x : 0));
      const overFace = !!head && Math.hypot(nearX - head.x, below - head.y) < frame.body.headRadius * 1.3 + tile.r * 0.2;
      fitLabel(ctx, t(tile.item.title), at.x, overFace ? at.y - tile.r * 1.45 : below, Math.max(24, tile.r * 0.32), tile.r * 2.1, '#fff');
    });
    // the top of the screen belongs to the game bubbles
    label(ctx, t('menu.title'), width / 2, height * 0.83, height * 0.045, '#ffd600');
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.9, height * 0.032, '#ffd600');
    label(ctx, t('menu.remote'), width / 2, height * 0.96, height * 0.028, 'rgba(255,255,255,0.8)');
  }
}

/**
 * Where the game bubbles go: an arc above the head at raised-hand reach
 * (about 1.65 shoulder widths from the shoulders), 34–62° apart, first game
 * on the right. With little room above the head they stay as high as the picture
 * allows and move outward just enough to keep clear of the head. Bubbles that
 * don't fit within reach that way move to free places nearby (smaller bubbles
 * if needed); list order always runs right to left around the child.
 */
export function menuLayout(n: number, cx: number, shoulderY: number, s: number, rect: Rect): { r: number; at: Pt[] } {
  // five or more games: smaller bubbles packed closer, still above the head
  const r0 = n >= 5 ? Math.max(s * 0.44, rect.h * 0.058) : Math.max(s * 0.5, rect.h * 0.065);
  let first: Arrangement | null = null;
  for (const k of [1, 0.85, 0.72]) {
    const a = arrange(n, cx, shoulderY, s, rect, r0 * k);
    if (a.placed.every((p) => p)) return finish(a, cx, shoulderY);
    if (!first) first = a;
  }
  // Nothing fits within reach (a screen edge): full-size bubbles, the rest
  // placed further out, still above the shoulders and off the face.
  const a = first as Arrangement;
  const { r, placed, ideal } = a;
  const m = r * 1.05;
  const span = s * 1.65 + r * 4.4;
  const far = grid(a, Math.max(rect.x + m, cx - span), Math.min(rect.x + rect.w - m, cx + span), rect.y + m, shoulderY - s * 0.25);
  let low: Pt[] | null = null;
  for (let i = 0; i < n; i++) {
    if (placed[i]) continue;
    placed[i] = nearestFree(a, ideal[i], far);
    if (placed[i]) continue;
    // no room above the shoulders: lower down, rather than on top of another bubble
    if (!low) low = grid(a, Math.max(rect.x + m, cx - span), Math.min(rect.x + rect.w - m, cx + span), shoulderY - s * 0.25, rect.y + rect.h - m);
    // no room anywhere (a tiny picture): at least stay on screen
    placed[i] = nearestFree(a, ideal[i], low) || { x: Math.max(rect.x + m, Math.min(rect.x + rect.w - m, ideal[i].x)), y: Math.max(rect.y + m, Math.min(rect.y + rect.h - m, ideal[i].y)) };
  }
  return finish(a, cx, shoulderY);
}

interface Arrangement {
  r: number;
  /** The arc positions (before moving the ones that don't fit). */
  ideal: Pt[];
  /** Final positions; null where nothing reachable was free. */
  placed: Array<Pt | null>;
  offFace: (p: Pt) => boolean;
  reachable: (p: Pt) => boolean;
}

function arrange(n: number, cx: number, shoulderY: number, s: number, rect: Rect, r: number): Arrangement {
  const reach = s * 1.65;
  const step = ((n <= 2 ? 62 : n === 3 ? 50 : n === 4 ? 40 : 34) * Math.PI) / 180;
  const top = rect.y + r * 1.1;
  // the head: about 0.75 s above the shoulders, radius about 0.45 s
  const headY = shoulderY - s * 0.75;
  const clear = r + s * 0.55;
  const at: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((n - 1) / 2 - i) * step;
    // straight up goes to the roomier side if it must move away from the head
    const side = a > 0 ? 1 : a < 0 ? -1 : rect.x + rect.w - cx >= cx - rect.x ? 1 : -1;
    // straight up goes a little higher, to stay clear of the top of the head
    const far = a === 0 ? reach + s * 0.2 : reach;
    let x = cx + Math.sin(a) * far;
    const y = Math.max(top, shoulderY - Math.cos(a) * far);
    // pushed down next to the head: move outward so it never covers the face
    const dy = Math.abs(y - headY);
    if (dy < clear) {
      const minDx = Math.sqrt(clear * clear - dy * dy);
      if (Math.abs(x - cx) < minDx) x = cx + side * minDx;
    }
    at.push({ x, y });
  }
  // Pushed-out bubbles can crowd each other: on each side of the head, move
  // the outer ones further out (never back toward the face).
  const need = r * 2.2;
  for (const dir of [1, -1]) {
    const group = at
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (p.x === cx ? (rect.x + rect.w - cx >= cx - rect.x ? 1 : -1) : Math.sign(p.x - cx)) === dir)
      .sort((a, b) => Math.abs(a.p.x - cx) - Math.abs(b.p.x - cx));
    for (let k = 1; k < group.length; k++) {
      const prev = group[k - 1].p;
      const cur = group[k].p;
      const dy = cur.y - prev.y;
      if (Math.hypot(cur.x - prev.x, dy) < need) cur.x = prev.x + dir * Math.sqrt(Math.max(0, need * need - dy * dy));
    }
  }
  // Keep the ones that fit; the rest (a screen edge, the head near the top, or
  // pushed out of reach) go to the nearest free reachable places, never over
  // the face, always above the shoulders.
  const m = r * 1.05;
  const inside = (p: Pt) => p.x - m >= rect.x && p.x + m <= rect.x + rect.w && p.y - m >= rect.y && p.y + m <= rect.y + rect.h;
  const offFace = (p: Pt) => Math.hypot(p.x - cx, p.y - headY) >= clear - 0.5;
  // a palm reaches about 1.3 s from a shoulder, and a hand counts within r + 0.2 s
  const reachable = (p: Pt) => Math.min(Math.hypot(p.x - (cx - s * 0.5), p.y - shoulderY), Math.hypot(p.x - (cx + s * 0.5), p.y - shoulderY)) - r <= s * 1.5;
  const a: Arrangement = { r, ideal: at, placed: at.map(() => null), offFace, reachable };
  for (let i = 0; i < n; i++) if (inside(at[i]) && offFace(at[i]) && reachable(at[i]) && apart(a, at[i])) a.placed[i] = at[i];
  if (a.placed.every((p) => p)) return a;
  const box = s * 2 + r;
  const near = grid(a, Math.max(rect.x + m, cx - box), Math.min(rect.x + rect.w - m, cx + box), Math.max(rect.y + m, shoulderY - box), shoulderY - s * 0.25).filter(reachable);
  for (let i = 0; i < n; i++) if (!a.placed[i]) a.placed[i] = nearestFree(a, at[i], near);
  return a;
}

/** Candidate places in a box, off the face. Above the shoulders only: hands at the chest (waving, clapping) never pick a game. */
function grid(a: Arrangement, x0: number, x1: number, y0: number, y1: number): Pt[] {
  const out: Pt[] = [];
  const step = a.r * 0.3;
  for (let y = y0; y <= y1; y += step)
    for (let x = x0; x <= x1; x += step) {
      const p = { x, y };
      if (a.offFace(p)) out.push(p);
    }
  return out;
}

function apart(a: Arrangement, p: Pt): boolean {
  return a.placed.every((q) => !q || Math.hypot(p.x - q.x, p.y - q.y) >= a.r * 2.1);
}

function nearestFree(a: Arrangement, want: Pt, list: Pt[]): Pt | null {
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const p of list) {
    const d = Math.hypot(p.x - want.x, p.y - want.y);
    if (d < bestD && apart(a, p)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** List order runs right to left around the child, so the remote's ◀ ▶ match the screen. */
function finish(a: Arrangement, cx: number, shoulderY: number): { r: number; at: Pt[] } {
  const around = (p: Pt) => Math.atan2(p.x - cx, shoulderY - p.y);
  return { r: a.r, at: (a.placed as Pt[]).slice().sort((p, q) => around(q) - around(p)) };
}
