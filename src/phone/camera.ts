import { t } from '../shared/i18n';

export type Facing = 'environment' | 'user';

/**
 * Opens the camera with a 4:3 picture: the sensor's full height (a 16:9
 * picture crops a quarter of it), so raised hands and feet both fit. If the
 * browser still gives a wide picture, it asks once more for 4:3 exactly.
 */
export async function openCamera(facing: Facing, devices: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices): Promise<MediaStream> {
  const stream = await devices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      aspectRatio: { ideal: 4 / 3 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  const track = stream.getVideoTracks()[0];
  const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
  const w = settings.width || 0;
  const h = settings.height || 0;
  if (track && w > 0 && h > 0 && Math.max(w, h) / Math.min(w, h) > 1.5) {
    try {
      await track.applyConstraints({ aspectRatio: { exact: 4 / 3 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } });
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
