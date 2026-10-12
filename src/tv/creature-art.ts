// Draw & Alive art: the child's glowing lines while drawing, the picture sent
// to the creature AI, and the living creature (the drawing itself, filled with
// colour, with googly eyes, a smile, feet or wings, wobbling like jelly).

import type { Pt } from '../shared/body';
import { DRAWING_IMAGE_SIZE, MAX_IMAGE_CHARS, PNG_DATA_PREFIX, type Move } from '../shared/creature-api';
import { bounds, fitToSquare, toImage, type ImageFit, type Shape } from '../games/drawing';
import type { Mood } from '../games/creature';

export const PEN_COLORS = ['#ff7eb6', '#7ee0ff', '#ffd23f', '#9dff7a', '#c59bff'];
const OUTLINE = '#2b2250';

function tracePath(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<Pt>, map: (p: Pt) => Pt): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const q = map(pts[i]);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
}

/** Strokes on the board: a thick coloured line with a white core. */
export function drawInk(
  ctx: CanvasRenderingContext2D,
  strokes: ReadonlyArray<ReadonlyArray<Pt>>,
  map: (p: Pt) => Pt,
  width: number,
  colorShift = 0,
  firstColor = 0,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach((s, i) => {
    if (s.length < 2) return;
    tracePath(ctx, s, map);
    ctx.strokeStyle = PEN_COLORS[(firstColor + i + colorShift) % PEN_COLORS.length];
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = width * 0.38;
    ctx.stroke();
  });
}

/**
 * The drawing as a small black-on-white PNG for the creature AI (lines only,
 * nothing from the camera). Returns null if the browser cannot export it.
 */
export function drawingPng(strokes: ReadonlyArray<ReadonlyArray<Pt>>): { data: string; fit: ImageFit } | null {
  const box = bounds(strokes);
  if (!box) return null;
  const size = DRAWING_IMAGE_SIZE;
  const fit = fitToSquare(box, size, 20);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#000';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of strokes) {
    if (s.length < 2) continue;
    tracePath(g, s, (p) => toImage(fit, p));
    g.stroke();
  }
  let data = '';
  try {
    data = c.toDataURL('image/png');
  } catch (_e) {
    return null;
  }
  if (data.indexOf(PNG_DATA_PREFIX) !== 0 || data.length > MAX_IMAGE_CHARS) return null;
  return { data, fit };
}

export interface CreatureLook {
  /** Feet (bottom centre) on screen. */
  x: number;
  y: number;
  /** Pixels per creature unit (the drawing's larger side). */
  size: number;
  facing: 1 | -1;
  squash: number;
  spin: number;
  age: number;
  /** Jelly wobble strength (1 = normal). */
  wobble: number;
  mood: Mood;
  /** > 0 while blinking. */
  blink: number;
  lookAt: Pt | null;
  bodyColor: string;
  accentColor: string;
  move: Move;
  /** Walking phase for the feet (0 when standing). */
  step: number;
  /** 0..1: colour fading in when it comes alive. */
  fill: number;
  /** 0..1: eyes popping open. */
  eyes: number;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number): void {
  ctx.beginPath();
  if (typeof ctx.ellipse === 'function') ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  else ctx.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
}

function drawEyes(ctx: CanvasRenderingContext2D, shape: Shape, look: CreatureLook, lookLocal: Pt | null): void {
  const r = shape.eyeR;
  const f = shape.face;
  const dx = r * 1.15;
  const lw = Math.max(0.012, r * 0.28);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  const closed = look.mood === 'sleep' || look.mood === 'hide';
  const happy = look.mood === 'happy';
  for (const side of [-1, 1]) {
    const ex = f.x + side * dx;
    if (closed) {
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.8, f.y + r * 0.1);
      ctx.quadraticCurveTo(ex, f.y + r * 0.6, ex + r * 0.8, f.y + r * 0.1);
      ctx.stroke();
    } else if (happy) {
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.75, f.y + r * 0.3);
      ctx.lineTo(ex, f.y - r * 0.45);
      ctx.lineTo(ex + r * 0.75, f.y + r * 0.3);
      ctx.stroke();
    } else {
      const open = Math.max(0.08, look.eyes * (look.blink > 0 ? 0.1 : 1));
      ctx.fillStyle = '#fff';
      ellipse(ctx, ex, f.y, r, r * open, 0);
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
      if (open > 0.3) {
        let px = 0;
        let py = 0;
        if (lookLocal) {
          const ddx = lookLocal.x - ex;
          const ddy = lookLocal.y - f.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          px = (ddx / d) * r * 0.42;
          py = (ddy / d) * r * 0.42;
        }
        ctx.fillStyle = OUTLINE;
        ellipse(ctx, ex + px, f.y + py * open, r * 0.5, r * 0.5 * open, 0);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ellipse(ctx, ex + px - r * 0.18, f.y + (py - r * 0.18) * open, r * 0.15, r * 0.15 * open, 0);
        ctx.fill();
      }
    }
  }
  // cheeks
  ctx.fillStyle = 'rgba(255, 90, 140, 0.45)';
  for (const side of [-1, 1]) {
    ellipse(ctx, f.x + side * dx * 1.9, f.y + r * 0.9, r * 0.45, r * 0.3, 0);
    ctx.fill();
  }
  // mouth
  const my = f.y + r * 1.5;
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  if (happy) {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.arc(f.x, my - r * 0.2, r * 0.6, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff6b8a';
    ctx.beginPath();
    ctx.arc(f.x, my + r * 0.1, r * 0.28, 0, Math.PI);
    ctx.fill();
  } else if (look.mood === 'sleep') {
    ctx.beginPath();
    ctx.arc(f.x, my, r * 0.18, 0, Math.PI * 2);
    ctx.stroke();
  } else if (look.mood === 'hide') {
    ctx.beginPath();
    ctx.moveTo(f.x - r * 0.4, my);
    ctx.lineTo(f.x + r * 0.4, my);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(f.x, my - r * 0.45, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

/** Draws the living creature (also used, without colour, during the magic moment). */
export function drawCreature(ctx: CanvasRenderingContext2D, shape: Shape, look: CreatureLook): void {
  const { size, age } = look;
  if (size <= 0) return;
  const w = look.wobble * (look.mood === 'hide' ? 2.2 : 1);
  const jelly = (p: Pt): Pt => ({
    x: p.x + Math.sin(age * 5 + p.y * 9) * 0.012 * w,
    y: p.y + Math.cos(age * 4.3 + p.x * 8) * 0.01 * w,
  });
  const breathe = 1 + Math.sin(age * 2.2) * 0.015;
  const midY = -shape.height * 0.5;

  ctx.save();
  ctx.translate(look.x, look.y);
  if (look.spin) {
    ctx.translate(0, midY * size);
    ctx.rotate(look.spin * look.facing);
    ctx.translate(0, -midY * size);
  }
  ctx.scale(look.facing * size * (1 + look.squash) * breathe, size * (1 - look.squash) / breathe);

  // wings behind the body
  if (look.move === 'fly' && look.fill > 0) {
    const flap = Math.sin(age * 16) * 0.5;
    ctx.globalAlpha = look.fill * 0.85;
    ctx.fillStyle = '#ffffff';
    for (const side of [-1, 1]) {
      ellipse(ctx, side * (shape.width * 0.5 + 0.06), shape.face.y + 0.02, 0.16, 0.09, side * (0.5 + flap));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (look.fill > 0) {
    ctx.globalAlpha = look.fill;
    if (shape.blob) {
      ctx.fillStyle = look.bodyColor;
      tracePath(ctx, shape.blob, jelly);
      ctx.closePath();
      ctx.fill();
    }
    for (const f of shape.fills) {
      // with a blob behind, even the main part takes the accent colour so it stands out
      ctx.fillStyle = f.main && !shape.blob ? look.bodyColor : look.accentColor;
      tracePath(ctx, f.pts, jelly);
      ctx.closePath();
      ctx.fill();
    }
    // feet
    if (look.move === 'walk' || look.move === 'hop') {
      ctx.fillStyle = look.accentColor;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.02;
      for (const side of [-1, 1]) {
        const lift = look.step ? Math.max(0, Math.sin(look.step * 12 + (side > 0 ? Math.PI : 0))) * 0.05 : 0;
        ellipse(ctx, side * Math.max(0.08, shape.width * 0.22), -0.02 - lift, 0.09, 0.05, 0);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // the child's own lines, as a cartoon outline
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = look.fill > 0 ? OUTLINE : '#ffffff';
  ctx.lineWidth = 0.035;
  for (const s of shape.strokes) {
    if (s.length < 2) continue;
    tracePath(ctx, s, jelly);
    ctx.stroke();
  }

  if (look.eyes > 0) {
    let lookLocal: Pt | null = null;
    if (look.lookAt) {
      lookLocal = {
        x: ((look.lookAt.x - look.x) / size) * look.facing,
        y: (look.lookAt.y - look.y) / size,
      };
    }
    drawEyes(ctx, shape, look, lookLocal);
  }
  ctx.restore();
}

/** A small heart (for the pets counter and touch effects). */
export function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.3, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
  ctx.fill();
}
