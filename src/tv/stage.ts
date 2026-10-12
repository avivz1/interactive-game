// Full-screen stage: the mirrored video with a canvas on top, and one active
// scene (setup, menu, a game, TV check) that is updated and drawn every frame.

import type { Body } from '../shared/body';
import { h, mount } from '../shared/dom';
import type { Landmark } from '../shared/landmarks';
import { containRect, type Rect } from '../shared/mapping';
import type { Sound } from './audio';
import type { LiveSession } from './session';

export type Key = 'ok' | 'back' | 'left' | 'right' | 'up' | 'down';

export interface Frame {
  now: number;
  /** Seconds since the previous frame (capped). */
  dt: number;
  width: number;
  height: number;
  /** Where the video picture is on screen. */
  rect: Rect;
  body: Body;
  /** Smoothed normalized landmarks (null when lost). */
  landmarks: (Landmark | null)[];
  /** True when shoulders are tracked. */
  hasBody: boolean;
}

export interface Scene {
  readonly name: string;
  enter?(): void;
  update(frame: Frame): void;
  render(ctx: CanvasRenderingContext2D, frame: Frame): void;
  onKey?(key: Key): void;
  exit?(): void;
}

declare global {
  interface Window {
    __tvDebug?: Record<string, unknown>;
  }
}

/** Maps TV remote / keyboard events (Samsung, LG and PC key codes) to actions. */
export function keyFromEvent(e: KeyboardEvent): Key | null {
  const k = e.key || '';
  switch (e.keyCode) {
    case 13:
      return 'ok';
    case 37:
      return 'left';
    case 38:
      return 'up';
    case 39:
      return 'right';
    case 40:
      return 'down';
    case 27:
    case 461: // LG
    case 10009: // Samsung
      return 'back';
  }
  if (k === 'Enter') return 'ok';
  if (k === 'ArrowLeft') return 'left';
  if (k === 'ArrowRight') return 'right';
  if (k === 'ArrowUp') return 'up';
  if (k === 'ArrowDown') return 'down';
  if (k === 'Escape' || k === 'GoBack') return 'back';
  return null;
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly session: LiveSession;
  readonly sound: Sound;
  private scene: Scene | null = null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly banner: HTMLElement;
  private raf = 0;
  private last = 0;
  private lastDebug = 0;
  private disposed = false;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, session: LiveSession, sound: Sound) {
    this.session = session;
    this.sound = sound;
    this.canvas = h('canvas', { class: 'live-canvas' });
    this.banner = h('div', { class: 'banner hidden', text: 'Phone connection lost — waiting…' });
    mount(root, h('div', { class: 'live', testid: 'live' }, session.video, this.canvas, this.banner));
    this.ctx = this.canvas.getContext('2d');
    this.onKeyDown = (e: KeyboardEvent) => {
      sound.unlock();
      const key = keyFromEvent(e);
      if (!key || !this.scene || !this.scene.onKey) return;
      e.preventDefault();
      this.scene.onKey(key);
    };
    document.addEventListener('keydown', this.onKeyDown);
    this.raf = requestAnimationFrame(this.loop);
  }

  go(scene: Scene): void {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = scene;
    if (scene.enter) scene.enter();
    this.debug({ scene: scene.name });
  }

  get sceneName(): string {
    return this.scene ? this.scene.name : '';
  }

  /** Merges values into window.__tvDebug (read by tests and the TV check screen). */
  debug(values: Record<string, unknown>): void {
    const cur = window.__tvDebug || {};
    for (const k in values) cur[k] = values[k];
    window.__tvDebug = cur;
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 1 / 60;
    this.last = now;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const video = this.session.video;
    const rect = video.videoWidth > 0 ? containRect(video.videoWidth, video.videoHeight, width, height) : { x: 0, y: 0, w: width, h: height };
    const sample = this.session.sample(performance.now(), rect);
    const lm = sample.landmarks;
    const frame: Frame = {
      now,
      dt,
      width,
      height,
      rect,
      body: sample.body,
      landmarks: lm,
      hasBody: !!(lm[11] && lm[12]),
    };
    this.banner.className = this.session.reconnecting ? 'banner' : 'banner hidden';
    if (now - this.lastDebug > 1000) {
      this.lastDebug = now;
      const st = this.session.stats as unknown as Record<string, unknown>;
      this.debug(st);
    }
    if (!this.scene || !this.ctx) return;
    this.scene.update(frame);
    this.ctx.clearRect(0, 0, width, height);
    this.scene.render(this.ctx, frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKeyDown);
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = null;
    this.sound.stopMusic();
  }
}
