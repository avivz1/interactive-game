// Setup: guides the child to stand where the camera sees their whole body.

import { evaluateFit, FIT_HINTS, type FitState } from '../../games/fit';
import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring } from '../ui';

const HOLD_SEC = 1.5;
const SKIP_HINT_AFTER_SEC = 12;

export class SetupScene implements Scene {
  readonly name = 'setup';
  private state: FitState = 'no-body';
  private okFor = 0;
  private elapsed = 0;
  private done = false;

  constructor(
    private readonly stage: Stage,
    private readonly next: () => Scene,
  ) {}

  update(frame: Frame): void {
    this.elapsed += frame.dt;
    this.state = evaluateFit(frame.landmarks);
    this.okFor = this.state === 'ok' ? this.okFor + frame.dt : Math.max(0, this.okFor - frame.dt * 2);
    if (this.okFor >= HOLD_SEC) this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.stage.sound.cheer();
    this.stage.go(this.next());
  }

  onKey(key: Key): void {
    // The first press only turns the sound on; after that OK skips the check.
    if (key === 'ok' && this.stage.sound.ready) this.finish();
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { rect, width, height } = frame;
    const ok = this.state === 'ok';
    // target outline: where to stand
    const cx = rect.x + rect.w / 2;
    const top = rect.y + rect.h * 0.1;
    const bottom = rect.y + rect.h * 0.94;
    const hgt = bottom - top;
    ctx.save();
    ctx.setLineDash([hgt * 0.03, hgt * 0.02]);
    ctx.lineWidth = Math.max(4, hgt * 0.012);
    ctx.strokeStyle = ok ? 'rgba(125, 255, 161, 0.9)' : 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, top + hgt * 0.09, hgt * 0.09, 0, Math.PI * 2);
    ctx.moveTo(cx - hgt * 0.14, top + hgt * 0.22);
    ctx.lineTo(cx + hgt * 0.14, top + hgt * 0.22);
    ctx.lineTo(cx + hgt * 0.1, top + hgt * 0.58);
    ctx.lineTo(cx + hgt * 0.08, bottom);
    ctx.moveTo(cx - hgt * 0.14, top + hgt * 0.22);
    ctx.lineTo(cx - hgt * 0.1, top + hgt * 0.58);
    ctx.lineTo(cx - hgt * 0.08, bottom);
    ctx.stroke();
    ctx.restore();

    drawBody(ctx, frame.body);

    const titleY = height * 0.1;
    panel(ctx, width * 0.12, titleY - height * 0.055, width * 0.76, height * 0.11, height * 0.03, 'rgba(11, 16, 32, 0.7)');
    label(ctx, FIT_HINTS[this.state], width / 2, titleY, height * 0.05, ok ? '#7dffa1' : '#fff');
    if (ok) ring(ctx, { x: width * 0.84, y: titleY }, height * 0.035, this.okFor / HOLD_SEC, '#7dffa1', height * 0.012);

    const tips: string[] = ['Make some space around you 🧸'];
    if (!this.stage.sound.ready) tips.push('🔊 Press OK on the remote for sound');
    else if (this.elapsed > SKIP_HINT_AFTER_SEC) tips.push('Press OK on the remote to play anyway');
    tips.forEach((t, i) => label(ctx, t, width / 2, height * (0.86 + i * 0.06), height * 0.035, '#ffd600'));
  }
}
