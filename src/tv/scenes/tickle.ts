// Tickle Pop: hold a hand (or a lifted foot) on a bubble-creature to tickle it
// until it pops. Sleepy bubbles nap near the floor: kick them awake.

import { Limbs, present, type Touchers } from '../../games/limbs';
import { TicklePop, type Envelope, type GameEvent } from '../../games/tickle-pop';
import { t, type TextKey } from '../../shared/i18n';
import { drawCritter } from '../critters';
import { drawBody, drawGlove } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring } from '../ui';

const GIGGLE_WORDS: TextKey[] = ['tickle.giggle1', 'tickle.giggle1', 'tickle.giggle2', 'tickle.giggle3'];
const AWAY_PAUSE_SEC = 2;
const RESULTS_SEC = 8;

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, filled: boolean): void {
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

export class TickleScene implements Scene {
  readonly name = 'tickle-pop';
  private game: TicklePop;
  private effects = new Effects();
  private awayFor = 0;
  private result: { popped: number; stars: number } | null = null;
  private resultFor = 0;
  private introFor = 2.5;
  private finaleFor = 0;
  private left = false;

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
    roundSec: number,
  ) {
    this.game = new TicklePop({ durationSec: roundSec, tickleSec: 0.45, seed: Math.floor(Math.random() * 1e9) });
  }

  private readonly limbs = new Limbs();
  private sleepyAnnounced = false;
  private touchers: Touchers = { hands: [null, null], feet: [null, null] };
  private awaySpokenAt = -100;
  private clock = 0;

  enter(): void {
    this.stage.sound.startMusic(Math.floor(Math.random() * 1000));
    this.stage.sound.speak('tickle', 0);
    this.stage.debug({ popped: 0, ended: false });
  }

  exit(): void {
    this.stage.sound.stopMusic();
  }

  private leave(): void {
    if (this.left) return;
    this.left = true;
    this.stage.go(this.back());
  }

  onKey(key: Key): void {
    if (key === 'back' || (key === 'ok' && this.result)) this.leave();
  }

  update(frame: Frame): void {
    const { body, rect, dt } = frame;
    const unit = body.shoulderWidth;
    this.effects.update(dt, unit);
    this.introFor = Math.max(0, this.introFor - dt);
    this.finaleFor = Math.max(0, this.finaleFor - dt);

    if (this.result) {
      this.resultFor += dt;
      if (this.resultFor >= RESULTS_SEC) this.leave();
    }

    // Pause while the child is out of the picture.
    this.clock += dt;
    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC && !this.game.ended) {
      if (this.clock - this.awaySpokenAt > 8) {
        this.awaySpokenAt = this.clock;
        this.stage.sound.speak('away', 0);
      }
      return;
    }

    const ls = frame.body.points[11];
    const rs = frame.body.points[12];
    const centerX = ls && rs ? (ls.x + rs.x) / 2 : body.head ? body.head.x : rect.x + rect.w / 2;
    const env: Envelope = { centerX, unit, left: rect.x, right: rect.x + rect.w, top: rect.y, bottom: rect.y + rect.h };
    // Only reaching hands and lifted feet tickle (never the head, the body, or
    // a hand hanging at the side).
    this.touchers = this.limbs.update(body, dt);
    const events = this.game.update(dt, env, {
      hands: present(this.touchers.hands),
      feet: present(this.touchers.feet),
      handRadius: unit * 0.28,
      footRadius: unit * 0.3,
    });
    for (const e of events) this.react(e, unit);
    // Explain sleepy bubbles the first time one settles down for a nap.
    if (!this.sleepyAnnounced && this.game.bubbles.some((b) => b.kind === 'sleepy' && b.y < rect.y + rect.h - unit)) {
      this.sleepyAnnounced = true;
      this.stage.sound.speak('sleepy', 0);
    }
  }

  private react(e: GameEvent, unit: number): void {
    const sound = this.stage.sound;
    switch (e.type) {
      case 'giggle':
        sound.giggle(e.stage, e.bubble.id);
        this.effects.say(t(GIGGLE_WORDS[e.stage]), e.bubble.x, e.bubble.y - e.bubble.r * 1.25, unit * (0.25 + e.stage * 0.06), '#ffd600', 0.7, 'b' + e.bubble.id);
        break;
      case 'pop':
        sound.pop();
        this.effects.burst(e.bubble.x, e.bubble.y, unit);
        this.effects.parachute(e.bubble.x, e.bubble.y, e.bubble.r, e.bubble.color);
        if (e.cause === 'sneeze' || e.bubble.kind === 'sneezy') {
          sound.achoo();
          this.effects.say(t('tickle.achoo'), e.bubble.x, e.bubble.y - e.bubble.r, unit * 0.45, '#9dff7a', 1.1, 'b' + e.bubble.id);
        } else if (e.bubble.kind === 'sleepy') {
          sound.yawn();
          this.effects.say(t('tickle.morning'), e.bubble.x, e.bubble.y - e.bubble.r, unit * 0.35, '#7ee0ff', 1.1, 'b' + e.bubble.id);
        } else {
          sound.wheee();
          this.effects.say(t('tickle.wheee'), e.bubble.x, e.bubble.y, unit * 0.35, '#fff', 1.1, 'b' + e.bubble.id);
        }
        this.stage.debug({ popped: this.game.popped });
        break;
      case 'finale':
        this.finaleFor = 2.5;
        sound.cheer();
        sound.speak('finale', 0);
        break;
      case 'end':
        this.result = { popped: e.popped, stars: e.stars };
        sound.stopMusic();
        sound.cheer();
        sound.speak('great', 0);
        this.stage.debug({ ended: true, popped: e.popped, stars: e.stars });
        break;
      case 'escape':
        break;
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const lookAt = body.hands[0] || body.hands[1] || body.head;
    for (const b of this.game.bubbles) drawCritter(ctx, b, lookAt);
    this.effects.render(ctx, width);
    drawBody(ctx, body, 0.25);
    // a lifted foot glows like the hands: it can kick bubbles now
    for (const f of this.touchers.feet) if (f) drawGlove(ctx, f, Math.max(14, body.shoulderWidth * 0.32));

    // HUD: popped counter and time left
    const hud = height * 0.075;
    drawCritter(ctx, { x: width * 0.07, y: hud, r: height * 0.04, color: 1, kind: 'normal', stage: 0, age: 0, touched: false }, null);
    label(ctx, String(this.game.popped), width * 0.07 + height * 0.06, hud, height * 0.055, '#fff', 'left');
    ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, this.game.remaining / this.game.config.durationSec, this.game.inFinale ? '#ff7eb6' : '#7dffa1', height * 0.012);
    label(ctx, String(Math.ceil(this.game.remaining)), width * 0.93, hud, height * 0.035);

    if (this.introFor > 0) label(ctx, t('tickle.intro'), width / 2, height * 0.2, height * 0.07, '#ffd600');
    if (this.finaleFor > 0) label(ctx, t('tickle.finale'), width / 2, height * 0.2, height * 0.08, '#ff7eb6');
    if (this.awayFor >= AWAY_PAUSE_SEC && !this.game.ended) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, t('tickle.away'), width / 2, height * 0.5, height * 0.05, '#fff');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.22, width * 0.56, height * 0.56, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, t('tickle.great'), width / 2, height * 0.33, height * 0.07, '#ffd600');
      label(ctx, t('tickle.popped', { n: this.result.popped }), width / 2, height * 0.44, height * 0.05);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.57, height * 0.055, i < this.result.stars);
      label(ctx, t('tickle.back_soon'), width / 2, height * 0.7, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
