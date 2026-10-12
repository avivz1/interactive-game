// Freeze Dance: dance while the music plays; when it stops, freeze! A friendly
// monster beside the child watches for a few seconds: a statue earns a star,
// a wiggle earns a giggle. Nobody is ever "out".

import { FreezeDance, MotionMeter, RESULT_SEC, type FreezeEvent } from '../../games/freeze-dance';
import { t, type TextKey } from '../../shared/i18n';
import { drawCritter } from '../critters';
import { drawBody } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring, star } from '../ui';

const AWAY_PAUSE_SEC = 2;
const RESULTS_SEC = 8;

export class FreezeScene implements Scene {
  readonly name = 'freeze-dance';
  private readonly game: FreezeDance;
  private readonly meter = new MotionMeter();
  private readonly effects = new Effects();
  private clock = 0;
  private awayFor = 0;
  private awaySpokenAt = -100;
  private paused = false;
  private left = false;
  private sparkleIn = 0;
  private lastDebug = 0;
  private banner: { key: TextKey; color: string; until: number } | null = null;
  private result: { statues: number; stars: number } | null = null;
  private resultFor = 0;
  private readonly seed = Math.floor(Math.random() * 1000);
  /** The watching monster, beside the child on the roomier side. */
  private monster: { x: number; y: number; r: number; side: number } | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
    roundSec: number,
  ) {
    this.game = new FreezeDance({ durationSec: roundSec, seed: Math.floor(Math.random() * 1e9) });
  }

  enter(): void {
    this.stage.sound.speak('freeze_intro', 0);
    this.stage.debug({ fdPhase: 'intro', statues: 0, wiggles: 0, freezes: 0, ended: false });
  }

  exit(): void {
    this.stage.sound.stopMusic(true);
  }

  private leave(): void {
    if (this.left) return;
    this.left = true;
    this.stage.go(this.back());
  }

  onKey(key: Key): void {
    if (key === 'back' || (key === 'ok' && this.result)) this.leave();
  }

  private show(key: TextKey, color: string, sec: number): void {
    this.banner = { key, color, until: this.clock + sec };
  }

  update(frame: Frame): void {
    const { dt, body } = frame;
    const unit = body.shoulderWidth;
    this.clock += dt;
    this.effects.update(dt, unit);
    const motion = this.meter.update(body.points, unit, dt);
    this.place(frame);

    if (this.result) {
      this.resultFor += dt;
      if (this.resultFor >= RESULTS_SEC) this.leave();
      return;
    }

    // Pause while the child is out of the picture (and stop the music).
    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC) {
      if (!this.paused) {
        this.paused = true;
        this.stage.sound.stopMusic();
      }
      if (this.clock - this.awaySpokenAt > 8) {
        this.awaySpokenAt = this.clock;
        this.stage.sound.speak('away', 0);
      }
      return;
    }
    if (this.paused) {
      this.paused = false;
      this.meter.reset(); // coming back into the picture is not a wiggle
      if (this.game.phase === 'dance') this.stage.sound.startMusic(this.seed, 'dance');
    }

    const events = this.game.update(dt, frame.hasBody ? motion : 0);
    for (const e of events) this.react(e, unit);

    // sparkles where the child dances
    this.sparkleIn -= dt;
    if (this.game.phase === 'dance' && this.meter.hot && this.sparkleIn <= 0) {
      this.sparkleIn = 0.12;
      this.effects.burst(this.meter.hot.x, this.meter.hot.y, unit * 0.45, 6);
    }
    if (this.clock - this.lastDebug > 0.5) {
      this.lastDebug = this.clock;
      this.stage.debug({ fdPhase: this.game.phase, motion: Math.round(motion * 100) / 100 });
    }
  }

  private react(e: FreezeEvent, unit: number): void {
    const sound = this.stage.sound;
    const m = this.monster;
    switch (e.type) {
      case 'dance':
        sound.startMusic(this.seed, 'dance');
        this.show('fd.dance', '#ffd23f', 1.5);
        break;
      case 'freeze':
        sound.stopMusic(true);
        sound.ice();
        sound.speak('freeze', 0);
        this.show('fd.freeze', '#7ee0ff', 3);
        this.stage.debug({ freezes: this.game.freezes });
        break;
      case 'statue':
        sound.cheer();
        this.show('fd.statue', '#ffd600', RESULT_SEC);
        if (m) this.effects.burst(m.x, m.y, unit, 30);
        this.stage.debug({ statues: e.statues });
        break;
      case 'wiggle':
        sound.giggle(3, this.game.wiggles);
        sound.speak('wiggle', 0);
        this.show('fd.wiggle', '#ff9ecf', RESULT_SEC);
        this.stage.debug({ wiggles: this.game.wiggles });
        break;
      case 'end':
        this.result = { statues: e.statues, stars: e.stars };
        this.banner = null;
        sound.stopMusic(true);
        sound.cheer();
        this.stage.debug({ ended: true, statues: e.statues, stars: e.stars, fdPhase: 'end' });
        break;
    }
  }

  private place(frame: Frame): void {
    const { body, rect, dt } = frame;
    const ls = body.points[11];
    const rs = body.points[12];
    if (!ls || !rs) return;
    const s = body.shoulderWidth;
    const cx = (ls.x + rs.x) / 2;
    const sy = (ls.y + rs.y) / 2;
    // the critter's body is about half of r: roughly one shoulder width across
    const r = Math.max(s * 1.1, rect.h * 0.12);
    const gap = s * 1.5 + r * 0.6;
    const fits = (dir: number) => (dir > 0 ? rect.x + rect.w - cx : cx - rect.x) >= gap + r * 0.6;
    // stay on one side; move only when the child walks so close to that edge that it no longer fits
    let side = this.monster ? this.monster.side : rect.x + rect.w - cx >= cx - rect.x ? 1 : -1;
    if (!fits(side) && fits(-side)) side = -side;
    const x = Math.max(rect.x + r * 0.6, Math.min(rect.x + rect.w - r * 0.6, cx + side * gap));
    const y = Math.max(rect.y + r * 0.9, Math.min(rect.y + rect.h - r * 0.7, sy + s * 0.3));
    if (!this.monster) {
      this.monster = { x, y, r, side };
      return;
    }
    this.monster.side = side;
    const k = Math.min(1, dt * 2);
    this.monster.x += (x - this.monster.x) * k;
    this.monster.y += (y - this.monster.y) * k;
    this.monster.r += (r - this.monster.r) * k;
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const g = this.game;
    drawBody(ctx, body, g.phase === 'freeze' ? 0.6 : 0.3);
    this.effects.render(ctx, width);

    const m = this.monster;
    if (m) {
      const dancing = g.phase === 'dance' || g.phase === 'intro' || !!this.result;
      const bob = dancing ? Math.abs(Math.sin(this.clock * 6.5)) * m.r * 0.12 : 0;
      const stage = g.last === 'statue' || this.result ? 3 : g.last === 'wiggle' ? 2 : dancing ? 2 : 0;
      drawCritter(ctx, { x: m.x, y: m.y - bob, r: m.r, color: 3, kind: 'normal', stage, age: this.clock, touched: false }, body.head, false);
      if (g.phase === 'freeze') {
        // the monster's watch: a ring that fills while it checks for wiggles
        ring(ctx, { x: m.x, y: m.y }, m.r * 0.72, g.checkProgress, '#7ee0ff', Math.max(6, m.r * 0.06));
        label(ctx, '👀', m.x, m.y - m.r * 0.85, m.r * 0.3);
      }
    }

    // HUD: statues and time left
    const hud = height * 0.075;
    star(ctx, width * 0.07, hud, height * 0.04, true);
    label(ctx, String(this.result ? this.result.statues : g.statues), width * 0.07 + height * 0.06, hud, height * 0.055, '#fff', 'left');
    if (g.phase !== 'intro' && !this.result) {
      ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, g.remaining / g.config.durationSec, '#7dffa1', height * 0.012);
      label(ctx, String(Math.ceil(g.remaining)), width * 0.93, hud, height * 0.035);
    }

    // words go low on the screen: the top is where the child's head is
    if (g.phase === 'intro') label(ctx, t('fd.intro'), width / 2, height * 0.86, height * 0.05, '#ffd23f');
    if (this.banner && this.clock < this.banner.until) label(ctx, t(this.banner.key), width / 2, height * 0.85, height * 0.08, this.banner.color);
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.95, height * 0.03, '#ffd600');

    if (this.awayFor >= AWAY_PAUSE_SEC && !this.result) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, t('tickle.away'), width / 2, height * 0.5, height * 0.05, '#fff');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.22, width * 0.56, height * 0.56, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, t('fd.great'), width / 2, height * 0.33, height * 0.07, '#ffd600');
      label(ctx, t('fd.statues', { n: this.result.statues }), width / 2, height * 0.44, height * 0.05);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.57, height * 0.055, i < this.result.stars);
      label(ctx, t('tickle.back_soon'), width / 2, height * 0.7, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
