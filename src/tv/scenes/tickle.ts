// Tickle Pop: hold a hand on a bubble-creature to tickle it until it pops.

import type { Pt } from '../../shared/body';
import { TicklePop, type Envelope, type GameEvent } from '../../games/tickle-pop';
import { drawCritter } from '../critters';
import { drawBody } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring } from '../ui';

const GIGGLE_WORDS = ['', 'hee!', 'hee hee!', 'HA HA HA!'];
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

  enter(): void {
    this.stage.sound.startMusic(Math.floor(Math.random() * 1000));
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
    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC && !this.game.ended) return;

    const ls = frame.body.points[11];
    const rs = frame.body.points[12];
    const centerX = ls && rs ? (ls.x + rs.x) / 2 : body.head ? body.head.x : rect.x + rect.w / 2;
    const env: Envelope = { centerX, unit, left: rect.x, right: rect.x + rect.w, top: rect.y, bottom: rect.y + rect.h };
    const hands = body.hands.filter((p): p is Pt => !!p);
    const events = this.game.update(dt, env, { hands, head: body.head, handRadius: unit * 0.38, headRadius: body.headRadius });
    for (const e of events) this.react(e, unit);
  }

  private react(e: GameEvent, unit: number): void {
    const sound = this.stage.sound;
    switch (e.type) {
      case 'giggle':
        sound.giggle(e.stage, e.bubble.id);
        this.effects.say(GIGGLE_WORDS[e.stage], e.bubble.x, e.bubble.y - e.bubble.r * 1.25, unit * (0.25 + e.stage * 0.06), '#ffd600', 0.7, 'b' + e.bubble.id);
        break;
      case 'pop':
        sound.pop();
        this.effects.burst(e.bubble.x, e.bubble.y, unit);
        this.effects.parachute(e.bubble.x, e.bubble.y, e.bubble.r, e.bubble.color);
        if (e.cause === 'sneeze' || e.bubble.kind === 'sneezy') {
          sound.achoo();
          this.effects.say('Achoo!', e.bubble.x, e.bubble.y - e.bubble.r, unit * 0.45, '#9dff7a', 1.1, 'b' + e.bubble.id);
        } else if (e.bubble.kind === 'sleepy') {
          sound.yawn();
          this.effects.say('Good morning!', e.bubble.x, e.bubble.y - e.bubble.r, unit * 0.35, '#7ee0ff', 1.1, 'b' + e.bubble.id);
        } else {
          sound.wheee();
          this.effects.say('Wheee!', e.bubble.x, e.bubble.y, unit * 0.35, '#fff', 1.1, 'b' + e.bubble.id);
        }
        this.stage.debug({ popped: this.game.popped });
        break;
      case 'finale':
        this.finaleFor = 2.5;
        sound.cheer();
        break;
      case 'end':
        this.result = { popped: e.popped, stars: e.stars };
        sound.stopMusic();
        sound.cheer();
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

    // HUD: popped counter and time left
    const hud = height * 0.075;
    drawCritter(ctx, { x: width * 0.07, y: hud, r: height * 0.04, color: 1, kind: 'normal', stage: 0, age: 0, touched: false }, null);
    label(ctx, String(this.game.popped), width * 0.07 + height * 0.06, hud, height * 0.055, '#fff', 'left');
    ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, this.game.remaining / this.game.config.durationSec, this.game.inFinale ? '#ff7eb6' : '#7dffa1', height * 0.012);
    label(ctx, String(Math.ceil(this.game.remaining)), width * 0.93, hud, height * 0.035);

    if (this.introFor > 0) label(ctx, 'Tickle the bubbles! 🤗', width / 2, height * 0.2, height * 0.07, '#ffd600');
    if (this.finaleFor > 0) label(ctx, 'Giggle storm!', width / 2, height * 0.2, height * 0.08, '#ff7eb6');
    if (this.awayFor >= AWAY_PAUSE_SEC && !this.game.ended) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, 'Where did you go? Come back! 👀', width / 2, height * 0.5, height * 0.05, '#fff');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.22, width * 0.56, height * 0.56, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, 'Great tickling!', width / 2, height * 0.33, height * 0.07, '#ffd600');
      label(ctx, 'You popped ' + this.result.popped + ' bubbles', width / 2, height * 0.44, height * 0.05);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.57, height * 0.055, i < this.result.stars);
      label(ctx, 'Back to the games in a moment…', width / 2, height * 0.7, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
