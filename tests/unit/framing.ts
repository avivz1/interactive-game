// Test fixture: a person in front of a level phone camera (pinhole model), as
// MediaPipe would report them: normalized landmarks in the camera picture,
// before mirroring. Points outside the picture get a low visibility (MediaPipe
// still guesses them). Used to check framing, the menu and the games with
// grown-ups, kneeling grown-ups and children, at different phone heights,
// distances and picture shapes.

import { buildBody, type Body } from '../../src/shared/body';
import { LM, type Landmark } from '../../src/shared/landmarks';
import { containRect, type Rect } from '../../src/shared/mapping';

/** Heights above the floor and sizes in metres. */
export interface Person {
  name: string;
  nose: number;
  shoulder: number;
  hip: number;
  knee: number;
  ankle: number;
  /** Shoulder joint to shoulder joint. */
  shoulderWidth: number;
  upperArm: number;
  forearm: number;
}

export function adult(height = 1.75, kneeling = false): Person {
  // kneeling drops everything above the knees by about 0.23 of the height
  const drop = kneeling ? 0.23 * height : 0;
  return {
    name: `${kneeling ? 'kneeling ' : ''}adult ${height} m`,
    nose: 0.913 * height - drop,
    shoulder: 0.818 * height - drop,
    hip: 0.53 * height - drop,
    knee: kneeling ? 0.05 * height : 0.285 * height,
    ankle: kneeling ? 0.05 * height : 0.039 * height,
    shoulderWidth: 0.2 * height,
    upperArm: 0.186 * height,
    forearm: 0.146 * height,
  };
}

export function child(height = 1.12): Person {
  return {
    name: `child ${height} m`,
    nose: 0.885 * height,
    shoulder: 0.79 * height,
    hip: 0.49 * height,
    knee: 0.27 * height,
    ankle: 0.045 * height,
    shoulderWidth: 0.225 * height,
    upperArm: 0.18 * height,
    forearm: 0.14 * height,
  };
}

export interface Camera {
  /** Lens height above the floor (m). */
  height: number;
  /** Distance to the person (m). */
  distance: number;
  /** Picture width / height (below 1 for a phone standing upright). */
  aspect: number;
}

/** Half the field of view along the picture's long side (a phone's main lens, about 68°). */
const TAN_HALF_LONG = Math.tan((34 * Math.PI) / 180);

/** Camera picture coordinates (0..1, y down) of a point X metres to the camera's right, Y metres high. */
export function project(cam: Camera, X: number, Y: number): { x: number; y: number } {
  const halfLong = cam.distance * TAN_HALF_LONG;
  const halfW = cam.aspect >= 1 ? halfLong : halfLong * cam.aspect;
  const halfH = cam.aspect >= 1 ? halfLong / cam.aspect : halfLong;
  return { x: 0.5 + X / (2 * halfW), y: 0.5 - (Y - cam.height) / (2 * halfH) };
}

/**
 * Arm angles in degrees, measured outward from hanging straight down:
 * 0 down, 90 straight out to the side, 180 straight up.
 */
export interface Arms {
  left: number;
  right: number;
}

/** The person's 33 landmarks as the phone sees them (facing the camera: their left is the camera's right). */
export function landmarks(p: Person, cam: Camera, arms: Arms = { left: 10, right: 10 }, x = 0): Array<Landmark | null> {
  const out: Array<Landmark | null> = new Array(33).fill(null);
  const set = (i: number, X: number, Y: number) => {
    const q = project(cam, x + X, Y);
    const inside = q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1;
    out[i] = { x: q.x, y: q.y, visibility: inside ? 0.9 : 0.1 };
  };
  const half = p.shoulderWidth / 2;
  set(LM.nose, 0, p.nose);
  set(LM.leftEar, 0.07, p.nose + 0.01);
  set(LM.rightEar, -0.07, p.nose + 0.01);
  set(LM.leftShoulder, half, p.shoulder);
  set(LM.rightShoulder, -half, p.shoulder);
  set(LM.leftHip, half * 0.8, p.hip);
  set(LM.rightHip, -half * 0.8, p.hip);
  set(LM.leftKnee, half * 0.6, p.knee);
  set(LM.rightKnee, -half * 0.6, p.knee);
  set(LM.leftAnkle, half * 0.6, p.ankle);
  set(LM.rightAnkle, -half * 0.6, p.ankle);
  set(LM.leftFootIndex, half * 0.65, p.ankle - 0.02);
  set(LM.rightFootIndex, -half * 0.65, p.ankle - 0.02);
  for (const [side, deg, elbow, wrist] of [
    [1, arms.left, LM.leftElbow, LM.leftWrist],
    [-1, arms.right, LM.rightElbow, LM.rightWrist],
  ] as const) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.sin(a) * side;
    const dy = -Math.cos(a);
    const sx = side * half;
    set(elbow, sx + dx * p.upperArm, p.shoulder + dy * p.upperArm);
    set(wrist, sx + dx * (p.upperArm + p.forearm), p.shoulder + dy * (p.upperArm + p.forearm));
  }
  return out;
}

/** The TV screen area the camera picture fills (1920x1080 TV). */
export function tvRect(cam: Camera): Rect {
  return containRect(Math.round(cam.aspect * 720), 720, 1920, 1080);
}

/** Landmarks the TV keeps: points outside the picture are dropped (the TV's visibility cutoff). */
export function seen(points: Array<Landmark | null>): Array<Landmark | null> {
  return points.map((p) => (p && p.visibility >= 0.3 ? p : null));
}

/** The body as the TV builds it (mirrored), from what the TV keeps. */
export function tvBody(p: Person, cam: Camera, arms?: Arms, x = 0): { body: Body; rect: Rect } {
  const rect = tvRect(cam);
  return { body: buildBody(seen(landmarks(p, cam, arms, x)), rect, true), rect };
}
