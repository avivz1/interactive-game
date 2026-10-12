// Mirror Monster: a monster beside the child strikes a pose; a faint outline of
// that pose sits on the child's own body (a limb turns green when it matches).
// Hold the pose for a second to earn a star. A pose that is too hard just moves
// on with a shrug — never a "fail".

import type { Pt } from '../../shared/body';
import { matchPose, MirrorGame, segmentJoints, SEGMENTS, type Match, type MirrorEvent, type Segment } from '../../games/mirror';
import { t, type TextKey } from '../../shared/i18n';
import { CRITTER_COLORS, drawCritter } from '../critters';
import { drawBody } from '../draw';
import { Effects } from '../effects';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel, ring, star } from '../ui';

const AWAY_PAUSE_SEC = 2;
const RESULTS_SEC = 8;
/** Where each limb points when the pose doesn't care (arms and legs hanging down). */
const REST: Record<Segment, number> = { lUpper: 100, lFore: 95, rUpper: 80, rFore: 85, lThigh: 95, lShin: 92, rThigh: 85, rShin: 88 };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Moves an angle toward a target along the shorter way round. */
function turn(from: number, to: number, k: number): number {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return from + d * k;
}

export class MirrorScene implements Scene {
  readonly name = 'mirror-monster';
  private readonly game: MirrorGame;
  private readonly effects = new Effects();
  private clock = 0;
  private awayFor = 0;
  private awaySpokenAt = -100;
  private left = false;
  private match: Match | null = null;
  private banner: { key: TextKey; color: string; until: number } | null = null;
  private result: { wins: number; stars: number } | null = null;
  private resultFor = 0;
  private unit = 0;
  private monster: { x: number; y: number; r: number; side: number } | null = null;
  /** The monster's limb angles as drawn (they swing into each new pose). */
  private limbs: Record<Segment, number> = { ...REST };
  private lastDebug = 0;

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
    roundSec: number,
  ) {
    this.game = new MirrorGame({ durationSec: roundSec, seed: Math.floor(Math.random() * 1e9) });
  }

  enter(): void {
    this.stage.sound.startMusic(Math.floor(Math.random() * 1000));
    this.stage.sound.speak('mirror_intro', 0);
    this.stage.debug({ mmPhase: 'intro', wins: 0, ended: false, poseId: null });
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

  private show(key: TextKey, color: string, sec: number): void {
    this.banner = { key, color, until: this.clock + sec };
  }

  update(frame: Frame): void {
    const { dt, body } = frame;
    if (body.points[11] && body.points[12]) {
      this.unit = this.unit ? Math.max(body.shoulderWidth, this.unit * (1 - 0.08 * dt)) : body.shoulderWidth;
    }
    const unit = this.unit || body.shoulderWidth;
    this.clock += dt;
    this.effects.update(dt, unit);
    this.place(frame, unit);

    // the monster swings its arms and legs into the pose
    const g = this.game;
    const k = Math.min(1, dt * 7);
    for (const seg of SEGMENTS) {
      const aim = g.phase === 'pose' || g.phase === 'win' ? g.pose.aims[seg] : undefined;
      const wiggle = g.phase === 'miss' ? Math.sin(this.clock * 14) * 25 : 0;
      this.limbs[seg] = turn(this.limbs[seg], (aim ? aim.deg : REST[seg]) + wiggle, k);
    }

    if (this.result) {
      this.resultFor += dt;
      if (this.resultFor >= RESULTS_SEC) this.leave();
      return;
    }

    this.awayFor = frame.hasBody ? 0 : this.awayFor + dt;
    if (this.awayFor >= AWAY_PAUSE_SEC) {
      if (this.clock - this.awaySpokenAt > 8) {
        this.awaySpokenAt = this.clock;
        this.stage.sound.speak('away', 0);
      }
      return;
    }

    this.match = g.phase === 'pose' ? matchPose(body.points, g.pose) : null;
    const events = g.update(dt, this.match);
    for (const e of events) this.react(e, unit);
    if (this.clock - this.lastDebug > 0.5) {
      this.lastDebug = this.clock;
      this.stage.debug({ mmPhase: g.phase, poseId: g.pose.id, score: this.match ? Math.round(this.match.score * 100) / 100 : null });
    }
  }

  private react(e: MirrorEvent, unit: number): void {
    const sound = this.stage.sound;
    const m = this.monster;
    switch (e.type) {
      case 'pose':
        sound.select();
        this.banner = null;
        break;
      case 'matched':
        sound.speak('hold', 4);
        this.show('mm.hold', '#7dffa1', 1.2);
        break;
      case 'win':
        sound.cheer();
        sound.speak('did_it', 3);
        this.show('mm.did', '#ffd600', 1.6);
        if (m) this.effects.burst(m.x, m.y, unit, 30);
        this.stage.debug({ wins: e.wins });
        break;
      case 'miss':
        sound.giggle(2, this.game.posesShown);
        this.show('mm.next', '#ffffff', 1.2);
        break;
      case 'end':
        this.result = { wins: e.wins, stars: e.stars };
        this.banner = null;
        sound.stopMusic();
        sound.cheer();
        this.stage.debug({ ended: true, wins: e.wins, stars: e.stars, mmPhase: 'end' });
        break;
    }
  }

  private place(frame: Frame, s: number): void {
    const { body, rect, dt } = frame;
    const ls = body.points[11];
    const rs = body.points[12];
    if (!ls || !rs) return;
    const cx = (ls.x + rs.x) / 2;
    const sy = (ls.y + rs.y) / 2;
    const r = Math.max(s * 0.95, rect.h * 0.1);
    // arms out wide reach about 2 critter radii: keep clear of the child's own arms
    const gap = s * 1.7 + r * 1.3;
    const fits = (dir: number) => (dir > 0 ? rect.x + rect.w - cx : cx - rect.x) >= gap + r * 1.2;
    let side = this.monster ? this.monster.side : rect.x + rect.w - cx >= cx - rect.x ? 1 : -1;
    if (!fits(side) && fits(-side)) side = -side;
    // outstretched arms reach about 1.3 r from the middle: keep them on screen
    const x = Math.max(rect.x + r * 1.4, Math.min(rect.x + rect.w - r * 1.4, cx + side * gap));
    const y = Math.max(rect.y + r * 1.4, Math.min(rect.y + rect.h - r * 1.6, sy + s * 0.2));
    if (!this.monster) {
      this.monster = { x, y, r, side };
      return;
    }
    const k = Math.min(1, dt * 2);
    this.monster.side = side;
    this.monster.x += (x - this.monster.x) * k;
    this.monster.y += (y - this.monster.y) * k;
    this.monster.r += (r - this.monster.r) * k;
  }

  /** The monster: a round critter with chunky arms and legs at the given angles. */
  private drawMonster(ctx: CanvasRenderingContext2D, lookAt: Pt | null): void {
    const m = this.monster;
    if (!m) return;
    const g = this.game;
    const bob = g.phase === 'win' || this.result ? Math.abs(Math.sin(this.clock * 7)) * m.r * 0.12 : 0;
    const x = m.x;
    const y = m.y - bob;
    const br = m.r * 0.56;
    const color = CRITTER_COLORS[4];
    const limb = (from: Pt, deg1: number, len1: number, deg2: number, len2: number, end: number) => {
      const mid = { x: from.x + Math.cos(rad(deg1)) * len1, y: from.y + Math.sin(rad(deg1)) * len1 };
      const tip = { x: mid.x + Math.cos(rad(deg2)) * len2, y: mid.y + Math.sin(rad(deg2)) * len2 };
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [w, c] of [[br * 0.36, '#1b1530'], [br * 0.26, color]] as Array<[number, string]>) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(mid.x, mid.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1b1530';
      ctx.lineWidth = Math.max(2, br * 0.05);
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, end, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    const L = this.limbs;
    // legs behind the body, arms in front
    limb({ x: x - br * 0.45, y: y + br * 0.75 }, L.lThigh, br * 0.6, L.lShin, br * 0.55, br * 0.17);
    limb({ x: x + br * 0.45, y: y + br * 0.75 }, L.rThigh, br * 0.6, L.rShin, br * 0.55, br * 0.17);
    const stage = g.phase === 'win' || this.result ? 3 : g.phase === 'miss' ? 2 : 0;
    drawCritter(ctx, { x, y, r: m.r, color: 4, kind: 'normal', stage, age: this.clock, touched: false }, lookAt, false);
    limb({ x: x - br * 0.82, y: y + br * 0.05 }, L.lUpper, br * 0.75, L.lFore, br * 0.7, br * 0.2);
    limb({ x: x + br * 0.82, y: y + br * 0.05 }, L.rUpper, br * 0.75, L.rFore, br * 0.7, br * 0.2);
  }

  /** The pose's outline on the child's own body, from their shoulders and hips, with their limb lengths. */
  private drawGhost(ctx: CanvasRenderingContext2D, frame: Frame, unit: number): void {
    const g = this.game;
    if (g.phase !== 'pose') return;
    const joints = segmentJoints(frame.body.points);
    if (!joints) return;
    const chains: Array<[Segment, Segment]> = [
      ['lUpper', 'lFore'],
      ['rUpper', 'rFore'],
      ['lThigh', 'lShin'],
      ['rThigh', 'rShin'],
    ];
    ctx.lineCap = 'round';
    for (const [a, b] of chains) {
      const aimA = g.pose.aims[a];
      const aimB = g.pose.aims[b];
      if (!aimA || !aimB) continue;
      const [start, midReal] = joints[a];
      const [, endReal] = joints[b];
      if (!start) continue;
      const lenA = midReal ? Math.hypot(midReal.x - start.x, midReal.y - start.y) : unit * 0.6;
      const lenB = midReal && endReal ? Math.hypot(endReal.x - midReal.x, endReal.y - midReal.y) : unit * 0.55;
      const mid = { x: start.x + Math.cos(rad(aimA.deg)) * lenA, y: start.y + Math.sin(rad(aimA.deg)) * lenA };
      const end = { x: mid.x + Math.cos(rad(aimB.deg)) * lenB, y: mid.y + Math.sin(rad(aimB.deg)) * lenB };
      const segs = this.match ? this.match.segs : {};
      for (const [p, q, seg] of [[start, mid, a], [mid, end, b]] as Array<[Pt, Pt, Segment]>) {
        ctx.strokeStyle = segs[seg] ? 'rgba(125, 255, 161, 0.85)' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = Math.max(10, unit * 0.16);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height, body } = frame;
    const g = this.game;
    const unit = this.unit || body.shoulderWidth;
    this.drawGhost(ctx, frame, unit);
    drawBody(ctx, body, 0.5);
    this.drawMonster(ctx, body.head);
    this.effects.render(ctx, width);
    const m = this.monster;
    if (m && g.phase === 'pose') {
      // how long the pose has been held
      ring(ctx, { x: m.x, y: m.y }, m.r * 0.72, g.hold, '#7dffa1', Math.max(6, m.r * 0.07));
    }

    // HUD: poses copied and time left
    const hud = height * 0.075;
    star(ctx, width * 0.07, hud, height * 0.04, true);
    label(ctx, String(this.result ? this.result.wins : g.wins), width * 0.07 + height * 0.06, hud, height * 0.055, '#fff', 'left');
    if (g.phase !== 'intro' && !this.result) {
      ring(ctx, { x: width * 0.93, y: hud }, height * 0.04, g.remaining / g.config.durationSec, '#7dffa1', height * 0.012);
      label(ctx, String(Math.ceil(g.remaining)), width * 0.93, hud, height * 0.035);
    }

    // words go low on the screen: the top is where the child's head and raised arms are
    if (g.phase === 'intro') label(ctx, t('mm.intro'), width / 2, height * 0.86, height * 0.055, '#ffd23f');
    if (this.banner && this.clock < this.banner.until) label(ctx, t(this.banner.key), width / 2, height * 0.86, height * 0.075, this.banner.color);
    if (!this.stage.sound.ready) label(ctx, t('hint.sound'), width / 2, height * 0.95, height * 0.03, '#ffd600');

    if (this.awayFor >= AWAY_PAUSE_SEC && !this.result) {
      panel(ctx, width * 0.2, height * 0.4, width * 0.6, height * 0.2, height * 0.04, 'rgba(11,16,32,0.75)');
      label(ctx, t('tickle.away'), width / 2, height * 0.5, height * 0.05, '#fff');
    }

    if (this.result) {
      panel(ctx, width * 0.22, height * 0.22, width * 0.56, height * 0.56, height * 0.05, 'rgba(11,16,32,0.85)', '#ffd600');
      label(ctx, t('mm.great'), width / 2, height * 0.33, height * 0.07, '#ffd600');
      label(ctx, t('mm.poses', { n: this.result.wins }), width / 2, height * 0.44, height * 0.05);
      for (let i = 0; i < 3; i++) star(ctx, width / 2 + (i - 1) * height * 0.13, height * 0.57, height * 0.055, i < this.result.stars);
      label(ctx, t('tickle.back_soon'), width / 2, height * 0.7, height * 0.03, 'rgba(255,255,255,0.8)');
    }
  }
}
