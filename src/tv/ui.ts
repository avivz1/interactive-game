// Canvas drawing helpers shared by the TV scenes.

import type { Pt } from '../shared/body';

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Samsung One', sans-serif";

/** Big outlined text that stays readable on top of any video. */
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center'): void {
  ctx.font = '800 ' + Math.round(size) + 'px ' + FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.16);
  ctx.strokeStyle = 'rgba(11, 16, 32, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Like label(), but shrinks the text so it is never wider than maxWidth. */
export function fitLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxWidth: number, color = '#fff'): void {
  ctx.font = '800 ' + Math.round(size) + 'px ' + FONT;
  const w = ctx.measureText(text).width;
  label(ctx, text, x, y, w > maxWidth && w > 0 ? Math.max(12, (size * maxWidth) / w) : size, color);
}

/** A rounded panel behind text or a menu tile. */
export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number, fill: string, stroke?: string): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = Math.max(3, hgt * 0.04);
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Circular progress ring (hold-to-select, timers). */
export function ring(ctx: CanvasRenderingContext2D, at: Pt, radius: number, progress: number, color: string, width: number): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (progress <= 0) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
  ctx.stroke();
}

export const distance = (a: Pt, b: Pt): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** A five-pointed star for results screens (filled = earned). */
export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, filled: boolean): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = filled ? '#ffd600' : 'rgba(255,255,255,0.25)';
  ctx.fill();
}
