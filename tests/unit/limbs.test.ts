import { describe, expect, it } from 'vitest';
import { Limbs } from '../../src/games/limbs';
import { buildBody, type Body } from '../../src/shared/body';
import { LM, type Landmark } from '../../src/shared/landmarks';

const RECT = { x: 0, y: 0, w: 1000, h: 1000 };

/** A standing child in normalized coordinates (no mirroring), with overrides. */
function child(over: Partial<Record<number, [number, number]>> = {}): Body {
  const at: Record<number, [number, number]> = {
    [LM.nose]: [0.5, 0.2],
    [LM.leftShoulder]: [0.6, 0.3],
    [LM.rightShoulder]: [0.4, 0.3],
    [LM.leftElbow]: [0.63, 0.42],
    [LM.rightElbow]: [0.37, 0.42],
    [LM.leftWrist]: [0.63, 0.53],
    [LM.rightWrist]: [0.37, 0.53],
    [LM.leftHip]: [0.56, 0.55],
    [LM.rightHip]: [0.44, 0.55],
    [LM.leftKnee]: [0.56, 0.72],
    [LM.rightKnee]: [0.44, 0.72],
    [LM.leftAnkle]: [0.56, 0.9],
    [LM.rightAnkle]: [0.44, 0.9],
    [LM.leftFootIndex]: [0.57, 0.93],
    [LM.rightFootIndex]: [0.43, 0.93],
    ...over,
  };
  const lms: (Landmark | null)[] = [];
  for (let i = 0; i < 33; i++) lms.push(at[i] ? { x: at[i]![0], y: at[i]![1], visibility: 0.99 } : null);
  return buildBody(lms, RECT, false);
}

describe('limbs that may touch creatures', () => {
  it('ignores hands hanging at the sides and feet standing on the floor', () => {
    const limbs = new Limbs();
    const t = limbs.update(child(), 1 / 30);
    expect(t.hands).toEqual([null, null]);
    expect(t.feet).toEqual([null, null]);
  });

  it('counts a hand reaching out and a foot lifted for a kick', () => {
    const limbs = new Limbs();
    limbs.update(child(), 1 / 30);
    const t = limbs.update(
      child({
        [LM.leftElbow]: [0.72, 0.33],
        [LM.leftWrist]: [0.84, 0.36],
        [LM.rightKnee]: [0.4, 0.68],
        [LM.rightAnkle]: [0.33, 0.76],
        [LM.rightFootIndex]: [0.3, 0.78],
      }),
      1 / 30,
    );
    expect(t.hands[0]).not.toBeNull();
    expect(t.hands[1]).toBeNull();
    expect(t.feet[0]).toBeNull();
    expect(t.feet[1]).not.toBeNull();
  });
});
