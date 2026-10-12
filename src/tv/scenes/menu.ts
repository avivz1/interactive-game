// Menu: games float above the child's head; raise a hand onto one and hold
// to start it (or use the remote).

import type { Pt } from '../../shared/body';
import { Dwell } from '../../games/dwell';
import { drawCritter } from '../critters';
import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { distance, label, ring } from '../ui';

export interface MenuItem {
  id: string;
  title: string;
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

  enter(): void {
    this.chosen = false;
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
    const { rect, body } = frame;
    const s = body.shoulderWidth;
    const r = Math.max(s * 0.75, rect.h * 0.09);
    // Tiles sit beside the child at raised-hand height (inside arm's reach),
    // alternating right and left, never over the face.
    const ls = body.points[11];
    const rs = body.points[12];
    const cx = ls && rs ? (ls.x + rs.x) / 2 : body.head ? body.head.x : rect.x + rect.w / 2;
    const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : rect.y + rect.h * 0.35;
    this.tiles.forEach((t, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      const target = {
        x: Math.max(rect.x + r * 1.2, Math.min(rect.x + rect.w - r * 1.2, cx + side * (s * 1.4 + r))),
        y: Math.max(rect.y + r * 1.2, Math.min(rect.y + rect.h - r * 1.8, shoulderY - s * 0.7 + row * r * 2.6)),
      };
      if (t.r === 0) {
        t.at = target;
        t.r = r;
      } else {
        t.at = { x: t.at.x + (target.x - t.at.x) * 0.08, y: t.at.y + (target.y - t.at.y) * 0.08 };
        t.r += (r - t.r) * 0.08;
      }
      const hover = body.hands.some((hand) => !!hand && distance(hand, t.at) <= t.r + s * 0.3);
      if (t.dwell.update(hover, frame.dt * 1000)) this.choose(t);
    });
  }

  onKey(key: Key): void {
    if (key === 'left') this.focus = Math.max(0, this.focus - 1);
    else if (key === 'right') this.focus = Math.min(this.tiles.length - 1, this.focus + 1);
    else if (key === 'ok' && this.stage.sound.ready) this.choose(this.tiles[this.focus]);
    else if (key === 'down') this.stage.go(this.openCheck());
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height } = frame;
    drawBody(ctx, frame.body, 0.35);
    this.tiles.forEach((t, i) => {
      const bob = Math.sin(this.age * 2 + i) * t.r * 0.05;
      const at = { x: t.at.x, y: t.at.y + bob };
      drawCritter(ctx, { x: at.x, y: at.y, r: t.r, color: t.item.color, kind: 'normal', stage: t.dwell.progress > 0 ? 2 : 0, age: this.age, touched: false }, frame.body.hands[0] || frame.body.hands[1]);
      ring(ctx, at, t.r * 1.12, t.dwell.progress, '#ffd600', Math.max(6, t.r * 0.1));
      if (i === this.focus && this.tiles.length > 1) ring(ctx, at, t.r * 1.3, 0, '#fff', 3);
      label(ctx, t.item.title, at.x, at.y + t.r * 1.45, Math.max(24, t.r * 0.32), '#fff');
    });
    label(ctx, 'Raise your hand to a game to play!', width / 2, height * 0.06, height * 0.045, '#ffd600');
    label(ctx, 'Remote: OK = play  ·  ▼ = TV check', width / 2, height * 0.95, height * 0.028, 'rgba(255,255,255,0.8)');
    if (!this.stage.sound.ready) label(ctx, '🔊 Press OK on the remote for sound', width / 2, height * 0.89, height * 0.032, '#ffd600');
  }
}
