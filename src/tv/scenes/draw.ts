// Draw & Alive: the child draws a creature in the air (a hand inside the board
// is the pen), holds a hand on the green ✓ when done (remote: OK; ◀ starts
// over), and the drawing comes
// alive — named and coloured by the creature AI when it answers in time, or
// locally otherwise. Then they play: pet it, jump with it, play peekaboo.

import type { Pt } from '../../shared/body';
import { Creature, funStars, type CreatureEvent } from '../../games/creature';
import { Dwell } from '../../games/dwell';
import { buildShape, fromImage, MIN_INK, Sheet, type Box, type ImageFit, type Shape } from '../../games/drawing';
import { DRAWING_IMAGE_SIZE, PERSONALITIES, type CreatureTraits } from '../../shared/creature-api';
import { getLang, t } from '../../shared/i18n';
import { askCreature } from '../creature-client';
import { drawCreature, drawingPng, drawInk, heart, PEN_COLORS } from '../creature-art';
import { drawBody, drawGlove } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { distance, label, panel, ring } from '../ui';

type Phase = 'draw' | 'magic' | 'play' | 'end';

/** The magic moment lasts at least this long, and waits for the AI at most this long. */
const MAGIC_MIN_SEC = 2.4;
const MAGIC_MAX_SEC = 5.2;
const AI_TIMEOUT_MS = 5000;
const AWAY_PAUSE_SEC = 2;
const RESULTS_SEC = 8;
const BUTTON_HOLD_MS = 1200;

const LOCAL_COLORS: Array<[string, string]> = [
  ['#7ee0ff', '#ff7eb6'],
  ['#ffd23f', '#7dffa1'],
  ['#ff9ecf', '#c59bff'],
  ['#9dff7a', '#ffb347'],
  ['#c59bff', '#ffd23f'],
  ['#ffb347', '#7ee0ff'],
];

export interface DrawOptions {
  drawSec: number;
  playSec: number;
}

/** A creature made without the AI: a cute name, random colours and personality. */
export function localTraits(rand: () => number): CreatureTraits {
  const names = t('draw.names').split(',');
  const name = names[Math.floor(rand() * names.length) % names.length];
  const colors = LOCAL_COLORS[Math.floor(rand() * LOCAL_COLORS.length) % LOCAL_COLORS.length];
  const r = rand();
  return {
    looksLike: '',
    name,
    greeting: t('draw.hello', { name }),
    personality: PERSONALITIES[Math.floor(rand() * PERSONALITIES.length) % PERSONALITIES.length],
    move: r < 0.4 ? 'hop' : r < 0.75 ? 'walk' : 'fly',
    bodyColor: colors[0],
    accentColor: colors[1],
    face: null,
  };
}

function check(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(4, r * 0.22);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.45, y + r * 0.02);
  ctx.lineTo(x - r * 0.1, y + r * 0.38);
  ctx.lineTo(x + r * 0.5, y - r * 0.35);
  ctx.stroke();
}

function again(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = Math.max(4, r * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, -Math.PI * 0.35, Math.PI * 1.3);
  ctx.stroke();
  const a = -Math.PI * 0.35;
  const ax = x + Math.cos(a) * r * 0.45;
  const ay = y + Math.sin(a) * r * 0.45;
  ctx.beginPath();
  ctx.moveTo(ax + r * 0.22, ay - r * 0.05);
  ctx.lineTo(ax - r * 0.12, ay - r * 0.22);
  ctx.lineTo(ax - r * 0.02, ay + r * 0.2);
  ctx.closePath();
  ctx.fill();
}

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

export class DrawScene implements Scene {
  readonly name = 'draw-alive';
  private phase: Phase = 'draw';
  private readonly sheet = new Sheet();
  private readonly effects = new Effects();
  private clock = 0;
  private awayFor = 0;
  private awaySpokenAt = -100;
  private left = false;
  /** Bumped on exit so a late AI answer is ignored. */
  private token = 0;

  // drawing
  private board: Box | null = null;
  private buttons: { done: Pt; clear: Pt; r: number } | null = null;
  private readonly doneDwell = new Dwell(BUTTON_HOLD_MS);
  private readonly clearDwell = new Dwell(BUTTON_HOLD_MS);
  private drawLeft: number;
  private timerStarted = false;
  private moreFor = 0;
  private enoughAt = -1;
  private doneSpokenAt = -100;
  private lastInkDebug = 0;

  // magic
  private magicFor = 0;
  private strokes: Pt[][] = [];
  private fit: ImageFit | null = null;
  /** undefined while the AI is thinking; null when it could not help. */
  private aiTraits: CreatureTraits | null | undefined = undefined;

  // play
  private shape: Shape | null = null;
  private traits: CreatureTraits | null = null;
  private creature: Creature | null = null;
  private revealAge = 0;
  private playLeft: number;
  private playSpoken = false;
  private greetFor = 0;
  private hidden = false;
  private ground: number | null = null;
  private lastPetAt = -10;

  // end
  private result: { fun: number; stars: number } | null = null;
  private resultFor = 0;

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
    private readonly opts: DrawOptions,
  ) {
    this.drawLeft = opts.drawSec;
    this.playLeft = opts.playSec;
  }

  enter(): void {
    this.stage.sound.startMusic(Math.floor(Math.random() * 1000));
    this.stage.sound.speak('draw', 0);
    this.stage.debug({ drawPhase: 'draw', ink: 0, ended: false, creatureName: null, creatureSource: null, fun: 0 });
  }

  exit(): void {
    this.token++;
    this.stage.sound.stopMusic();
  }

  private leave(): void {
    if (this.left) return;
    this.left = true;
    this.stage.go(this.back());
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.stage.debug({ drawPhase: phase });
  }

  onKey(key: Key): void {
    if (key === 'back') this.leave();
    else if (key === 'ok' && this.phase === 'draw') this.tryFinish();
    else if (key === 'left' && this.phase === 'draw') this.startOver();
    else if (key === 'ok' && this.phase === 'end') this.leave();
  }

  private startOver(): void {
    this.sheet.clear();
    this.timerStarted = false;
    this.drawLeft = this.opts.drawSec;
    this.enoughAt = -1;
    this.stage.sound.pop();
    this.stage.debug({ ink: 0 });
  }

  /** Board and buttons around the child; they follow the child until the first line. */
  private place(frame: Frame): void {
    const { body, rect } = frame;
    const ls = body.points[11];
    const rs = body.points[12];
    if (!ls || !rs) return;
    if (this.board && (this.sheet.strokes.length > 0 || this.sheet.liveStrokes.length > 0)) return;
    const s = body.shoulderWidth;
    const cx = (ls.x + rs.x) / 2;
    const sy = (ls.y + rs.y) / 2;
    const r = Math.max(s * 0.55, rect.h * 0.07);
    const clampX = (x: number) => Math.max(rect.x + r * 1.1, Math.min(rect.x + rect.w - r * 1.1, x));
    const by = Math.max(rect.y + rect.h * 0.02, sy - s * 1.5);
    const target: Box = { x: cx - s * 1.4, y: by, w: s * 2.8, h: Math.min(rect.y + rect.h, sy + s * 0.65) - by };
    target.x = Math.max(rect.x, Math.min(rect.x + rect.w - target.w, target.x));
    const btnY = Math.max(rect.y + r * 1.2, sy - s * 0.7);
    const done = { x: clampX(cx + s * 2.15), y: btnY };
    const clear = { x: clampX(cx - s * 2.15), y: btnY };
    if (!this.board || !this.buttons) {
      this.board = target;
      this.buttons = { done, clear, r };
      return;
    }
    const k = Math.min(1, frame.dt * 4);
    const b = this.board;
    b.x += (target.x - b.x) * k;
    b.y += (target.y - b.y) * k;
    b.w += (target.w - b.w) * k;
    b.h += (target.h - b.h) * k;
    const bt = this.buttons;
    bt.done = { x: bt.done.x + (done.x - bt.done.x) * k, y: bt.done.y + (done.y - bt.done.y) * k };
    bt.clear = { x: bt.clear.x + (clear.x - bt.clear.x) * k, y: bt.clear.y + (clear.y - bt.clear.y) * k };
    bt.r += (r - bt.r) * k;
  }

  private toSheet(p: Pt): Pt {
    const b = this.board!;
    return { x: (p.x - b.x) / b.h, y: (p.y - b.y) / b.h };
  }

  private toScreen = (p: Pt): Pt => {
    const b = this.board!;
    return { x: b.x + p.x * b.h, y: b.y + p.y * b.h };
  };

  private onBoard(p: Pt, margin: number): boolean {
    const b = this.board!;
    return p.x >= b.x - margin && p.x <= b.x + b.w + margin && p.y >= b.y - margin && p.y <= b.y + b.h + margin;
  }

  private tryFinish(): void {
    if (this.phase !== 'draw') return;
    if (this.sheet.ink() < MIN_INK) {
      this.moreFor = 2.5;
      this.stage.sound.speak('draw', 3);
      return;
    }
    this.finishDrawing();
  }

  private finishDrawing(): void {
    this.sheet.liftAll();
    this.strokes = this.sheet.strokes.map((s) => s.slice());
    this.magicFor = 0;
    this.setPhase('magic');
    this.stage.sound.select();
    this.stage.sound.magic();
    const png = drawingPng(this.strokes);
    if (!png) {
      this.aiTraits = null;
      return;
    }
    this.fit = png.fit;
    const token = this.token;
    void askCreature(png.data, getLang(), AI_TIMEOUT_MS).then((traits) => {
      if (token === this.token) this.aiTraits = traits;
    });
  }

  private reveal(frame: Frame): void {
    const traits = this.aiTraits || localTraits(Math.random);
    const source = this.aiTraits ? 'ai' : 'local';
    let face: Pt | null = null;
    if (traits.face && this.fit) face = fromImage(this.fit, { x: traits.face.x * DRAWING_IMAGE_SIZE, y: traits.face.y * DRAWING_IMAGE_SIZE });
    const shape = buildShape(this.strokes, face);
    if (!shape || !this.board) {
      this.leave();
      return;
    }
    this.shape = shape;
    this.traits = traits;
    const b = this.board;
    const span = Math.max(shape.box.w, shape.box.h, 0.05) * b.h;
    const feet = this.toScreen({ x: shape.box.x + shape.box.w / 2, y: shape.box.y + shape.box.h });
    this.creature = new Creature(traits.personality, traits.move, feet, span, Math.floor(Math.random() * 1e9), { w: shape.width, h: shape.height });
    this.revealAge = 0;
    this.greetFor = 3.5;
    this.playLeft = this.opts.playSec;
    this.setPhase('play');
    const mid = this.creature.middle;
    this.effects.burst(mid.x, mid.y, frame.body.shoulderWidth, 40);
    this.stage.sound.boing();
    this.stage.sound.cheer();
    this.stage.sound.speak('alive', 0);
    this.stage.debug({
      creatureName: traits.name,
      creatureSource: source,
      looksLike: traits.looksLike,
      personality: traits.personality,
      move: traits.move,
      strokes: shape.strokes.length,
      fills: shape.fills.length,
    });
  }

  update(frame: Frame): void {
    const { dt, body } = frame;
    const unit = body.shoulderWidth;
    this.clock += dt;
    this.effects.update(dt, unit);
    this.moreFor = Math.max(0, this.moreFor - dt);
    this.greetFor = Math.max(0, this.greetFor - dt);

    if (this.phase === 'end') {
      this.resultFor += dt;
      this.updateCreature(frame);
      if (this.resultFor >= RESULTS_SEC) this.leave();
      return;
    }

    // Pause while the child is out of the picture.
    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC && this.phase !== 'magic') {
      this.sheet.liftAll();
      if (this.clock - this.awaySpokenAt > 8) {
        this.awaySpokenAt = this.clock;
        this.stage.sound.speak('away', 0);
      }
      return;
    }

    if (this.phase === 'draw') this.updateDraw(frame);
    else if (this.phase === 'magic') this.updateMagic(frame);
    else if (this.phase === 'play') this.updatePlay(frame);
  }

  private updateDraw(frame: Frame): void {
    const { body, dt } = frame;
    this.place(frame);
    if (!this.board || !this.buttons) return;
    const s = body.shoulderWidth;
    for (let i = 0; i < 2; i++) {
      const hand = body.hands[i];
      // A line starts a little inside the border and may run a little past it, so a
      // hand hovering at the edge doesn't scribble and a line doesn't break there.
      const on = !!hand && this.onBoard(hand, this.sheet.isDrawing(i) ? s * 0.12 : -s * 0.15);
      this.sheet.update(i, hand ? this.toSheet(hand) : null, on, this.clock);
    }
    const ink = this.sheet.ink();
    if (!this.timerStarted && ink > 0) this.timerStarted = true;
    if (this.timerStarted) this.drawLeft -= dt;

    const bt = this.buttons;
    const near = (at: Pt) => body.hands.some((h) => !!h && distance(h, at) <= bt.r + s * 0.25);
    if (this.clearDwell.update(near(bt.clear) && ink > 0, dt * 1000)) this.startOver();
    if (this.doneDwell.update(near(bt.done), dt * 1000)) this.tryFinish();
    if (this.phase !== 'draw') return;

    if (ink >= MIN_INK && this.enoughAt < 0) this.enoughAt = this.clock;
    // Once there is enough to bring alive, remind them how to finish.
    if (this.enoughAt >= 0 && this.clock - this.enoughAt > 4 && this.clock - this.doneSpokenAt > 15) {
      this.doneSpokenAt = this.clock;
      this.stage.sound.speak('done', 0);
    }
    if (this.drawLeft <= 0) {
      if (ink >= MIN_INK) {
        this.finishDrawing();
        return;
      }
      this.drawLeft = 8;
      this.moreFor = 2.5;
      this.stage.sound.speak('draw', 0);
    }
    if (this.clock - this.lastInkDebug > 0.5) {
      this.lastInkDebug = this.clock;
      this.stage.debug({ ink: Math.round(ink * 100) / 100 });
    }
  }

  private updateMagic(frame: Frame): void {
    const { dt, body } = frame;
    const prev = this.magicFor;
    this.magicFor += dt;
    // sparkles along the lines
    if (Math.floor(this.magicFor / 0.12) !== Math.floor(prev / 0.12) && this.strokes.length) {
      const s = this.strokes[Math.floor(Math.random() * this.strokes.length)];
      const p = this.toScreen(s[Math.floor(Math.random() * s.length)]);
      this.effects.burst(p.x, p.y, body.shoulderWidth * 0.5, 6);
    }
    if (this.magicFor >= MAGIC_MIN_SEC && (this.aiTraits !== undefined || this.magicFor >= MAGIC_MAX_SEC)) this.reveal(frame);
  }

  private updatePlay(frame: Frame): void {
    const { dt } = frame;
    this.playLeft -= dt;
    if (!this.playSpoken && this.revealAge > 1 && !this.stage.sound.isSpeaking) {
      this.playSpoken = true;
      this.stage.sound.speak('play', 0);
    }
    this.updateCreature(frame);
    if (this.playLeft <= 0 && this.creature) {
      const fun = this.creature.fun;
      this.result = { fun, stars: funStars(fun) };
      this.setPhase('end');
      this.stage.sound.stopMusic();
      this.stage.sound.cheer();
      this.stage.sound.speak('bye', 0);
      this.stage.debug({ ended: true, fun, stars: this.result.stars });
    }
  }

  private updateCreature(frame: Frame): void {
    const c = this.creature;
    if (!c) return;
    const { body, rect, dt } = frame;
    this.revealAge += dt;
    const la = body.points[27];
    const ra = body.points[28];
    const feet = la && ra ? Math.max(la.y, ra.y) : la ? la.y : ra ? ra.y : rect.y + rect.h * 0.92;
    const target = Math.min(rect.y + rect.h * 0.97, Math.max(rect.y + rect.h * 0.5, feet));
    this.ground = this.ground === null ? target : this.ground + (target - this.ground) * Math.min(1, dt * 3);
    const ls = body.points[11];
    const rs = body.points[12];
    const center = ls && rs ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 } : null;
    const events = c.update(dt, { left: rect.x, right: rect.x + rect.w, top: rect.y, ground: this.ground, unit: body.shoulderWidth }, { hands: body.hands, head: body.head, center });
    for (const e of events) this.react(e, body.shoulderWidth);
  }

  private react(e: CreatureEvent, unit: number): void {
    const c = this.creature!;
    const sound = this.stage.sound;
    const mid = c.middle;
    const top = c.y - c.size * c.dims.h;
    switch (e.type) {
      case 'touch':
        sound.giggle(1 + (e.count % 3), e.count);
        if (this.clock - this.lastPetAt > 0.6) {
          // beside the creature, away from its name above
          const side = e.count % 2 === 0 ? 1 : -1;
          this.effects.say(t('draw.yay'), mid.x + side * (c.size * c.dims.w * 0.5 + unit * 0.45), mid.y - c.size * c.dims.h * 0.2, unit * 0.32, '#ff9ecf', 0.8, 'pet');
        }
        this.lastPetAt = this.clock;
        this.effects.burst(mid.x, mid.y, unit * 0.6, 10);
        break;
      case 'jump':
        sound.boing();
        break;
      case 'hide':
        this.hidden = true;
        sound.giggle(1, 7);
        break;
      case 'boo':
        sound.wheee();
        this.effects.say(t('draw.boo'), mid.x, top - unit * 0.3, unit * 0.5, '#ffd600', 1.1, 'boo');
        this.effects.burst(mid.x, mid.y, unit, 24);
        break;
      case 'sleep':
        sound.yawn();
        break;
      case 'wake':
        sound.yawn();
        break;
      case 'land':
        break;
    }
    if (e.type === 'touch' || e.type === 'jump' || e.type === 'boo') this.stage.debug({ fun: c.fun });
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    drawBody(ctx, body, this.phase === 'draw' ? 0.35 : 0.2);
    if (this.phase === 'draw') this.renderDraw(ctx, frame);
    else if (this.phase === 'magic') this.renderMagic(ctx, frame);
    else this.renderPlay(ctx, frame);
    this.effects.render(ctx, width);

    if (this.awayFor >= AWAY_PAUSE_SEC && (this.phase === 'draw' || this.phase === 'play')) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, t('tickle.away'), width / 2, height * 0.5, height * 0.05, '#fff');
    }
  }

  private renderDraw(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const b = this.board;
    const bt = this.buttons;
    label(ctx, t('draw.title'), width / 2, height * 0.06, height * 0.045, '#ffd600');
    if (!b || !bt) return;
    const s = body.shoulderWidth;
    panel(ctx, b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.06, 'rgba(255, 255, 255, 0.10)');
    ctx.save();
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([s * 0.12, s * 0.1]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = Math.max(3, s * 0.03);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();

    const lineW = Math.max(8, s * 0.11);
    drawInk(ctx, this.sheet.strokes, this.toScreen, lineW);
    drawInk(ctx, this.sheet.liveStrokes, this.toScreen, lineW, 0, this.sheet.strokes.length);
    for (let i = 0; i < 2; i++) {
      const hand = body.hands[i];
      if (hand && this.sheet.isDrawing(i)) {
        drawGlove(ctx, hand, Math.max(18, s * 0.45));
        ctx.fillStyle = PEN_COLORS[(this.sheet.strokes.length + i) % PEN_COLORS.length];
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, lineW * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const ink = this.sheet.ink();
    const ready = ink >= MIN_INK;
    // ✓ Done
    ctx.globalAlpha = ready ? 1 : 0.55;
    ctx.fillStyle = '#2fbf71';
    ctx.beginPath();
    ctx.arc(bt.done.x, bt.done.y, bt.r, 0, Math.PI * 2);
    ctx.fill();
    check(ctx, bt.done.x, bt.done.y, bt.r);
    ctx.globalAlpha = 1;
    ring(ctx, bt.done, bt.r * 1.12, this.doneDwell.progress, '#ffd600', Math.max(6, bt.r * 0.12));
    label(ctx, t('draw.done'), bt.done.x, bt.done.y + bt.r * 1.45, Math.max(24, bt.r * 0.42), '#fff');
    // ↺ Start over
    if (ink > 0) {
      ctx.fillStyle = '#ff8c42';
      ctx.beginPath();
      ctx.arc(bt.clear.x, bt.clear.y, bt.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      again(ctx, bt.clear.x, bt.clear.y, bt.r * 0.85);
      ring(ctx, bt.clear, bt.r * 0.97, this.clearDwell.progress, '#ffd600', Math.max(6, bt.r * 0.1));
      label(ctx, t('draw.clear'), bt.clear.x, bt.clear.y + bt.r * 1.3, Math.max(22, bt.r * 0.36), '#fff');
    }

    if (this.timerStarted) {
      // bottom corner: the top corners belong to the buttons
      const at = { x: width * 0.93, y: height * 0.9 };
      ring(ctx, at, height * 0.04, Math.max(0, this.drawLeft) / this.opts.drawSec, '#7dffa1', height * 0.012);
      label(ctx, String(Math.max(0, Math.ceil(this.drawLeft))), at.x, at.y, height * 0.035);
    }
    if (this.moreFor > 0) label(ctx, t('draw.more'), width / 2, b.y + b.h + height * 0.05, height * 0.05, '#ffd600');
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.95, height * 0.03, '#ffd600');
  }

  private renderMagic(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    if (!this.board) return;
    const shift = Math.floor(this.magicFor * 10);
    const pulse = 1 + Math.sin(this.magicFor * 12) * 0.15;
    drawInk(ctx, this.strokes, this.toScreen, Math.max(8, body.shoulderWidth * 0.11) * pulse, shift);
    label(ctx, t('draw.magic'), width / 2, height * 0.08, height * 0.06, '#ff9ecf');
  }

  private renderPlay(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const c = this.creature;
    const shape = this.shape;
    const traits = this.traits;
    if (!c || !shape || !traits) return;
    const unit = body.shoulderWidth;
    const lookAt = body.hands[0] || body.hands[1] || body.head;
    // soft shadow under walkers
    if (!c.flies && this.ground !== null) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      if (typeof ctx.ellipse === 'function') ctx.ellipse(c.x, this.ground, c.size * shape.width * 0.45, c.size * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const moving = Math.abs(c.vx) > c.size * 0.3;
    drawCreature(ctx, shape, {
      x: c.x,
      y: c.y,
      size: c.size,
      facing: c.facing,
      squash: c.squash,
      spin: c.spin,
      age: c.age,
      wobble: c.style.wobble,
      mood: c.mood,
      blink: c.blink,
      lookAt,
      bodyColor: traits.bodyColor,
      accentColor: traits.accentColor,
      move: traits.move,
      step: moving ? c.age : 0,
      fill: Math.min(1, this.revealAge / 0.5),
      eyes: Math.min(1, Math.max(0, (this.revealAge - 0.3) / 0.35)),
    });
    const top = c.y - c.size * c.dims.h;
    label(ctx, traits.name, c.x, top - unit * 0.35, Math.max(26, unit * 0.32), traits.bodyColor);
    if (this.greetFor > 0 && traits.greeting) {
      label(ctx, traits.greeting, c.x, top - unit * 0.8, Math.max(24, unit * 0.26), '#fff');
    }
    if (c.mood === 'sleep') label(ctx, t('draw.zzz'), c.x + c.size * 0.4, top - unit * 0.1, Math.max(22, unit * 0.25), '#fff');

    // HUD: pets/jumps counter and time left
    const hud = height * 0.075;
    heart(ctx, width * 0.07, hud, height * 0.035, '#ff7eb6');
    label(ctx, String(c.fun), width * 0.07 + height * 0.06, hud, height * 0.055, '#fff', 'left');
    if (this.phase === 'play') {
      ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, Math.max(0, this.playLeft) / this.opts.playSec, '#7dffa1', height * 0.012);
      label(ctx, String(Math.max(0, Math.ceil(this.playLeft))), width * 0.93, hud, height * 0.035);
      const sincePlay = this.opts.playSec - this.playLeft;
      if (!this.hidden && sincePlay > 12 && sincePlay < 22) label(ctx, t('draw.peek'), width / 2, height * 0.93, height * 0.04, '#ffd600');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.2, width * 0.56, height * 0.5, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, t('draw.bye', { name: traits.name }), width / 2, height * 0.3, height * 0.065, '#ffd600');
      label(ctx, t('draw.fun', { n: this.result.fun }), width / 2, height * 0.4, height * 0.045);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.52, height * 0.055, i < this.result.stars);
      label(ctx, t('tickle.back_soon'), width / 2, height * 0.63, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
