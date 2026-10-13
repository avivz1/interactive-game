// Bubble Beat (Bubble Rhythm Pop): bubbles appear around the child — up high
// for the hands, down low for the feet — and a ring shrinks onto each one,
// landing on the music's kick drum. Pop them with a reaching hand or a kick.

import { Limbs, type Touchers } from '../../games/limbs';
import { RhythmGame, spotLayout, type Grade, type RhythmEvent, type SpotId, type SpotLayout } from '../../games/rhythm';
import type { Pt } from '../../shared/body';
import { t, type TextKey } from '../../shared/i18n';
import { drawCritter } from '../critters';
import { drawBody, drawGlove } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { distance, label, panel, ring, star } from '../ui';

const INTRO_SEC = 4;
const BPM = 112;
/** The kick drum falls every two beats: bubbles land on it. */
const PULSE_SEC = 120 / BPM;
const AWAY_PAUSE_SEC = 2;
const RESULTS_SEC = 8;
const SPOT_COLOR: Record<SpotId, number> = { handL: 1, handR: 0, footL: 3, footR: 2 };
const GRADE_TEXT: Record<Grade, TextKey> = { perfect: 'br.perfect', good: 'br.good', pop: 'br.pop' };
const GRADE_COLOR: Record<Grade, string> = { perfect: '#ffd600', good: '#7dffa1', pop: '#ffffff' };

/**
 * The game's clock: the music's own clock when it plays (so bubbles land on
 * the beat), else frame time. Never jumps back; when the music (re)starts,
 * it lines the game's beats up with the music's beats.
 */
class SongClock {
  t = 0;
  private base = 0;
  private onMusic = false;

  now(songTime: number | null, dt: number): number {
    if (songTime === null) {
      this.onMusic = false;
      this.t += dt;
      return this.t;
    }
    if (!this.onMusic) {
      this.onMusic = true;
      this.base = Math.ceil((this.t - songTime) / PULSE_SEC) * PULSE_SEC;
    }
    this.t = Math.max(this.t, this.base + songTime);
    return this.t;
  }
}

export class RhythmScene implements Scene {
  readonly name = 'bubble-beat';
  private readonly game: RhythmGame;
  private readonly effects = new Effects();
  private readonly limbs = new Limbs();
  private readonly clock = new SongClock();
  private touchers: Touchers = { hands: [null, null], feet: [null, null] };
  private phase: 'intro' | 'play' | 'end' = 'intro';
  private introLeft = INTRO_SEC;
  private age = 0;
  private awayFor = 0;
  private awaySpokenAt = -100;
  private paused = false;
  private left = false;
  private unit = 0;
  private layout: SpotLayout | null = null;
  /** The floor under the child: drops at once, rises slowly (a kick doesn't lift it). */
  private floor: number | null = null;
  private result: { hits: number; stars: number } | null = null;
  private resultFor = 0;
  private readonly seed = Math.floor(Math.random() * 1000);

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
    roundSec: number,
  ) {
    this.game = new RhythmGame({ durationSec: roundSec, pulseSec: PULSE_SEC, seed: Math.floor(Math.random() * 1e9) });
  }

  enter(): void {
    this.stage.sound.speak('rhythm_intro', 0);
    this.stage.debug({ brPhase: 'intro', hits: 0, perfects: 0, misses: 0, total: this.game.total, ended: false });
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

  private place(frame: Frame, s: number): void {
    const { body, rect } = frame;
    const ls = body.points[11];
    const rs = body.points[12];
    if (!ls || !rs) return;
    const la = body.points[27];
    const ra = body.points[28];
    const seen = la && ra ? Math.max(la.y, ra.y) : la ? la.y : ra ? ra.y : null;
    if (seen !== null) this.floor = this.floor === null || seen > this.floor ? seen : this.floor + (seen - this.floor) * Math.min(1, frame.dt * 0.5);
    const floor = this.floor !== null ? this.floor : rect.y + rect.h * 0.92;
    const target = spotLayout((ls.x + rs.x) / 2, (ls.y + rs.y) / 2, floor, s, rect);
    if (!this.layout) {
      this.layout = target;
      return;
    }
    // follow the child gently, so the spots don't shake with tracking jitter
    const k = Math.min(1, frame.dt * 4);
    const cur = this.layout;
    cur.r += (target.r - cur.r) * k;
    for (const id of ['handL', 'handR', 'footL', 'footR'] as SpotId[]) {
      cur.at[id] = { x: cur.at[id].x + (target.at[id].x - cur.at[id].x) * k, y: cur.at[id].y + (target.at[id].y - cur.at[id].y) * k };
    }
  }

  private touching = (spot: SpotId): boolean => {
    const lay = this.layout;
    if (!lay) return false;
    const p = lay.at[spot];
    const u = this.unit;
    for (const h of this.touchers.hands) if (h && distance(h, p) <= lay.r + u * 0.25) return true;
    for (const f of this.touchers.feet) if (f && distance(f, p) <= lay.r + u * 0.3) return true;
    return false;
  };

  update(frame: Frame): void {
    const { dt, body } = frame;
    if (body.points[11] && body.points[12]) {
      this.unit = this.unit ? Math.max(body.shoulderWidth, this.unit * (1 - 0.08 * dt)) : body.shoulderWidth;
    }
    const unit = this.unit || body.shoulderWidth;
    this.age += dt;
    this.effects.update(dt, unit);
    this.place(frame, unit);
    this.touchers = this.limbs.update(body, dt);

    if (this.result) {
      this.resultFor += dt;
      if (this.resultFor >= RESULTS_SEC) this.leave();
      return;
    }

    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC) {
      if (!this.paused && this.phase === 'play') this.stage.sound.stopMusic();
      this.paused = true;
      if (this.age - this.awaySpokenAt > 8) {
        this.awaySpokenAt = this.age;
        this.stage.sound.speak('away', 0);
      }
      return;
    }
    if (this.paused) {
      this.paused = false;
      if (this.phase === 'play') this.stage.sound.startMusic(this.seed, 'dance', BPM);
    }

    if (this.phase === 'intro') {
      this.introLeft -= dt;
      if (this.introLeft <= 0) {
        this.phase = 'play';
        this.stage.sound.startMusic(this.seed, 'dance', BPM);
        this.stage.debug({ brPhase: 'play' });
      }
      return;
    }
    if (this.phase !== 'play') return;

    const now = this.clock.now(this.stage.sound.songTime(), dt);
    for (const e of this.game.update(now, this.touching)) this.react(e, unit);
  }

  private react(e: RhythmEvent, unit: number): void {
    const sound = this.stage.sound;
    switch (e.type) {
      case 'hit': {
        const p = this.layout ? this.layout.at[e.note.spot] : null;
        sound.pop();
        if (e.grade === 'perfect') {
          sound.select();
          sound.speak('perfect', 8);
        }
        if (p) {
          this.effects.burst(p.x, p.y, unit, e.grade === 'perfect' ? 30 : 18);
          this.effects.say(t(GRADE_TEXT[e.grade]), p.x, p.y - unit * 0.6, unit * (e.grade === 'perfect' ? 0.42 : 0.34), GRADE_COLOR[e.grade], 0.8, e.note.spot);
        }
        this.stage.debug({ hits: this.game.hits, perfects: this.game.perfects });
        break;
      }
      case 'miss':
        this.stage.debug({ misses: this.game.misses });
        break;
      case 'end':
        this.phase = 'end';
        this.result = { hits: e.hits, stars: e.stars };
        sound.stopMusic();
        sound.cheer();
        this.stage.debug({ ended: true, hits: e.hits, total: e.total, stars: e.stars, brPhase: 'end' });
        break;
      case 'show':
        break;
    }
  }

  private drawSpotBubble(ctx: CanvasRenderingContext2D, spot: SpotId, at: Pt, r: number, progress: number, lookAt: Pt | null): void {
    // the ring lands on the bubble on the beat
    const ringR = r * (1 + 1.4 * (1 - progress));
    ctx.lineWidth = Math.max(4, r * 0.12);
    ctx.strokeStyle = progress >= 0.92 ? '#ffd600' : 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(at.x, at.y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    const pop = Math.min(1, progress * 6); // grows in quickly when it appears
    drawCritter(ctx, { x: at.x, y: at.y, r: r * pop, color: SPOT_COLOR[spot], kind: 'normal', stage: progress > 0.85 ? 1 : 0, age: this.age, touched: false }, lookAt);
    label(ctx, spot.indexOf('hand') === 0 ? '🖐' : '🦶', at.x + r * 0.75, at.y + r * 0.75, r * 0.5);
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const g = this.game;
    const unit = this.unit || body.shoulderWidth;
    drawBody(ctx, body, 0.3);
    for (const f of this.touchers.feet) if (f) drawGlove(ctx, f, Math.max(14, unit * 0.32));

    const lay = this.layout;
    if (lay && this.phase === 'play') {
      const lookAt = body.hands[0] || body.hands[1] || body.head;
      for (const note of g.notes) {
        if (note.state === 'live') this.drawSpotBubble(ctx, note.spot, lay.at[note.spot], lay.r, g.progress(note), lookAt);
        else if (note.state === 'missed' && g.time - note.doneTime < 0.8) {
          // floats away
          const k = (g.time - note.doneTime) / 0.8;
          const p = lay.at[note.spot];
          ctx.globalAlpha = 1 - k;
          drawCritter(ctx, { x: p.x, y: p.y - k * unit * 1.2, r: lay.r * (1 - k * 0.3), color: SPOT_COLOR[note.spot], kind: 'sleepy', stage: 0, age: this.age, touched: false }, null);
          ctx.globalAlpha = 1;
        }
      }
    }
    this.effects.render(ctx, width);

    // HUD: popped and time left
    const hud = height * 0.075;
    drawCritter(ctx, { x: width * 0.07, y: hud, r: height * 0.04, color: 1, kind: 'normal', stage: 0, age: 0, touched: false }, null);
    label(ctx, String(this.result ? this.result.hits : g.hits), width * 0.07 + height * 0.06, hud, height * 0.055, '#fff', 'left');
    if (this.phase === 'play') {
      ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, g.remaining / g.config.durationSec, '#7dffa1', height * 0.012);
      label(ctx, String(Math.ceil(g.remaining)), width * 0.93, hud, height * 0.035);
    }
    if (this.phase === 'intro') label(ctx, t('br.intro'), width / 2, height * 0.86, height * 0.055, '#ffd23f');
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.95, height * 0.03, '#ffd600');

    if (this.awayFor >= AWAY_PAUSE_SEC && !this.result) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, t('tickle.away'), width / 2, height * 0.5, height * 0.05, '#fff');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.22, width * 0.56, height * 0.56, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, t('br.great'), width / 2, height * 0.33, height * 0.07, '#ffd600');
      label(ctx, t('tickle.popped', { n: this.result.hits }), width / 2, height * 0.44, height * 0.05);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.57, height * 0.055, i < this.result.stars);
      label(ctx, t('tickle.back_soon'), width / 2, height * 0.7, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
