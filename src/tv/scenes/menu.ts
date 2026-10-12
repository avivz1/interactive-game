// Menu: games float in an arc above the child's head, where raised hands reach
// (measured from the shoulders); raise a hand onto one and hold to start it
// (or use the remote). Too close to the top of the picture, they move to the
// sides instead.

import type { Pt } from '../../shared/body';
import { Dwell } from '../../games/dwell';
import { t, type TextKey } from '../../shared/i18n';
import { drawCritter } from '../critters';
import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { distance, label, ring } from '../ui';
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
    this.tiles.forEach((t, i) => {
      const target = targets.at[i];
      if (t.r === 0) {
        t.at = target;
        t.r = r;
      } else {
        t.at = { x: t.at.x + (target.x - t.at.x) * 0.08, y: t.at.y + (target.y - t.at.y) * 0.08 };
        t.r += (r - t.r) * 0.08;
      }
      const hover = body.hands.some((hand) => !!hand && distance(hand, t.at) <= t.r + s * 0.2);
      if (t.dwell.update(hover, frame.dt * 1000)) this.choose(t);
    });
  }

  onKey(key: Key): void {
    if (key === 'left' || key === 'right') {
      // move to the nearest tile on that side of the screen (tiles alternate sides)
      const cur = this.tiles[this.focus].at;
      let best = -1;
      let bestD = Infinity;
      this.tiles.forEach((tile, i) => {
        const dx = tile.at.x - cur.x;
        if (i === this.focus || (key === 'left' ? dx >= 0 : dx <= 0)) return;
        const d = Math.abs(dx) + Math.abs(tile.at.y - cur.y) * 0.5;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) this.focus = best;
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
      label(ctx, t(tile.item.title), at.x, at.y + tile.r * 1.45, Math.max(24, tile.r * 0.32), '#fff');
    });
    // the top of the screen belongs to the game bubbles
    label(ctx, t('menu.title'), width / 2, height * 0.83, height * 0.045, '#ffd600');
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.9, height * 0.032, '#ffd600');
    label(ctx, t('menu.remote'), width / 2, height * 0.96, height * 0.028, 'rgba(255,255,255,0.8)');
  }
}

/**
 * Where the game bubbles go: an arc above the head at raised-hand reach
 * (about 1.65 shoulder widths from the shoulders), 62° apart, first game on the
 * right. With little room above the head they stay as high as the picture
 * allows and move outward just enough to keep clear of the head.
 */
export function menuLayout(n: number, cx: number, shoulderY: number, s: number, rect: Rect): { r: number; at: Pt[] } {
  const r = Math.max(s * 0.5, rect.h * 0.065);
  const reach = s * 1.65;
  const step = (62 * Math.PI) / 180;
  const top = rect.y + r * 1.1;
  // the head: about 0.75 s above the shoulders, radius about 0.45 s
  const headY = shoulderY - s * 0.75;
  const clear = r + s * 0.55;
  const at: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((n - 1) / 2 - i) * step;
    const side = a > 0 ? 1 : a < 0 ? -1 : i % 2 === 0 ? 1 : -1;
    let x = cx + Math.sin(a) * reach;
    const y = Math.max(top, shoulderY - Math.cos(a) * reach);
    // pushed down next to the head: move outward so it never covers the face
    const dy = Math.abs(y - headY);
    if (dy < clear) {
      const minDx = Math.sqrt(clear * clear - dy * dy);
      if (Math.abs(x - cx) < minDx) x = cx + side * minDx;
    }
    at.push({ x: Math.max(rect.x + r * 1.1, Math.min(rect.x + rect.w - r * 1.1, x)), y });
  }
  return { r, at };
}
