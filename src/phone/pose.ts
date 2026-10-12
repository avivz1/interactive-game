// Body tracking on the phone. MediaPipe Pose runs on-device; only the 33 landmark
// coordinates leave the phone (to the TV). `?pose=synthetic` swaps in a fake
// dancing figure for tests and demos without a person in front of the camera.

import type * as Vision from '@mediapipe/tasks-vision';
import type { Landmark } from '../shared/landmarks';
import { LM, POSE_LANDMARK_COUNT } from '../shared/landmarks';

declare const __MEDIAPIPE_VERSION__: string;

const MP_BASE = '/mediapipe/' + __MEDIAPIPE_VERSION__ + '/';
const MODEL_URLS = {
  lite: '/mediapipe/models/pose_landmarker_lite_f16_v1.task',
  full: '/mediapipe/models/pose_landmarker_full_f16_v1.task',
};
const MIN_INTERVAL_MS = 30; // ~33 Hz cap
/** Frames measured before deciding whether to switch models. */
const EVAL_FRAMES = 60;
/** Upgrade lite -> full when lite runs faster than this (ms per frame). */
const UPGRADE_MS = 22;
/** Fall back full -> lite when full is slower than this. */
const DOWNGRADE_MS = 45;

export type PoseModel = keyof typeof MODEL_URLS;

export type PoseHandler = (landmarks: Landmark[] | null, captureTime: number) => void;

export interface PoseSource {
  readonly name: 'mediapipe' | 'synthetic';
  start(video: HTMLVideoElement, onPose: PoseHandler): Promise<void>;
  /** Point tracking at a new video element/stream (camera switch). */
  setVideo(video: HTMLVideoElement): void;
  stop(): void;
  readonly fps: number;
  readonly inferMs: number;
  readonly model: PoseModel;
}

type FrameMeta = { captureTime?: number };
type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
};

class RateMeter {
  private count = 0;
  private since = performance.now();
  value = 0;

  tick(): void {
    this.count++;
    const now = performance.now();
    if (now - this.since >= 1000) {
      this.value = (this.count * 1000) / (now - this.since);
      this.count = 0;
      this.since = now;
    }
  }
}

/**
 * Starts with the small 'lite' model (fast download, works everywhere), then
 * switches to the more accurate 'full' model if this phone is fast enough —
 * full tracks hands and heads at 2-3 m much better.
 */
export class MediaPipePose implements PoseSource {
  readonly name = 'mediapipe' as const;
  private vision: typeof Vision | null = null;
  private fileset: Awaited<ReturnType<typeof Vision.FilesetResolver.forVisionTasks>> | null = null;
  private landmarker: Vision.PoseLandmarker | null = null;
  private currentModel: PoseModel = 'lite';
  private framesOnModel = 0;
  private triedFull = false;
  private switching = false;
  private video: VideoWithFrames | null = null;
  private onPose: PoseHandler | null = null;
  private running = false;
  private lastRun = 0;
  private lastTs = 0;
  private rate = new RateMeter();
  private avgInfer = 0;
  delegate: 'GPU' | 'CPU' = 'GPU';

  get fps(): number {
    return this.rate.value;
  }

  get inferMs(): number {
    return this.avgInfer;
  }

  get model(): PoseModel {
    return this.currentModel;
  }

  private create(model: PoseModel, delegate: 'GPU' | 'CPU'): Promise<Vision.PoseLandmarker> {
    return this.vision!.PoseLandmarker.createFromOptions(this.fileset!, {
      baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  }

  async start(video: HTMLVideoElement, onPose: PoseHandler): Promise<void> {
    this.vision = (await import(/* @vite-ignore */ MP_BASE + 'vision_bundle.mjs')) as typeof Vision;
    this.fileset = await this.vision.FilesetResolver.forVisionTasks(MP_BASE + 'wasm');
    try {
      this.landmarker = await this.create('lite', 'GPU');
    } catch {
      this.delegate = 'CPU';
      this.landmarker = await this.create('lite', 'CPU');
    }
    this.onPose = onPose;
    this.running = true;
    this.setVideo(video);
  }

  /** Called after each frame: switch models when the measured speed says so. */
  private maybeSwitch(): void {
    if (this.switching || ++this.framesOnModel < EVAL_FRAMES) return;
    if (this.currentModel === 'lite' && !this.triedFull && this.avgInfer < UPGRADE_MS) {
      this.triedFull = true;
      void this.swapTo('full');
    } else if (this.currentModel === 'full' && this.avgInfer > DOWNGRADE_MS) {
      void this.swapTo('lite');
    }
  }

  private async swapTo(model: PoseModel): Promise<void> {
    this.switching = true;
    try {
      const next = await this.create(model, this.delegate);
      if (!this.running) {
        next.close();
        return;
      }
      const old = this.landmarker;
      this.landmarker = next;
      this.currentModel = model;
      this.framesOnModel = 0;
      this.avgInfer = 0;
      if (old) old.close();
    } catch {
      // keep the current model
    } finally {
      this.switching = false;
    }
  }

  setVideo(video: HTMLVideoElement): void {
    this.video = video as VideoWithFrames;
    if (this.running) this.schedule(this.video);
  }

  private schedule(video: VideoWithFrames): void {
    const step = (now: number, meta?: FrameMeta) => {
      if (!this.running || this.video !== video) return;
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(step);
      else requestAnimationFrame((t) => step(t));
      if (now - this.lastRun < MIN_INTERVAL_MS) return;
      this.detect(video, meta);
    };
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(step);
    else requestAnimationFrame((t) => step(t));
  }

  private detect(video: HTMLVideoElement, meta?: FrameMeta): void {
    if (!this.landmarker || !this.onPose || video.readyState < 2 || video.videoWidth === 0) return;
    const start = performance.now();
    this.lastRun = start;
    const captureTime = meta && typeof meta.captureTime === 'number' && meta.captureTime > 0 ? meta.captureTime : start;
    const ts = Math.max(this.lastTs + 1, start);
    this.lastTs = ts;
    let landmarks: Landmark[] | null = null;
    try {
      const res = this.landmarker.detectForVideo(video, ts);
      const first = res.landmarks[0];
      if (first && first.length === POSE_LANDMARK_COUNT) {
        landmarks = first.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility }));
      }
    } catch {
      return;
    }
    const took = performance.now() - start;
    this.avgInfer = this.avgInfer === 0 ? took : this.avgInfer * 0.9 + took * 0.1;
    this.rate.tick();
    this.onPose(landmarks, captureTime);
    this.maybeSwitch();
  }

  stop(): void {
    this.running = false;
    this.onPose = null;
    if (this.landmarker) this.landmarker.close();
    this.landmarker = null;
  }
}

/** A waving stick figure, in camera (un-mirrored) image coordinates. */
export function syntheticFigure(tSec: number): Landmark[] {
  const pts: Landmark[] = [];
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) pts.push({ x: 0.5, y: 0.2, visibility: 0 });
  const set = (i: number, x: number, y: number) => {
    pts[i] = { x, y, visibility: 0.99 };
  };
  const sway = Math.sin(tSec * 1.5) * 0.03;
  const wave = Math.sin(tSec * 4);
  set(LM.nose, 0.5 + sway, 0.2);
  set(LM.leftEar, 0.53 + sway, 0.19);
  set(LM.rightEar, 0.47 + sway, 0.19);
  set(LM.leftShoulder, 0.58 + sway, 0.33);
  set(LM.rightShoulder, 0.42 + sway, 0.33);
  // waving out to the side at chest height (below the menu's game bubbles)
  set(LM.leftElbow, 0.68 + sway, 0.36 - wave * 0.03);
  set(LM.leftWrist, 0.76 + sway, 0.36 - wave * 0.08);
  set(LM.rightElbow, 0.35 + sway, 0.43);
  set(LM.rightWrist, 0.33 + sway, 0.55 + wave * 0.03);
  set(LM.leftHip, 0.55, 0.6);
  set(LM.rightHip, 0.45, 0.6);
  set(LM.leftKnee, 0.56, 0.75);
  set(LM.rightKnee, 0.44, 0.75);
  set(LM.leftAnkle, 0.57, 0.9);
  set(LM.rightAnkle, 0.43, 0.9);
  return pts;
}

/**
 * The left hand's path for `?pose=synthetic&act=draw` (seconds, x, y before
 * mirroring): a round body, two ears and two legs, lifting the hand between
 * strokes with quick moves in and out, like a child drawing. Loops every 16 s.
 */
const DRAW_SCRIPT: ReadonlyArray<readonly [number, number, number]> = (() => {
  const rest = [0.72, 0.62] as const;
  const keys: Array<[number, number, number]> = [[0, rest[0], rest[1]], [2, rest[0], rest[1]]];
  // body: a loose circle
  const start = 2.4;
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI * 2 * 1.04;
    keys.push([start + (i / 24) * 4, 0.5 + Math.cos(a) * 0.085, 0.27 + Math.sin(a) * 0.11]);
  }
  const strokes: Array<Array<[number, number]>> = [
    [[0.455, 0.18], [0.44, 0.1], [0.485, 0.165]],
    [[0.52, 0.165], [0.56, 0.1], [0.55, 0.18]],
    [[0.47, 0.375], [0.46, 0.47]],
    [[0.53, 0.375], [0.54, 0.47]],
  ];
  let t = start + 4;
  for (const stroke of strokes) {
    keys.push([t + 0.3, rest[0], rest[1]]); // quick move out of the board
    t += 0.9;
    keys.push([t, rest[0], rest[1]]);
    t += 0.3; // quick move in
    stroke.forEach((p, i) => keys.push([t + i * 0.6, p[0], p[1]]));
    t += (stroke.length - 1) * 0.6;
  }
  keys.push([t + 0.3, rest[0], rest[1]], [16, rest[0], rest[1]]);
  return keys;
})();

function drawScriptAt(tSec: number): [number, number] {
  const t = tSec % 16;
  for (let i = 1; i < DRAW_SCRIPT.length; i++) {
    const b = DRAW_SCRIPT[i];
    if (t <= b[0]) {
      const a = DRAW_SCRIPT[i - 1];
      const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  const last = DRAW_SCRIPT[DRAW_SCRIPT.length - 1];
  return [last[1], last[2]];
}

/** The synthetic figure dancing hard: bouncing with both arms waving (`act=dance`). */
export function syntheticDancer(tSec: number): Landmark[] {
  const pts = syntheticFigure(tSec);
  const bounce = Math.sin(tSec * 8) * 0.04;
  const wave = Math.sin(tSec * 6) * 0.1;
  return pts.map((p, i) => {
    if (!p.visibility) return p;
    const arm = i === LM.leftWrist || i === LM.rightWrist ? wave : i === LM.leftElbow || i === LM.rightElbow ? wave * 0.5 : 0;
    return { x: p.x, y: p.y + bounce - arm, visibility: p.visibility };
  });
}

/** The synthetic figure standing perfectly still (`act=still`, for Freeze Dance tests). */
export function syntheticStill(): Landmark[] {
  return syntheticFigure(0);
}

/** The synthetic figure drawing a creature with its left hand (for Draw & Alive tests). */
export function syntheticDrawer(tSec: number): Landmark[] {
  const pts = syntheticFigure(tSec);
  const [x, y] = drawScriptAt(tSec);
  // the palm is extended past the wrist along the forearm; place the wrist so the palm follows the path
  pts[LM.leftElbow] = { x: x + 0.04, y: y + 0.135, visibility: 0.99 };
  pts[LM.leftWrist] = { x: x + 0.0137, y: y + 0.035, visibility: 0.99 };
  return pts;
}

export class SyntheticPose implements PoseSource {
  readonly name = 'synthetic' as const;
  readonly inferMs = 0;
  readonly model: PoseModel = 'lite';
  private timer: ReturnType<typeof setInterval> | null = null;
  private rate = new RateMeter();

  constructor(private readonly figure: (tSec: number) => Landmark[] = syntheticFigure) {}

  get fps(): number {
    return this.rate.value;
  }

  async start(_video: HTMLVideoElement, onPose: PoseHandler): Promise<void> {
    const t0 = performance.now();
    // tests read this to time the synthetic figure's scripted moves
    (window as unknown as { __synthStart?: number }).__synthStart = t0;
    this.timer = setInterval(() => {
      this.rate.tick();
      const now = performance.now();
      onPose(this.figure((now - t0) / 1000), now);
    }, 33);
  }

  setVideo(_video: HTMLVideoElement): void {
    // synthetic poses ignore the camera
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
