// Body tracking on the phone. MediaPipe Pose runs on-device; only the 33 landmark
// coordinates leave the phone (to the TV). `?pose=synthetic` swaps in a fake
// dancing figure for tests and demos without a person in front of the camera.

import type * as Vision from '@mediapipe/tasks-vision';
import type { Landmark } from '../shared/landmarks';
import { LM, POSE_LANDMARK_COUNT } from '../shared/landmarks';

declare const __MEDIAPIPE_VERSION__: string;

const MP_BASE = '/mediapipe/' + __MEDIAPIPE_VERSION__ + '/';
const MODEL_URL = '/mediapipe/models/pose_landmarker_lite_f16_v1.task';
const MIN_INTERVAL_MS = 30; // ~33 Hz cap

export type PoseHandler = (landmarks: Landmark[] | null, captureTime: number) => void;

export interface PoseSource {
  readonly name: 'mediapipe' | 'synthetic';
  start(video: HTMLVideoElement, onPose: PoseHandler): Promise<void>;
  /** Point tracking at a new video element/stream (camera switch). */
  setVideo(video: HTMLVideoElement): void;
  stop(): void;
  readonly fps: number;
  readonly inferMs: number;
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

export class MediaPipePose implements PoseSource {
  readonly name = 'mediapipe' as const;
  private landmarker: Vision.PoseLandmarker | null = null;
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

  async start(video: HTMLVideoElement, onPose: PoseHandler): Promise<void> {
    const vision = (await import(/* @vite-ignore */ MP_BASE + 'vision_bundle.mjs')) as typeof Vision;
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_BASE + 'wasm');
    const create = (delegate: 'GPU' | 'CPU') =>
      vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    try {
      this.landmarker = await create('GPU');
    } catch {
      this.delegate = 'CPU';
      this.landmarker = await create('CPU');
    }
    this.onPose = onPose;
    this.running = true;
    this.setVideo(video);
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
  set(LM.leftElbow, 0.66 + sway, 0.27 - wave * 0.05);
  set(LM.leftWrist, 0.7 + sway, 0.15 - wave * 0.08);
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

export class SyntheticPose implements PoseSource {
  readonly name = 'synthetic' as const;
  readonly inferMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rate = new RateMeter();

  get fps(): number {
    return this.rate.value;
  }

  async start(_video: HTMLVideoElement, onPose: PoseHandler): Promise<void> {
    const t0 = performance.now();
    this.timer = setInterval(() => {
      this.rate.tick();
      const now = performance.now();
      onPose(syntheticFigure((now - t0) / 1000), now);
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
