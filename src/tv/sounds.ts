// Recorded sound effects (generated with ElevenLabs) served from /sounds/.
// start/end trim each take (seconds); gain evens out loudness between takes.

export type SampleName = 'giggle' | 'laugh' | 'pop' | 'wheee' | 'achoo' | 'yawn' | 'cheer' | 'select';

export interface SampleDef {
  url: string;
  start?: number;
  end?: number;
  gain?: number;
}

export const SAMPLES: Record<SampleName, SampleDef[]> = {
  giggle: [],
  laugh: [],
  pop: [],
  wheee: [],
  achoo: [],
  yawn: [],
  cheer: [],
  select: [],
};
