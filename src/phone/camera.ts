export type Facing = 'environment' | 'user';

export function openCamera(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
}

export function cameraErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was blocked. Allow the camera for this site in the browser settings, then reload.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No suitable camera was found on this phone.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy. Close other apps that use the camera and try again.';
    default:
      return 'Could not start the camera.';
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
