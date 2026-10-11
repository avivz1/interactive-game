import type { Landmark } from '../../src/shared/landmarks';

export function syntheticLandmarks(): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i < 33; i++) out.push({ x: (i * 0.037) % 1, y: 1 - ((i * 0.053) % 1), visibility: (i % 10) / 9 });
  return out;
}
