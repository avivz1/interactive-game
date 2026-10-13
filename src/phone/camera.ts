import { t } from '../shared/i18n';

export type Facing = 'environment' | 'user';

/**
 * The camera picture we ask for: the sensor's own 4:3 mode (a 16:9 picture
 * crops a quarter of its height), never a 4:3 cut out of a 16:9 picture
 * (`resizeMode: 'none'` makes browsers prefer a native mode over cropping).
 */
function constraints(facing: Facing, exact: boolean): MediaTrackConstraints {
  return {
    facingMode: { ideal: facing },
    aspectRatio: exact ? { exact: 4 / 3 } : { ideal: 4 / 3 },
    width: { ideal: 1280 },
    height: { ideal: 960 },
    frameRate: { ideal: 30, max: 30 },
    // not in every TypeScript DOM version yet
    ...({ resizeMode: exact ? { exact: 'none' } : { ideal: 'none' } } as MediaTrackConstraints),
  };
}

/**
 * Opens the camera with the full 4:3 sensor picture, so raised hands and feet
 * both fit. If the browser still gives a wide picture, it asks once more for a
 * native 4:3 mode (and keeps the wide one if there is none).
 */
export async function openCamera(facing: Facing, devices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices): Promise<MediaStream> {
  const stream = await devices.getUserMedia({ audio: false, video: constraints(facing, false) });
  const track = stream.getVideoTracks()[0];
  const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
  const w = settings.width || 0;
  const h = settings.height || 0;
  if (track && w > 0 && h > 0 && Math.max(w, h) / Math.min(w, h) > 1.5) {
    try {
      await track.applyConstraints(constraints(facing, true));
    } catch {
      // keep the wide picture
    }
  }
  return stream;
}

export function cameraErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return t('cam.blocked');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return t('cam.not_found');
    case 'NotReadableError':
    case 'AbortError':
      return t('cam.busy');
    default:
      return t('cam.failed');
  }
}

/** Keeps the phone screen on while streaming (the camera stops if the phone locks). */
export class ScreenWakeLock {
  private lock: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  async acquire(): Promise<boolean> {
    this.wanted = true;
    if (!this.supported || (this.lock && !this.lock.released)) return !!this.lock;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      this.lock = null;
      return false;
    }
  }

  release(): void {
    this.wanted = false;
    if (this.lock) void this.lock.release().catch(() => undefined);
    this.lock = null;
  }
}
