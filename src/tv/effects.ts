// Short-lived celebration effects: confetti, critters floating away on a
// parachute, and floating words. Counts are capped to stay smooth on TVs.

import { CRITTER_COLORS, drawCritter } from './critters';
import { label } from './ui';

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
}

interface Parachuter {
  x: number;
  y: number;
  vx: number;
  r: number;
  color: number;
  life: number;
  age: number;
}

interface FloatText {
  key: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

const MAX_CONFETTI = 260;
const CONFETTI_COLORS = ['#ff7eb6', '#7ee0ff', '#ffd23f', '#9dff7a', '#c59bff', '#ffffff'];

export class Effects {
  private confetti: Confetto[] = [];
  private chutes: Parachuter[] = [];
  private texts: FloatText[] = [];

  burst(x: number, y: number, unit: number, count = 26): void {
    for (let i = 0; i < count && this.confetti.length < MAX_CONFETTI; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = unit * (1.5 + Math.random() * 3);
      this.confetti.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - unit * 2,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        size: unit * (0.06 + Math.random() * 0.06),
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        life: 1.6 + Math.random() * 0.6,
      });
    }
  }

  parachute(x: number, y: number, r: number, color: number): void {
    if (this.chutes.length > 8) this.chutes.shift();
    this.chutes.push({ x, y, vx: (Math.random() < 0.5 ? -1 : 1) * r * 1.2, r: r * 0.6, color, life: 3, age: 0 });
  }

  /** Floating words; a new text with the same key replaces the old one (no overlaps). */
  say(text: string, x: number, y: number, size: number, color = '#fff', life = 1.1, key = ''): void {
    if (key) this.texts = this.texts.filter((t) => t.key !== key);
    if (this.texts.length > 10) this.texts.shift();
    this.texts.push({ key, text, x, y, size, color, life, maxLife: life });
  }

  update(dt: number, unit: number): void {
    const g = unit * 9;
    this.confetti = this.confetti.filter((p) => {
      p.vy += g * dt;
      p.vx *= 1 - dt * 1.5;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= dt;
      return p.life > 0;
    });
    this.chutes = this.chutes.filter((c) => {
      c.age += dt;
      c.x += c.vx * dt;
      c.y += c.r * 0.9 * dt;
      c.life -= dt;
      return c.life > 0;
    });
    this.texts = this.texts.filter((t) => {
      t.y -= t.size * 0.8 * dt;
      t.life -= dt;
      return t.life > 0;
    });
  }

  render(ctx: CanvasRenderingContext2D, width = Infinity): void {
    for (const p of this.confetti) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
      ctx.restore();
    }
    for (const c of this.chutes) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life);
      const sway = Math.sin(c.age * 3) * 0.15;
      ctx.translate(c.x, c.y);
      ctx.rotate(sway);
      // canopy
      ctx.fillStyle = CRITTER_COLORS[(c.color + 2) % CRITTER_COLORS.length];
      ctx.beginPath();
      ctx.arc(0, -c.r * 2.2, c.r * 1.5, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(1, c.r * 0.05);
      ctx.beginPath();
      ctx.moveTo(-c.r * 1.5, -c.r * 2.2);
      ctx.lineTo(-c.r * 0.4, -c.r * 0.4);
      ctx.moveTo(c.r * 1.5, -c.r * 2.2);
      ctx.lineTo(c.r * 0.4, -c.r * 0.4);
      ctx.stroke();
      drawCritter(ctx, { x: 0, y: 0, r: c.r, color: c.color, kind: 'normal', stage: 2, age: c.age, touched: false }, null, false);
      ctx.restore();
    }
    for (const t of this.texts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (t.life / t.maxLife) * 2);
      // keep words fully on screen
      ctx.font = '800 ' + Math.round(t.size) + 'px sans-serif';
      const half = ctx.measureText(t.text).width / 2 + t.size * 0.3;
      const x = Math.max(half, Math.min(width - half, t.x));
      label(ctx, t.text, x, t.y, t.size, t.color);
      ctx.restore();
    }
  }
}
