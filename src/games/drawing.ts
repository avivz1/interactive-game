// Draw & Alive, pure logic: hand positions become strokes on a drawing sheet,
// and a finished drawing becomes a creature shape (outline, filled parts, where
// the face and feet go). Sheet units: 1 = the drawing board's height.

import type { Pt } from '../shared/body';

interface TimedPt extends Pt {
  t: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A new point is recorded once the hand has moved this far (board heights). */
export const MIN_STEP = 0.008;
/** A jump this long between frames is a tracking glitch: start a new stroke. */
export const MAX_STEP = 0.25;
export const MAX_POINTS = 4000;
export const MAX_STROKES = 60;
/** Strokes shorter than this are dropped (a tap, not a line). */
export const MIN_STROKE = 0.03;
/**
 * Moving onto and off the board is quick; drawing is slower. Near the border a
 * stroke only starts once the hand slows down (up to ENTRY_SETTLE_SEC), and when
 * the hand leaves the board the fast, straight tail is trimmed (up to
 * EXIT_TRIM_SEC), so no stray lines lead to the edges.
 */
export const EXIT_SPEED = 1.6;
export const EXIT_TRIM_SEC = 0.45;
export const ENTRY_SETTLE_SEC = 0.45;
/** How close to the border (board heights) a line has to start to count as swooping in. */
export const EDGE_ZONE = 0.25;
/** Least total line length that makes a creature. */
export const MIN_INK = 0.6;

export const dist = (a: Pt, b: Pt): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

export function pathLength(pts: ReadonlyArray<Pt>): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

/**
 * Drops the end of a stroke that was drawn while the hand rushed out of the
 * board (to the Done button or down to the side): the fast, straight part of
 * the tail, at most EXIT_TRIM_SEC of it. A sharp turn means drawing, so the
 * trim stops there and quick curvy lines keep their shape.
 */
export function trimExitTail<T extends TimedPt>(stroke: ReadonlyArray<T>): T[] {
  let end = stroke.length - 1;
  if (end < 1) return stroke.slice();
  const tEnd = stroke[end].t;
  let dirX = 0;
  let dirY = 0;
  while (end > 0) {
    const a = stroke[end - 1];
    const b = stroke[end];
    const dt = b.t - a.t;
    const step = dist(a, b);
    const speed = dt > 0 ? step / dt : Infinity;
    if (speed < EXIT_SPEED || tEnd - a.t > EXIT_TRIM_SEC) break;
    if (step > 0) {
      const ux = (b.x - a.x) / step;
      const uy = (b.y - a.y) / step;
      if (dirX === 0 && dirY === 0) {
        dirX = ux;
        dirY = uy;
      } else if (ux * dirX + uy * dirY < 0.5) {
        break; // turned more than 60°: this is drawing, not leaving
      }
    }
    end--;
  }
  return stroke.slice(0, end + 1);
}

/** The strokes being drawn, one pen per hand. */
export class Sheet {
  readonly strokes: Pt[][] = [];
  /** Pen colour number of each finished stroke. */
  readonly colors: number[] = [];
  /** The board's width in board heights (its height is 1). */
  width = 1.2;
  private live: Array<TimedPt[] | null> = [null, null];
  private liveColor = [0, 0];
  private nextColor = 0;
  /** When a line started near the border, while the hand is still swooping in (else null). */
  private entering: Array<number | null> = [null, null];
  private doneInk = 0;
  private donePoints = 0;

  /** Feeds one hand's position (sheet units) for this frame. */
  update(hand: number, p: Pt | null, inside: boolean, t: number): void {
    if (!p) {
      this.lift(hand, false); // tracking lost: keep the line as drawn
      return;
    }
    if (!inside) {
      this.lift(hand); // left the board: trim the swoop out
      return;
    }
    const cur = this.live[hand];
    if (cur) {
      const last = cur[cur.length - 1];
      const step = dist(last, p);
      if (step > MAX_STEP) {
        this.lift(hand, false);
      } else {
        if (step < MIN_STEP || this.pointCount() >= MAX_POINTS) return;
        const since = this.entering[hand];
        if (since !== null) {
          const speed = t > last.t ? step / (t - last.t) : Infinity;
          if (speed >= EXIT_SPEED && t - since < ENTRY_SETTLE_SEC) {
            // still swooping in: the line will start from here
            this.live[hand] = [{ x: p.x, y: p.y, t }];
            return;
          }
          this.entering[hand] = null;
        }
        cur.push({ x: p.x, y: p.y, t });
        return;
      }
    }
    if (this.strokes.length + this.liveCount() >= MAX_STROKES || this.pointCount() >= MAX_POINTS) return;
    this.live[hand] = [{ x: p.x, y: p.y, t }];
    this.liveColor[hand] = this.nextColor++;
    this.entering[hand] = this.nearEdge(p) ? t : null;
  }

  private nearEdge(p: Pt): boolean {
    return p.x < EDGE_ZONE || p.y < EDGE_ZONE || p.x > this.width - EDGE_ZONE || p.y > 1 - EDGE_ZONE;
  }

  /** Ends a hand's stroke (trimming the fast exit tail unless told otherwise). */
  lift(hand: number, trim = true): void {
    const cur = this.live[hand];
    if (!cur) return;
    this.live[hand] = null;
    this.entering[hand] = null;
    const kept = trim ? trimExitTail(cur) : cur;
    if (kept.length < 2) return;
    const len = pathLength(kept);
    if (len < MIN_STROKE) return;
    this.strokes.push(kept.map((q) => ({ x: q.x, y: q.y })));
    this.colors.push(this.liveColor[hand]);
    this.doneInk += len;
    this.donePoints += kept.length;
  }

  liftAll(): void {
    for (let i = 0; i < this.live.length; i++) this.lift(i);
  }

  /** Strokes still being drawn, with their pen colours (for rendering). */
  get liveStrokes(): ReadonlyArray<ReadonlyArray<Pt>> {
    const out: TimedPt[][] = [];
    for (const s of this.live) if (s) out.push(s);
    return out;
  }

  get liveColors(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.live.length; i++) if (this.live[i]) out.push(this.liveColor[i]);
    return out;
  }

  /** The pen colour of a hand's line (its current one, or the next one it would start). */
  colorOf(hand: number): number {
    return this.live[hand] ? this.liveColor[hand] : this.nextColor;
  }

  isDrawing(hand: number): boolean {
    return !!this.live[hand];
  }

  /** Total line length so far, counting lines in progress as if the hand left now. */
  ink(): number {
    let len = this.doneInk;
    for (const s of this.live) {
      if (!s) continue;
      const kept = pathLength(trimExitTail(s));
      if (kept >= MIN_STROKE) len += kept;
    }
    return len;
  }

  clear(): void {
    this.strokes.length = 0;
    this.colors.length = 0;
    this.live = [null, null];
    this.entering = [null, null];
    this.doneInk = 0;
    this.donePoints = 0;
  }

  private liveCount(): number {
    let n = 0;
    for (const s of this.live) if (s) n++;
    return n;
  }

  private pointCount(): number {
    let n = this.donePoints;
    for (const s of this.live) if (s) n += s.length;
    return n;
  }
}

/** Ramer–Douglas–Peucker line simplification (iterative). */
export function simplify(pts: ReadonlyArray<Pt>, epsilon: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep: boolean[] = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = pts[a];
    const pb = pts[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    let worst = -1;
    let worstD = epsilon;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i];
      const d = len > 0 ? Math.abs(dy * p.x - dx * p.y + pb.x * pa.y - pb.y * pa.x) / len : dist(p, pa);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push({ x: pts[i].x, y: pts[i].y });
  return out;
}

/** Chaikin corner cutting: rounds wobbly hand-drawn corners. */
export function smooth(pts: ReadonlyArray<Pt>, closed: boolean, iterations = 2): Pt[] {
  let cur: Pt[] = pts.slice();
  for (let it = 0; it < iterations && cur.length >= 3; it++) {
    const next: Pt[] = [];
    const n = cur.length;
    if (!closed) next.push(cur[0]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) next.push(cur[n - 1]);
    cur = next;
  }
  return cur;
}

export function bounds(strokes: ReadonlyArray<ReadonlyArray<Pt>>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** A stroke whose ends meet (loosely — kids' circles rarely close exactly). */
export function isClosed(stroke: ReadonlyArray<Pt>): boolean {
  if (stroke.length < 4) return false;
  const b = bounds([stroke]);
  if (!b) return false;
  const diag = Math.sqrt(b.w * b.w + b.h * b.h);
  if (pathLength(stroke) < 0.2 || Math.min(b.w, b.h) < 0.04) return false;
  return dist(stroke[0], stroke[stroke.length - 1]) <= Math.max(0.06, diag * 0.25);
}

/** Absolute polygon area (shoelace). */
export function area(poly: ReadonlyArray<Pt>): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}

/** Convex hull (monotone chain), counter-clockwise. */
export function hull(points: ReadonlyArray<Pt>): Pt[] {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Even-odd point-in-polygon test. */
export function inside(p: Pt, poly: ReadonlyArray<Pt>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** How the drawing is placed in the square image sent to the AI. */
export interface ImageFit {
  scale: number;
  ox: number;
  oy: number;
  size: number;
}

export function fitToSquare(box: Box, size: number, pad: number): ImageFit {
  const span = Math.max(box.w, box.h, 1e-6);
  const scale = (size - pad * 2) / span;
  return { scale, ox: (size - box.w * scale) / 2 - box.x * scale, oy: (size - box.h * scale) / 2 - box.y * scale, size };
}

export const toImage = (fit: ImageFit, p: Pt): Pt => ({ x: p.x * fit.scale + fit.ox, y: p.y * fit.scale + fit.oy });
export const fromImage = (fit: ImageFit, p: Pt): Pt => ({ x: (p.x - fit.ox) / fit.scale, y: (p.y - fit.oy) / fit.scale });

export interface Fill {
  pts: Pt[];
  main: boolean;
}

/**
 * The finished drawing as a creature, in creature units: the larger side of the
 * drawing is 1, the origin is the bottom centre and up is negative y.
 */
export interface Shape {
  strokes: Pt[][];
  fills: Fill[];
  /** A soft blob behind drawings without a big closed outline (stick figures, scribbles). */
  blob: Pt[] | null;
  face: Pt;
  eyeR: number;
  width: number;
  height: number;
  /** The drawing's place on the board (sheet units), for the magic moment. */
  box: Box;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Turns strokes (sheet units) into a creature shape. `face`, when given (from
 * the AI, already converted to sheet units), is used if it lies on the drawing.
 */
export function buildShape(strokes: ReadonlyArray<ReadonlyArray<Pt>>, face: Pt | null = null): Shape | null {
  const box = bounds(strokes);
  if (!box || strokes.length === 0) return null;
  const span = Math.max(box.w, box.h, 0.05);
  const cx = box.x + box.w / 2;
  const bottom = box.y + box.h;
  const norm = (p: Pt): Pt => ({ x: (p.x - cx) / span, y: (p.y - bottom) / span });

  const outStrokes: Pt[][] = [];
  const fills: Fill[] = [];
  let mainArea = 0;
  let main = -1;
  const all: Pt[] = [];
  for (const s of strokes) {
    // above hand-tracking jitter, so the outline keeps its shape, not every wobble
    const simple = simplify(s, 0.008);
    const closed = isClosed(simple);
    const pts = smooth(simple, closed).map(norm);
    outStrokes.push(closed ? pts.concat([pts[0]]) : pts);
    for (const p of pts) all.push(p);
    if (closed) {
      const a = area(pts);
      fills.push({ pts, main: false });
      if (a > mainArea) {
        mainArea = a;
        main = fills.length - 1;
      }
    }
  }
  if (main >= 0) fills[main].main = true;
  // bigger shapes first so small closed parts (eyes, spots) stay visible on top
  fills.sort((a, b) => area(b.pts) - area(a.pts));

  const width = box.w / span;
  const height = box.h / span;
  const blobHull = hull(all);
  const blob = mainArea < width * height * 0.3 && blobHull.length >= 3 ? smooth(blobHull, true, 2) : null;

  // The face: the AI's spot if it is on the drawing, else the upper middle of the
  // body — the main closed part if it is big, otherwise the whole drawing.
  const hullArea = blobHull.length >= 3 ? area(blobHull) : 0;
  const bigMain = main >= 0 && mainArea >= hullArea * 0.3 ? fills.filter((f) => f.main)[0].pts : null;
  const body = bigMain || blob || all;
  let region = body;
  let facePt: Pt | null = null;
  if (face) {
    const f = norm(face);
    // the smallest big-enough part the spot is on decides the eye size
    const parts = fills.filter((fl) => area(fl.pts) >= hullArea * 0.15 && inside(f, fl.pts));
    if (parts.length) {
      facePt = f;
      region = parts[parts.length - 1].pts;
    } else if ((blob && inside(f, blob)) || inside(f, blobHull)) {
      facePt = f;
      region = blob || all;
    }
  }
  const rb = bounds([region]) || { x: -width / 2, y: -height, w: width, h: height };
  if (!facePt) facePt = { x: rb.x + rb.w / 2, y: rb.y + rb.h * 0.38 };
  const eyeR = clamp(Math.min(rb.w, rb.h) * 0.11, 0.045, 0.11);
  return { strokes: outStrokes, fills, blob, face: facePt, eyeR, width, height, box };
}
