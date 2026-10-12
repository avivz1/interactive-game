// Draws the tracked player over the video: soft skeleton, a clear head ring and
// glowing "magic gloves" on the hands, sized from the player's shoulder width.

import type { Body, Pt } from '../shared/body';
import { BODY_CONNECTIONS } from '../shared/landmarks';

export function drawBody(ctx: CanvasRenderingContext2D, body: Body): void {
  const s = body.shoulderWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(120, 220, 255, 0.75)';
  ctx.lineWidth = Math.max(4, s * 0.07);
  ctx.beginPath();
  for (const [a, b] of BODY_CONNECTIONS) {
    const p = body.points[a];
    const q = body.points[b];
    if (!p || !q) continue;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();

  if (body.head) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(4, s * 0.05);
    ctx.beginPath();
    ctx.arc(body.head.x, body.head.y, body.headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  for (const hand of body.hands) if (hand) drawGlove(ctx, hand, Math.max(14, s * 0.35));
}

export function drawGlove(ctx: CanvasRenderingContext2D, at: Pt, radius: number): void {
  const g = ctx.createRadialGradient(at.x, at.y, radius * 0.1, at.x, at.y, radius);
  g.addColorStop(0, 'rgba(255, 245, 160, 0.95)');
  g.addColorStop(0.55, 'rgba(255, 214, 0, 0.6)');
  g.addColorStop(1, 'rgba(255, 170, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fill();
}
