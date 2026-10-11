import { describe, expect, it } from 'vitest';
import { decodePose, encodePose, parseCtl } from '../../src/shared/protocol';
import { syntheticLandmarks } from './helpers';

describe('pose packets', () => {
  it('round-trips landmarks within quantization error', () => {
    const lms = syntheticLandmarks();
    const pkt = decodePose(encodePose(65537, 1234.5, lms));
    expect(pkt).not.toBeNull();
    expect(pkt!.seq).toBe(1); // wraps at 16 bits
    expect(pkt!.captureTime).toBe(1234.5);
    expect(pkt!.landmarks).toHaveLength(33);
    pkt!.landmarks!.forEach((p, i) => {
      expect(Math.abs(p.x - lms[i].x)).toBeLessThan(1e-4);
      expect(Math.abs(p.y - lms[i].y)).toBeLessThan(1e-4);
      expect(Math.abs(p.visibility - lms[i].visibility)).toBeLessThan(0.005);
    });
  });

  it('is 178 bytes for a full body and 13 bytes for no body', () => {
    expect(encodePose(0, 0, syntheticLandmarks()).byteLength).toBe(178);
    const empty = encodePose(0, 5, null);
    expect(empty.byteLength).toBe(13);
    expect(decodePose(empty)!.landmarks).toBeNull();
  });

  it('clamps out-of-range coordinates', () => {
    const pkt = decodePose(encodePose(0, 0, [{ x: -3, y: 9, visibility: 2 }]))!;
    expect(pkt.landmarks![0].x).toBeCloseTo(-0.5, 4);
    expect(pkt.landmarks![0].y).toBeCloseTo(1.5, 4);
    expect(pkt.landmarks![0].visibility).toBe(1);
  });

  it('rejects malformed packets', () => {
    expect(decodePose(new ArrayBuffer(5))).toBeNull();
    const wrongVersion = encodePose(0, 0, null);
    new DataView(wrongVersion).setUint8(0, 9);
    expect(decodePose(wrongVersion)).toBeNull();
    const truncated = encodePose(0, 0, syntheticLandmarks()).slice(0, 100);
    expect(decodePose(truncated)).toBeNull();
    const nan = encodePose(0, 0, null);
    new DataView(nan).setFloat64(4, NaN, true);
    expect(decodePose(nan)).toBeNull();
  });
});

describe('control messages', () => {
  it('accepts valid messages', () => {
    expect(parseCtl('{"t":"ping","id":1,"tv":2}')).toEqual({ t: 'ping', id: 1, tv: 2 });
    expect(parseCtl('{"t":"bye"}')).toEqual({ t: 'bye' });
    expect(parseCtl('{"t":"hello","v":1,"width":1280,"height":720,"facing":"user","source":"mediapipe"}')).not.toBeNull();
  });

  it('rejects invalid messages', () => {
    expect(parseCtl('not json')).toBeNull();
    expect(parseCtl('{"t":"ping","id":"1","tv":2}')).toBeNull();
    expect(parseCtl('{"t":"hello","v":2,"width":1,"height":1,"facing":"user","source":"mediapipe"}')).toBeNull();
    expect(parseCtl('{"t":"nope"}')).toBeNull();
    expect(parseCtl('null')).toBeNull();
    expect(parseCtl(42)).toBeNull();
    expect(parseCtl('{"t":"bye","pad":"' + 'x'.repeat(3000) + '"}')).toBeNull();
  });
});
