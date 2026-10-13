// Setup: guides the player to stand where the camera sees their whole body,
// with room for raised hands.

import { evaluateFit, roomBelowFeet, type FitState } from '../../games/fit';
import { t } from '../../shared/i18n';
import type { VoiceKey } from '../audio';
import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring } from '../ui';

const HOLD_SEC = 1.5;
const SKIP_HINT_AFTER_SEC = 12;
/** A hint is spoken once the state has held this long (avoids chatter while moving). */
const SPEAK_AFTER_SEC = 1.2;
/** The same hint is repeated at most this often. */
const REPEAT_SEC = 7;

const FIT_VOICE: Record<FitState, VoiceKey> = {
  'no-body': 'stand',
  'head-cut': 'head',
  'too-close': 'close',
  'feet-cut': 'feet',
  'too-far': 'far',
  'hands-cut': 'hands_cut',
  ok: 'ok',
};

export class SetupScene implements Scene {
  readonly name = 'setup';
  private state: FitState = 'no-body';
  private okFor = 0;
  private elapsed = 0;
  private done = false;
  private stateFor = 0;
  private spokenState: FitState | null = null;
  private spokenAt = -100;

  constructor(
    private readonly stage: Stage,
    private readonly next: () => Scene,
  ) {}

  enter(): void {
    this.stage.sound.speak('space');
  }

  update(frame: Frame): void {
    this.elapsed += frame.dt;
    const state = evaluateFit(frame.landmarks);
    this.stateFor = state === this.state ? this.stateFor + frame.dt : 0;
    this.state = state;
    this.speakHint();
    this.okFor = this.state === 'ok' ? this.okFor + frame.dt : Math.max(0, this.okFor - frame.dt * 2);
    if (this.okFor >= HOLD_SEC) this.finish();
  }

  private speakHint(): void {
    const sound = this.stage.sound;
    if (sound.isSpeaking) return;
    const wait = this.state === 'ok' ? 0.2 : SPEAK_AFTER_SEC;
    if (this.stateFor < wait) return;
    const fresh = this.state !== this.spokenState;
    if (!fresh && (this.state === 'ok' || this.elapsed - this.spokenAt < REPEAT_SEC)) return;
    this.spokenState = this.state;
    this.spokenAt = this.elapsed;
    sound.speak(FIT_VOICE[this.state], 0);
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
    const text = this.state === 'hands-cut' && roomBelowFeet(frame.landmarks) ? t('fit.hands-cut-phone') : t(('fit.' + this.state) as 'fit.ok');
    label(ctx, text, width / 2, titleY, height * 0.05, ok ? '#7dffa1' : '#fff');
    if (ok) ring(ctx, { x: width * 0.84, y: titleY }, height * 0.035, this.okFor / HOLD_SEC, '#7dffa1', height * 0.012);

    const tips: string[] = [t('setup.space')];
    // an upright phone gives a narrow picture: little room for arms out to the sides
    // (not while head, feet or raised hands are cut off: an upright phone has more room for those)
    if (frame.rect.w < frame.rect.h && this.state !== 'hands-cut' && this.state !== 'head-cut' && this.state !== 'feet-cut') tips.push(t('setup.sideways'));
    if (!this.stage.sound.ready) tips.push(t('hint.sound'));
    else if (this.elapsed > SKIP_HINT_AFTER_SEC) tips.push(t('hint.skip'));
    tips.forEach((t, i) => label(ctx, t, width / 2, height * (0.86 + i * 0.06), height * 0.035, '#ffd600'));
  }
}
