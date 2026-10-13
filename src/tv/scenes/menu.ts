// Menu: games float in an arc above the player's head, where raised hands
// reach (measured from the shoulders); reach a hand onto one and hold to start
// it (or use the remote). When they don't all fit (a grown-up, a phone set
// low, a child small in the picture) a few show at a time: sweep a hand
// sideways at chest height, or press ◀ ▶, for the others.

import type { Pt } from '../../shared/body';
import { Dwell } from '../../games/dwell';
import { handsRoom } from '../../games/fit';
import { Limbs } from '../../games/limbs';
import { SwipeDetector } from '../../games/swipe';
import { LM } from '../../shared/landmarks';
import { t, type TextKey } from '../../shared/i18n';
import { drawCritter } from '../critters';
import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { distance, fitLabel, label, ring } from '../ui';
import type { Rect } from '../../shared/mapping';

/** Fewer games per page once they haven't fitted for this long (seconds)... */
const FEWER_SEC = 0.5;
/** ...and more again once they have fitted for this long (no flipping back and forth). */
const MORE_SEC = 1.5;
/** Explain swiping once the menu has shown pages this long. */
const SWIPE_HINT_SEC = 4;
/** Ask for a step back once raised hands have had no room for this long. */
const HANDS_HINT_SEC = 3;

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
  /** Which way it slides in when its page appears (-1 from the left, 1 from the right). */
  enter: number;
}

export class MenuScene implements Scene {
  readonly name = 'menu';
  private tiles: Tile[];
  private focus = 0;
  private age = 0;
  private chosen = false;
  private sinceSpoken = 0;
  /** A hand resting at the side never picks a game, wherever a bubble ends up. */
  private readonly limbs = new Limbs();
  private readonly swipe = new SwipeDetector();
  /** Games shown at once (all of them when they fit); 0 until the first frame. */
  private perPage = 0;
  private wantPer = 0;
  private wantFor = 0;
  private pagedFor = 0;
  private swipeHinted = false;
  private noRoomFor = 0;
  private handsHinted = false;
  /** Where the player is (for the page arrows). */
  private player: { cx: number; shoulderY: number; s: number } | null = null;

  constructor(
    private readonly stage: Stage,
    items: MenuItem[],
    private readonly openCheck: () => Scene,
  ) {
    this.tiles = items.map((item) => ({ item, at: { x: 0, y: 0 }, r: 0, dwell: new Dwell(1500), enter: 0 }));
  }

  enter(): void {
    this.chosen = false;
    this.sinceSpoken = 0;
    this.perPage = 0;
    this.wantFor = 0;
    this.pagedFor = 0;
    this.swipeHinted = false;
    this.noRoomFor = 0;
    this.handsHinted = false;
    this.swipe.reset();
    this.stage.sound.speak('menu', 0);
    for (const t of this.tiles) {
      t.dwell.reset();
      t.r = 0;
      t.enter = 0;
    }
  }

  private get per(): number {
    return this.perPage || this.tiles.length;
  }

  private get page(): number {
    return Math.floor(this.focus / this.per);
  }

  private shown(i: number): boolean {
    return Math.floor(i / this.per) === this.page;
  }

  /** The new page's bubbles slide in (`delta` 1: the next page, from the left); the others shrink away. */
  private newPage(delta: number): void {
    this.tiles.forEach((t, i) => {
      t.dwell.reset();
      if (this.shown(i)) {
        t.r = 0;
        t.enter = -delta;
      }
    });
    this.stage.debug({ menuPer: this.per, menuPage: this.page });
  }

  private turnPage(delta: number): void {
    const pages = Math.ceil(this.tiles.length / this.per);
    this.focus = ((this.page + delta + pages) % pages) * this.per;
    this.stage.sound.boing();
    this.newPage(delta);
  }

  private choose(tile: Tile): void {
    if (this.chosen) return;
    this.chosen = true;
    this.stage.sound.select();
    this.stage.go(tile.item.start());
  }

  update(frame: Frame): void {
    const { rect, body, dt } = frame;
    const sound = this.stage.sound;
    this.age += dt;
    // Remind every 20 s while nobody chooses.
    this.sinceSpoken += dt;
    if (this.sinceSpoken > 20) {
      this.sinceSpoken = 0;
      sound.speak('menu', 0);
    }
    // a grown-up who joined after setup may have no room above the head
    this.noRoomFor = handsRoom(frame.landmarks) ? 0 : this.noRoomFor + dt;
    if (this.noRoomFor >= HANDS_HINT_SEC && !this.handsHinted) {
      this.handsHinted = true;
      sound.speak('hands_cut', 0);
    }

    const s = body.shoulderWidth;
    const ls = body.points[LM.leftShoulder];
    const rs = body.points[LM.rightShoulder];
    const cx = ls && rs ? (ls.x + rs.x) / 2 : body.head ? body.head.x : rect.x + rect.w / 2;
    const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : rect.y + rect.h * 0.35;
    this.player = { cx, shoulderY, s };
    const n = this.tiles.length;

    // all games when they fit, else two at a time, else one
    const all = menuLayout(n, cx, shoulderY, s, rect);
    const want = all.ok ? n : n > 2 && menuLayout(2, cx, shoulderY, s, rect).ok ? 2 : 1;
    if (this.perPage === 0) {
      this.perPage = want;
      this.newPage(0);
    } else if (want !== this.perPage) {
      this.wantFor = want === this.wantPer ? this.wantFor + dt : dt;
      this.wantPer = want;
      if (this.wantFor >= (want < this.perPage ? FEWER_SEC : MORE_SEC)) {
        this.perPage = want;
        this.wantFor = 0;
        this.newPage(0);
      }
    } else this.wantFor = 0;
    const per = this.per;
    const hands = this.limbs.update(body, dt).hands;
    if (per < n) {
      // a sweep at chest height (below the bubbles) flips the page: toward the right shows the next one
      this.pagedFor += dt;
      const lh = body.points[LM.leftHip];
      const rh = body.points[LM.rightHip];
      const bottom = lh && rh ? (lh.y + rh.y) / 2 + s * 0.2 : shoulderY + s * 1.6;
      const dir = this.swipe.update(hands, s, dt, { top: shoulderY - s * 0.1, bottom });
      if (dir) this.turnPage(dir);
      if (!this.swipeHinted && this.pagedFor >= SWIPE_HINT_SEC && !sound.isSpeaking) {
        this.swipeHinted = true;
        sound.speak('swipe', 0);
      }
    } else this.swipe.reset();
    // (after a page turn: the new page)
    const start = this.page * per;
    const count = Math.min(per, n - start);
    const layout = count === n ? all : menuLayout(count, cx, shoulderY, s, rect);
    const R = layout.r;

    // each hand counts only for the nearest bubble it is over
    const hovered = new Set<Tile>();
    for (const hand of hands) {
      if (!hand) continue;
      let best: Tile | null = null;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const tile = this.tiles[i];
        if (!this.shown(i) || tile.r < R * 0.5) continue;
        const d = distance(hand, tile.at);
        if (d <= tile.r + s * 0.2 && d < bestD) {
          best = tile;
          bestD = d;
        }
      }
      if (best) hovered.add(best);
    }
    this.tiles.forEach((t, i) => {
      if (!this.shown(i)) {
        t.r = Math.max(0, t.r - R * 0.15);
        return;
      }
      const target = layout.at[i - start];
      if (t.r === 0) {
        // appears small, sliding in from the side of its page
        t.at = { x: target.x + t.enter * s * 2.5, y: target.y };
        t.r = R * 0.05;
      }
      const k = t.enter ? 0.15 : 0.08;
      t.at = { x: t.at.x + (target.x - t.at.x) * k, y: t.at.y + (target.y - t.at.y) * k };
      t.r += (R - t.r) * Math.max(k, 0.12);
      if (Math.abs(target.x - t.at.x) < s * 0.1) t.enter = 0;
      if (t.dwell.update(hovered.has(t), dt * 1000)) this.choose(t);
    });
  }

  onKey(key: Key): void {
    if (key === 'left' || key === 'right') {
      // bubbles are laid out right to left (around the player) in list order, so the remote follows the list
      const n = this.tiles.length;
      const before = this.page;
      this.focus = key === 'left' ? Math.min(n - 1, this.focus + 1) : Math.max(0, this.focus - 1);
      if (this.page !== before) this.newPage(this.page > before ? 1 : -1);
    } else if (key === 'ok' && this.stage.sound.ready) this.choose(this.tiles[this.focus]);
    else if (key === 'down') this.stage.go(this.openCheck());
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height } = frame;
    drawBody(ctx, frame.body, 0.35);
    this.tiles.forEach((tile, i) => {
      if (tile.r < 1) return;
      const bob = Math.sin(this.age * 2 + i) * tile.r * 0.05;
      const at = { x: tile.at.x, y: tile.at.y + bob };
      const look = frame.body.hands[0] || frame.body.hands[1];
      drawCritter(ctx, { x: at.x, y: at.y, r: tile.r, color: tile.item.color, kind: 'normal', stage: tile.dwell.progress > 0 ? 2 : 0, age: this.age, touched: false }, look);
      ring(ctx, at, tile.r * 1.12, tile.dwell.progress, '#ffd600', Math.max(6, tile.r * 0.1));
      if (i === this.focus && this.tiles.length > 1) ring(ctx, at, tile.r * 1.3, 0, '#fff', 3);
      // names shrink to their bubble's width so neighbours never overlap; a name
      // that would cover the face goes above its bubble instead (over the
      // bubble's top when the picture ends there)
      const head = frame.body.head;
      const half = tile.r * 1.05;
      const size = Math.max(24, tile.r * 0.32);
      const below = at.y + tile.r * 1.45;
      const nearX = Math.max(at.x - half, Math.min(at.x + half, head ? head.x : 0));
      const overFace = !!head && Math.hypot(nearX - head.x, below - head.y) < frame.body.headRadius * 1.3 + tile.r * 0.2;
      fitLabel(ctx, t(tile.item.title), at.x, overFace ? Math.max(frame.rect.y + size * 0.75, at.y - tile.r * 1.45) : below, size, tile.r * 2.1, '#fff');
    });

    const n = this.tiles.length;
    const per = this.per;
    if (per < n && this.player) {
      // more games this way: arrows beside the chest (where a sweep counts) and page dots
      const { cx, shoulderY, s } = this.player;
      const { rect } = frame;
      const y = shoulderY + s * 0.7;
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.age * 2.5));
      const size = Math.max(28, s * 0.45);
      ctx.globalAlpha = pulse;
      label(ctx, '◀', Math.max(rect.x + size, cx - s * 2), y, size, '#ffd600');
      label(ctx, '▶', Math.min(rect.x + rect.w - size, cx + s * 2), y, size, '#ffd600');
      ctx.globalAlpha = 1;
      const pages = Math.ceil(n / per);
      const dot = height * 0.012;
      for (let p = 0; p < pages; p++) {
        ctx.fillStyle = p === this.page ? '#ffd600' : 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.arc(width / 2 + (p - (pages - 1) / 2) * dot * 3.5, height * 0.725, dot, 0, Math.PI * 2);
        ctx.fill();
      }
      label(ctx, t('menu.swipe'), width / 2, height * 0.775, height * 0.035, '#fff');
    }
    // the top of the screen belongs to the game bubbles
    label(ctx, t(this.noRoomFor >= HANDS_HINT_SEC ? 'fit.hands-cut' : 'menu.title'), width / 2, height * 0.83, height * 0.045, '#ffd600');
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.9, height * 0.032, '#ffd600');
    label(ctx, t('menu.remote'), width / 2, height * 0.96, height * 0.028, 'rgba(255,255,255,0.8)');
  }
}

/** Bubble positions for some games, and whether they all fit well. */
export interface MenuLayout {
  r: number;
  /** In list order: right to left around the child. */
  at: Pt[];
  /** Every bubble is in the picture, within reach, above the shoulders, off the face and apart. */
  ok: boolean;
}

/**
 * Where the game bubbles go: an arc above the head at raised-hand reach
 * (about 1.65 shoulder widths from the shoulders), 30–62° apart, first game
 * on the right. With little room above the head (a grown-up, or the phone set
 * low) they turn outward along that arc until they fit under the top of the
 * picture, so a reaching hand stays in view; any that still don't fit move to
 * free reachable places above the shoulders (smaller bubbles if needed). When
 * even that fails, `ok` is false and the menu shows fewer bubbles at a time.
 */
export function menuLayout(n: number, cx: number, shoulderY: number, s: number, rect: Rect): MenuLayout {
  // five or more games: smaller bubbles packed closer, still above the head
  const r0 = n >= 5 ? Math.max(s * 0.44, rect.h * 0.058) : Math.max(s * 0.5, rect.h * 0.065);
  let first: Arrangement | null = null;
  for (const k of [1, 0.85]) {
    const a = arrange(n, cx, shoulderY, s, rect, r0 * k);
    if (a.placed.every((p) => p)) return finish(a, cx, shoulderY, true);
    if (!first) first = a;
  }
  // Doesn't fit: full-size bubbles, the rest further out (still above the
  // shoulders and off the face) or, with no room at all, kept on screen.
  const a = first as Arrangement;
  const { r, placed, ideal } = a;
  const m = r * 1.05;
  const span = s * 1.65 + r * 4.4;
  const far = grid(a, Math.max(rect.x + m, cx - span), Math.min(rect.x + rect.w - m, cx + span), a.top, shoulderY - s * 0.25);
  for (let i = 0; i < n; i++) {
    if (placed[i]) continue;
    placed[i] = nearestFree(a, ideal[i], far) || { x: Math.max(rect.x + m, Math.min(rect.x + rect.w - m, ideal[i].x)), y: Math.max(rect.y + m, Math.min(rect.y + rect.h - m, ideal[i].y)) };
  }
  return finish(a, cx, shoulderY, false);
}

interface Arrangement {
  r: number;
  /** The highest a bubble may sit: a hand reaching higher would leave the picture. */
  top: number;
  /** The arc positions (before moving the ones that don't fit). */
  ideal: Pt[];
  /** Final positions; null where nothing reachable was free. */
  placed: Array<Pt | null>;
  offFace: (p: Pt) => boolean;
}

function arrange(n: number, cx: number, shoulderY: number, s: number, rect: Rect, r: number): Arrangement {
  const reach = s * 1.65;
  const step = ((n <= 2 ? 62 : n === 3 ? 50 : n === 4 ? 40 : n === 5 ? 34 : 30) * Math.PI) / 180;
  const top = rect.y + Math.max(r * 1.1, rect.h * 0.08);
  // never lower than this: hands at the chest (waving, clapping) never pick a game
  const lowest = shoulderY - s * 0.25;
  // the head: about 0.75 s above the shoulders, radius about 0.45 s
  const head = { x: cx, y: shoulderY - s * 0.75 };
  const clear = r + s * 0.55;
  const roomy = rect.x + rect.w - cx >= cx - rect.x ? 1 : -1;
  // angles from straight up (positive: toward the screen's right), and distances from the shoulders
  const ang: number[] = [];
  const dist: number[] = [];
  for (let i = 0; i < n; i++) {
    ang.push(((n - 1) / 2 - i) * step);
    // straight up goes a little higher, to stay clear of the top of the head
    dist.push(i * 2 === n - 1 ? reach + s * 0.2 : reach);
  }
  const posOf = (i: number): Pt => ({ x: cx + Math.sin(ang[i]) * dist[i], y: shoulderY - Math.cos(ang[i]) * dist[i] });
  const sideOf = (i: number) => (ang[i] > 0 ? 1 : ang[i] < 0 ? -1 : roomy);
  /** Turns bubble i outward (keeping its distance) to at least `a` from straight up. */
  const turn = (i: number, a: number) => {
    if (a > Math.abs(ang[i])) ang[i] = sideOf(i) * a;
  };
  for (let i = 0; i < n; i++) {
    // too high for the picture: turn outward along the reach circle until it fits under the top
    if (posOf(i).y < top) turn(i, Math.acos(Math.max(-1, Math.min(1, (shoulderY - top) / dist[i]))));
  }
  const gap = 2 * Math.asin(Math.min(1, (r * 1.1) / reach));
  for (let pass = 0; pass < 3; pass++) {
    // clear of the face
    for (let i = 0; i < n; i++) {
      let guard = 0;
      while (Math.hypot(posOf(i).x - head.x, posOf(i).y - head.y) < clear && Math.abs(ang[i]) < Math.PI * 0.6 && guard++ < 60) turn(i, Math.abs(ang[i]) + Math.PI / 90);
    }
    // neighbours on the same side keep apart along the arc (outer ones move out)
    for (const dir of [1, -1]) {
      const group = ang
        .map((_, i) => i)
        .filter((i) => sideOf(i) === dir)
        .sort((a, b) => Math.abs(ang[a]) - Math.abs(ang[b]));
      for (let k = 1; k < group.length; k++) turn(group[k], Math.abs(ang[group[k - 1]]) + gap);
    }
  }
  const at: Pt[] = [];
  for (let i = 0; i < n; i++) at.push(posOf(i));
  const m = r * 1.05;
  const inside = (p: Pt) => p.x - m >= rect.x && p.x + m <= rect.x + rect.w && p.y >= top - 0.5 && p.y + m <= rect.y + rect.h;
  const offFace = (p: Pt) => Math.hypot(p.x - head.x, p.y - head.y) >= clear - 0.5;
  // a palm reaches about 1.3 s from a shoulder, and a hand counts within r + 0.2 s
  const reachable = (p: Pt) => Math.min(Math.hypot(p.x - (cx - s * 0.5), p.y - shoulderY), Math.hypot(p.x - (cx + s * 0.5), p.y - shoulderY)) - r <= s * 1.5;
  const a: Arrangement = { r, top, ideal: at, placed: at.map(() => null), offFace };
  for (let i = 0; i < n; i++) if (inside(at[i]) && at[i].y <= lowest + 0.5 && offFace(at[i]) && reachable(at[i]) && apart(a, at[i])) a.placed[i] = at[i];
  if (a.placed.every((p) => p)) return a;
  // the rest: the nearest free reachable places above the shoulders
  const box = s * 2 + r;
  const near = grid(a, Math.max(rect.x + m, cx - box), Math.min(rect.x + rect.w - m, cx + box), Math.max(top, shoulderY - box), lowest).filter(reachable);
  for (let i = 0; i < n; i++) if (!a.placed[i]) a.placed[i] = nearestFree(a, at[i], near);
  return a;
}

/** Candidate places in a box, off the face. */
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
function finish(a: Arrangement, cx: number, shoulderY: number, ok: boolean): MenuLayout {
  const around = (p: Pt) => Math.atan2(p.x - cx, shoulderY - p.y);
  return { r: a.r, at: (a.placed as Pt[]).slice().sort((p, q) => around(q) - around(p)), ok };
}
