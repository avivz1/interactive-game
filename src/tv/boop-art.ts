// Procedural art for Boop to Transform (no image files): a spotted egg, a baby
// peeking out of its shell, the grown-up critter, and its sparkly surprise look
// (a crown, wings, a rainbow or a party hat).

import type { Pt } from '../shared/body';
import { CRITTER_COLORS, drawCritter } from './critters';
import { star } from './ui';

const SHELL = '#fff6e0';
const OUTLINE = 'rgba(27, 21, 48, 0.35)';

function colorOf(i: number): string {
  return CRITTER_COLORS[i % CRITTER_COLORS.length];
}

/** A spotted egg that rocks gently (harder when `excited`). */
export function drawEgg(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, age: number, excited: boolean): void {
  const rx = r * 0.72;
  const ry = r * 0.92;
  ctx.save();
  ctx.translate(x, y + ry * 0.05);
  ctx.rotate(Math.sin(age * (excited ? 14 : 3)) * (excited ? 0.18 : 0.08));
  ctx.fillStyle = SHELL;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(2, r * 0.05);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colorOf(color);
  for (const [sx, sy, sr] of [
    [-0.3, -0.38, 0.13],
    [0.24, -0.08, 0.17],
    [-0.22, 0.3, 0.12],
    [0.28, 0.46, 0.09],
    [-0.02, 0.62, 0.08],
  ]) {
    ctx.beginPath();
    ctx.arc(sx * r, sy * r, sr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.ellipse(-rx * 0.4, -ry * 0.45, rx * 0.16, ry * 0.1, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The bottom half of a cracked shell, with a zigzag top edge. */
function shellBottom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const rx = r * 0.72;
  const ry = r * 0.92;
  ctx.fillStyle = SHELL;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(2, r * 0.05);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
  const teeth = 6;
  for (let i = 0; i <= teeth; i++) {
    const px = x - rx + (i / teeth) * rx * 2;
    ctx.lineTo(px, y + (i % 2 === 0 ? 0 : -r * 0.16));
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** A baby critter peeking out of its shell. */
export function drawBaby(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, age: number, lookAt: Pt | null): void {
  drawCritter(ctx, { x, y: y - r * 0.2, r: r * 0.85, color, kind: 'normal', stage: 1, age, touched: false }, lookAt, false);
  shellBottom(ctx, x, y + r * 0.1, r);
}

/** The grown-up critter. */
export function drawGrown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, age: number, lookAt: Pt | null): void {
  drawCritter(ctx, { x, y, r: r * 1.15, color, kind: 'normal', stage: 1, age, touched: false }, lookAt, false);
}

const RAINBOW = ['#ff5a5a', '#ffb13f', '#ffd23f', '#7dffa1', '#7ee0ff', '#c59bff'];

/** The sparkly surprise: the grown-up, laughing, with its surprise look and twinkling stars. */
export function drawSurprise(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, kind: number, age: number): void {
  const R = r * 1.15;
  const br = R * 0.56; // the critter's body radius
  ctx.lineCap = 'round';
  if (kind === 2) {
    // rainbow behind
    ctx.lineWidth = Math.max(3, br * 0.16);
    RAINBOW.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.arc(x, y + br * 0.3, br * (1.9 - i * 0.16), Math.PI, Math.PI * 2);
      ctx.stroke();
    });
  }
  if (kind === 1) {
    // flapping wings behind
    const flap = Math.sin(age * 16) * 0.35;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(2, br * 0.06);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + side * br * 1.05, y - br * 0.2, br * 0.75, br * 0.38, side * (0.5 + flap), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  drawCritter(ctx, { x, y, r: R, color, kind: 'normal', stage: 3, age, touched: false }, null, false);
  if (kind === 0) {
    // golden crown
    const w = br * 0.55;
    const top = y - br * 1.0;
    ctx.fillStyle = '#ffd600';
    ctx.strokeStyle = '#b58900';
    ctx.lineWidth = Math.max(2, br * 0.05);
    ctx.beginPath();
    ctx.moveTo(x - w, top);
    ctx.lineTo(x - w, top - br * 0.45);
    ctx.lineTo(x - w * 0.5, top - br * 0.2);
    ctx.lineTo(x, top - br * 0.55);
    ctx.lineTo(x + w * 0.5, top - br * 0.2);
    ctx.lineTo(x + w, top - br * 0.45);
    ctx.lineTo(x + w, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff4d8a';
    ctx.beginPath();
    ctx.arc(x, top - br * 0.12, br * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 3) {
    // party hat
    const base = y - br * 0.85;
    ctx.fillStyle = colorOf(color + 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, br * 0.06);
    ctx.beginPath();
    ctx.moveTo(x - br * 0.38, base);
    ctx.lineTo(x + br * 0.38, base);
    ctx.lineTo(x + br * 0.12, base - br * 1.0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + br * 0.12, base - br * 1.0, br * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  // twinkling stars around it
  for (let i = 0; i < 5; i++) {
    const a = age * 2.2 + (i * Math.PI * 2) / 5;
    const d = br * (1.6 + 0.15 * Math.sin(age * 7 + i));
    star(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, br * (0.14 + 0.05 * Math.sin(age * 9 + i * 2)), true);
  }
}
