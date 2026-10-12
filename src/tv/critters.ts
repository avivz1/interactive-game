// Procedural art for the bubble-creatures (no image files): a soap-bubble shell
// with a little round critter inside whose face reacts to being tickled.

import type { Pt } from '../shared/body';

export const CRITTER_COLORS = ['#ff7eb6', '#7ee0ff', '#ffd23f', '#9dff7a', '#c59bff'];

let shellSprite: HTMLCanvasElement | null = null;

/** The bubble shell is drawn once into a sprite and scaled, which is cheap on TVs. */
function shell(): HTMLCanvasElement {
  if (shellSprite) return shellSprite;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const r = size / 2;
    const fill = g.createRadialGradient(r * 0.75, r * 0.7, r * 0.1, r, r, r);
    fill.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
    fill.addColorStop(0.75, 'rgba(160, 220, 255, 0.12)');
    fill.addColorStop(0.93, 'rgba(200, 160, 255, 0.45)');
    fill.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    g.fillStyle = fill;
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    g.beginPath();
    g.arc(r, r, r - 5, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.beginPath();
    g.ellipse(r * 0.6, r * 0.5, r * 0.18, r * 0.09, -0.7, 0, Math.PI * 2);
    g.fill();
  }
  shellSprite = c;
  return c;
}

export interface CritterLook {
  x: number;
  y: number;
  r: number;
  color: number;
  kind: 'normal' | 'sneezy' | 'sleepy';
  /** 0 calm .. 3 laughing hard */
  stage: number;
  age: number;
  touched: boolean;
}

export function drawCritter(ctx: CanvasRenderingContext2D, c: CritterLook, lookAt: Pt | null, withShell = true): void {
  const shake = c.stage > 0 ? Math.sin(c.age * 45) * c.stage * c.r * 0.03 : 0;
  const x = c.x + shake;
  const y = c.y;
  const br = c.r * 0.56;
  const color = CRITTER_COLORS[c.color % CRITTER_COLORS.length];

  // ears
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - br * 0.62, y - br * 0.78, br * 0.28, 0, Math.PI * 2);
  ctx.arc(x + br * 0.62, y - br * 0.78, br * 0.28, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.beginPath();
  ctx.arc(x, y, br, 0, Math.PI * 2);
  ctx.fill();

  const eyeY = y - br * 0.18;
  const eyeDx = br * 0.36;
  const eyeR = br * 0.2;
  const asleep = c.kind === 'sleepy' && !c.touched && c.stage === 0;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, br * 0.08);
  ctx.strokeStyle = '#1b1530';
  if (asleep || c.stage >= 2) {
    // closed eyes: sleepy lines or happy ^ ^
    for (const dx of [-eyeDx, eyeDx]) {
      ctx.beginPath();
      if (asleep) {
        ctx.moveTo(x + dx - eyeR, eyeY);
        ctx.lineTo(x + dx + eyeR, eyeY);
      } else {
        ctx.moveTo(x + dx - eyeR, eyeY + eyeR * 0.4);
        ctx.lineTo(x + dx, eyeY - eyeR * 0.5);
        ctx.lineTo(x + dx + eyeR, eyeY + eyeR * 0.4);
      }
      ctx.stroke();
    }
  } else {
    let lx = 0;
    let ly = 0;
    if (lookAt) {
      const dx = lookAt.x - x;
      const dy = lookAt.y - y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      lx = (dx / d) * eyeR * 0.4;
      ly = (dy / d) * eyeR * 0.4;
    }
    for (const dx of [-eyeDx, eyeDx]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + dx, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1530';
      ctx.beginPath();
      ctx.arc(x + dx + lx, eyeY + ly, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (c.stage >= 1) {
    ctx.fillStyle = 'rgba(255, 90, 140, 0.55)';
    ctx.beginPath();
    ctx.arc(x - br * 0.6, y + br * 0.15, br * 0.15, 0, Math.PI * 2);
    ctx.arc(x + br * 0.6, y + br * 0.15, br * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  const mouthY = y + br * 0.3;
  if (c.kind === 'sneezy' && c.stage >= 2) {
    ctx.fillStyle = '#1b1530';
    ctx.beginPath();
    ctx.arc(x, mouthY, br * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (c.stage >= 2) {
    ctx.fillStyle = '#1b1530';
    ctx.beginPath();
    ctx.arc(x, mouthY - br * 0.05, br * (0.22 + c.stage * 0.04), 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ff6b8a';
    ctx.beginPath();
    ctx.arc(x, mouthY + br * 0.1, br * 0.1, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, mouthY - br * 0.1, br * (c.stage ? 0.24 : 0.18), 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  if (c.kind === 'sneezy') {
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(x, y + br * 0.05, br * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  if (asleep) {
    ctx.fillStyle = '#fff';
    ctx.font = '800 ' + Math.round(br * 0.5) + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const bob = Math.sin(c.age * 2) * br * 0.1;
    ctx.fillText('z', x + br * 0.7, y - br * 0.9 + bob);
    ctx.fillText('z', x + br * 1.0, y - br * 1.3 + bob);
  }

  if (withShell) ctx.drawImage(shell(), c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
}
