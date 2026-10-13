// Boop to Transform: boop the eggs around you with a hand or a kick. Each boop
// makes one grow: the egg hatches, the baby grows up, and the grown-up becomes
// a sparkly surprise that flies away. After each boop it hops somewhere new.

import { BoopGame, type BoopEnv, type BoopEvent, type Critter } from '../../games/boop';
import { Limbs, present, type Touchers } from '../../games/limbs';
import type { Pt } from '../../shared/body';
import { t } from '../../shared/i18n';
import { drawBaby, drawEgg, drawGrown, drawSurprise } from '../boop-art';
import { drawBody, drawGlove } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring, star } from '../ui';

const INTRO_SEC = 3;
const AWAY_PAUSE_SEC = 2;
const RESULTS_SEC = 8;
/** Seconds without either ankle in the picture (while an egg waits low) before asking for a step back. */
const NO_FEET_SEC = 1.5;

export class BoopScene implements Scene {
  readonly name = 'boop-transform';
  private readonly game: BoopGame;
  private readonly effects = new Effects();
  private readonly limbs = new Limbs();
  private touchers: Touchers = { hands: [null, null], feet: [null, null] };
  private phase: 'intro' | 'play' | 'end' = 'intro';
  private introLeft = INTRO_SEC;
  private clock = 0;
  private awayFor = 0;
  private awaySpokenAt = -100;
  private noFeetFor = 0;
  private left = false;
  private unit = 0;
  /** Where the child is, followed gently so the critters don't shake with tracking jitter. */
  private env: BoopEnv | null = null;
  /** The floor under the child: drops at once, rises slowly (a kick doesn't lift it). */
  private floor: number | null = null;
  private result: { transformed: number; stars: number } | null = null;
  private resultFor = 0;

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
    roundSec: number,
  ) {
    this.game = new BoopGame({ durationSec: roundSec, seed: Math.floor(Math.random() * 1e9) });
  }

  enter(): void {
    this.stage.sound.startMusic(Math.floor(Math.random() * 1000));
    this.stage.sound.speak('boop_intro', 0);
    this.stage.debug({ btPhase: 'intro', boops: 0, transformed: 0, ended: false });
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

  private follow(frame: Frame, unit: number): void {
    const { body, rect, dt } = frame;
    const ls = body.points[11];
    const rs = body.points[12];
    if (!ls || !rs) return;
    const la = body.points[27];
    const ra = body.points[28];
    const seen = la && ra ? Math.max(la.y, ra.y) : la ? la.y : ra ? ra.y : null;
    // feet out of the picture: low eggs stay where they were (the last floor seen), no new ones go low
    if (seen !== null) this.floor = this.floor === null || seen > this.floor ? seen : this.floor + (seen - this.floor) * Math.min(1, dt * 0.5);
    const target: BoopEnv = { cx: (ls.x + rs.x) / 2, shoulderY: (ls.y + rs.y) / 2, floor: this.floor, feetSeen: seen !== null, unit, rect };
    const cur = this.env;
    if (!cur) {
      this.env = target;
      return;
    }
    const k = Math.min(1, dt * 4);
    cur.cx += (target.cx - cur.cx) * k;
    cur.shoulderY += (target.shoulderY - cur.shoulderY) * k;
    cur.floor = target.floor;
    cur.feetSeen = target.feetSeen;
    cur.unit = target.unit;
    cur.rect = rect;
  }

  update(frame: Frame): void {
    const { dt, body } = frame;
    if (body.points[11] && body.points[12]) {
      this.unit = this.unit ? Math.max(body.shoulderWidth, this.unit * (1 - 0.08 * dt)) : body.shoulderWidth;
    }
    const unit = this.unit || body.shoulderWidth;
    this.clock += dt;
    this.effects.update(dt, unit);
    this.follow(frame, unit);
    this.touchers = this.limbs.update(body, dt);

    if (this.result) {
      this.resultFor += dt;
      if (this.resultFor >= RESULTS_SEC) this.leave();
      return;
    }

    // Pause while the child is out of the picture.
    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC) {
      if (this.clock - this.awaySpokenAt > 8) {
        this.awaySpokenAt = this.clock;
        this.stage.sound.speak('away', 0);
      }
      return;
    }

    if (this.phase === 'intro') {
      this.introLeft -= dt;
      if (this.introLeft > 0) return;
      this.phase = 'play';
      this.stage.debug({ btPhase: 'play' });
    }
    if (this.phase !== 'play' || !this.env) return;

    // an egg waiting low needs the feet in the picture
    const lowWaiting = this.game.critters.some((c) => c.zone === 'low' && c.stage < 3);
    this.noFeetFor = frame.hasBody && lowWaiting && !body.points[27] && !body.points[28] ? this.noFeetFor + dt : 0;
    if (this.noFeetFor >= NO_FEET_SEC) this.stage.sound.speak('feet', 12);

    // Only reaching hands and lifted feet boop (never the head, the body, or a hand hanging at the side).
    const events = this.game.update(dt, this.env, {
      hands: present(this.touchers.hands),
      feet: present(this.touchers.feet),
      handRadius: unit * 0.28,
      footRadius: unit * 0.3,
    });
    for (const e of events) this.react(e, unit);
  }

  private react(e: BoopEvent, unit: number): void {
    const sound = this.stage.sound;
    switch (e.type) {
      case 'arrive':
        sound.boing();
        break;
      case 'hop':
        sound.boing();
        break;
      case 'boop': {
        const c = e.critter;
        if (e.stage === 1) {
          sound.pop();
          sound.giggle(1, c.id);
          this.effects.burst(c.x, c.y, unit * 0.6, 14);
          this.effects.say(t('bt.hatch'), c.x, c.y - c.r * 1.3, unit * 0.32, '#ffd600', 0.9, 'c' + c.id);
        } else {
          sound.magic();
          this.effects.burst(c.x, c.y, unit * 0.7, 18);
          this.effects.say(t('bt.grow'), c.x, c.y - c.r * 1.3, unit * 0.34, '#7dffa1', 0.9, 'c' + c.id);
        }
        this.stage.debug({ boops: this.game.boops });
        break;
      }
      case 'surprise': {
        const c = e.critter;
        sound.magic();
        sound.wheee();
        sound.speak('surprise', 6);
        this.effects.burst(c.x, c.y, unit, 30);
        this.effects.say(t('bt.surprise'), c.x, c.y - c.r * 1.5, unit * 0.42, '#ff9ecf', 1.2, 'c' + c.id);
        this.stage.debug({ boops: this.game.boops, transformed: this.game.transformed });
        break;
      }
      case 'end':
        this.phase = 'end';
        this.result = { transformed: e.transformed, stars: e.stars };
        sound.stopMusic();
        sound.cheer();
        sound.speak('great', 0);
        this.stage.debug({ ended: true, boops: e.boops, transformed: e.transformed, stars: e.stars, btPhase: 'end' });
        break;
    }
  }

  private drawOne(ctx: CanvasRenderingContext2D, c: Critter, lookAt: Pt | null): void {
    // a sitting critter bobs gently: ready to be booped
    const sitting = c.stage < 3 && c.hop >= 1 && c.wait <= 0;
    const y = c.y + (sitting ? Math.sin(c.age * 2.5 + c.id) * c.r * 0.06 : 0);
    if (c.stage === 0) drawEgg(ctx, c.x, y, c.r, c.color, c.age, c.touched);
    else if (c.stage === 1) drawBaby(ctx, c.x, y, c.r, c.color, c.age, lookAt);
    else if (c.stage === 2) drawGrown(ctx, c.x, y, c.r, c.color, c.age, lookAt);
    else drawSurprise(ctx, c.x, y, c.r, c.color, c.surprise, c.age);
    // low ones are for a kick
    if (sitting && c.zone === 'low') label(ctx, '🦶', c.x + c.r * 0.8, y + c.r * 0.8, c.r * 0.45);
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const g = this.game;
    const unit = this.unit || body.shoulderWidth;
    drawBody(ctx, body, 0.3);
    // a lifted foot glows like the hands: it can boop now
    for (const f of this.touchers.feet) if (f) drawGlove(ctx, f, Math.max(14, unit * 0.32));
    const lookAt = body.hands[0] || body.hands[1] || body.head;
    if (this.phase !== 'intro') for (const c of g.critters) this.drawOne(ctx, c, lookAt);
    this.effects.render(ctx, width);

    // HUD: transformed and time left
    const hud = height * 0.075;
    drawSurprise(ctx, width * 0.07, hud, height * 0.03, 1, 0, this.clock);
    label(ctx, String(this.result ? this.result.transformed : g.transformed), width * 0.07 + height * 0.07, hud, height * 0.055, '#fff', 'left');
    if (this.phase === 'play') {
      ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, g.remaining / g.config.durationSec, '#7dffa1', height * 0.012);
      label(ctx, String(Math.ceil(g.remaining)), width * 0.93, hud, height * 0.035);
    }

    // words go low on the screen: the top is where the child's head is
    if (this.phase === 'intro') label(ctx, t('bt.intro'), width / 2, height * 0.86, height * 0.055, '#ffd23f');
    else if (this.phase === 'play' && this.noFeetFor >= NO_FEET_SEC) label(ctx, t('fit.feet-cut'), width / 2, height * 0.88, height * 0.045, '#ffd23f');
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.95, height * 0.03, '#ffd600');

    if (this.awayFor >= AWAY_PAUSE_SEC && !this.result) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, t('tickle.away'), width / 2, height * 0.5, height * 0.05, '#fff');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.22, width * 0.56, height * 0.56, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, t('bt.great'), width / 2, height * 0.33, height * 0.07, '#ffd600');
      label(ctx, t('bt.done', { n: this.result.transformed }), width / 2, height * 0.44, height * 0.05);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.57, height * 0.055, i < this.result.stars);
      label(ctx, t('tickle.back_soon'), width / 2, height * 0.7, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
