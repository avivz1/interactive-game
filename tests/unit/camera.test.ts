import { describe, expect, it } from 'vitest';
import { openCamera } from '../../src/phone/camera';

function fakeDevices(width: number, height: number, applyFails = false) {
  const calls: { get: MediaStreamConstraints[]; apply: MediaTrackConstraints[] } = { get: [], apply: [] };
  const track = {
    getSettings: () => ({ width, height }),
    applyConstraints: (c: MediaTrackConstraints) => {
      calls.apply.push(c);
      return applyFails ? Promise.reject(new Error('OverconstrainedError')) : Promise.resolve();
    },
  };
  const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
  const devices = {
    getUserMedia: (c?: MediaStreamConstraints) => {
      calls.get.push(c || {});
      return Promise.resolve(stream);
    },
  };
  return { devices, calls, stream };
}

describe('camera', () => {
  it('asks for a 4:3 picture (the full sensor height)', async () => {
    const { devices, calls } = fakeDevices(960, 720);
    await openCamera('environment', devices);
    const video = calls.get[0].video as MediaTrackConstraints;
    expect(video.aspectRatio).toEqual({ ideal: 4 / 3 });
    expect(video.width).toBeUndefined();
    expect(calls.apply).toHaveLength(0);
  });

  it('asks once more for exactly 4:3 when the browser gives a wide picture, either way up', async () => {
    for (const [w, h] of [
      [1280, 720],
      [720, 1280],
    ]) {
      const { devices, calls } = fakeDevices(w, h);
      await openCamera('environment', devices);
      expect(calls.apply).toHaveLength(1);
      expect(calls.apply[0].aspectRatio).toEqual({ exact: 4 / 3 });
    }
  });

  it('keeps the wide picture when 4:3 is not possible', async () => {
    const { devices, stream } = fakeDevices(1280, 720, true);
    await expect(openCamera('environment', devices)).resolves.toBe(stream);
  });
});

describe('pose model choice', () => {
  it('upgrades to full on a fast phone, falls back on a slow one, and retries full a minute later', async () => {
    (globalThis as unknown as { __MEDIAPIPE_VERSION__: string }).__MEDIAPIPE_VERSION__ = 'test';
    const { nextModel } = await import('../../src/phone/pose');
    expect(nextModel('lite', 20, null, 0)).toBe('full');
    expect(nextModel('lite', 35, null, 0)).toBeNull();
    expect(nextModel('full', 50, 0, 1000)).toBe('lite');
    expect(nextModel('full', 30, 0, 1000)).toBeNull();
    // tried a moment ago: stay on lite for now
    expect(nextModel('lite', 20, 1000, 30_000)).toBeNull();
    expect(nextModel('lite', 20, 1000, 61_000)).toBe('full');
  });
});
