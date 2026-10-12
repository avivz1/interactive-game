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
  giggle: [
    { url: '/sounds/giggle-1.mp3', start: 0.00, end: 0.47, gain: 0.82 },
    { url: '/sounds/giggle-3.mp3', start: 0.00, end: 0.93, gain: 0.79 },
    { url: '/sounds/giggle-4.mp3', start: 0.00, end: 1.89, gain: 0.84 },
    { url: '/sounds/giggle-2.mp3', start: 0.00, end: 1.40, gain: 0.85 },
  ],
  laugh: [
    { url: '/sounds/laugh-1.mp3', start: 0.00, end: 1.86, gain: 0.78 },
    { url: '/sounds/laugh-4.mp3', start: 0.00, end: 1.85, gain: 0.71 },
    { url: '/sounds/laugh-3.mp3', start: 0.00, end: 2.00, gain: 0.85 },
    { url: '/sounds/laugh-2.mp3', start: 0.00, end: 2.00, gain: 0.75 },
  ],
  pop: [
    { url: '/sounds/pop-1.mp3', start: 0.00, end: 0.17, gain: 0.71 },
    { url: '/sounds/pop-2.mp3', start: 0.00, end: 0.26, gain: 0.70 },
    { url: '/sounds/pop-4.mp3', start: 0.00, end: 0.25, gain: 0.94 },
  ],
  wheee: [
    { url: '/sounds/wheee-1.mp3', start: 0.00, end: 0.94, gain: 0.75 },
    { url: '/sounds/wheee-3.mp3', start: 0.00, end: 0.96, gain: 0.44 },
    { url: '/sounds/wheee-4.mp3', start: 0.00, end: 0.62, gain: 0.67 },
  ],
  achoo: [
    { url: '/sounds/achoo-2.mp3', start: 0.00, end: 2.77, gain: 0.51 },
    { url: '/sounds/achoo-3.mp3', start: 0.00, end: 2.83, gain: 0.87 },
    { url: '/sounds/achoo-4.mp3', start: 0.00, end: 2.91, gain: 0.82 },
  ],
  yawn: [
    { url: '/sounds/yawn-1.mp3', start: 0.00, end: 0.77, gain: 1.17 },
    { url: '/sounds/yawn-2.mp3', start: 0.00, end: 0.59, gain: 1.15 },
    { url: '/sounds/yawn-3.mp3', start: 0.00, end: 0.67, gain: 1.49 },
  ],
  cheer: [
    { url: '/sounds/cheer-2.mp3', start: 0.00, end: 0.96, gain: 0.50 },
    { url: '/sounds/cheer-3.mp3', start: 0.00, end: 0.84, gain: 0.53 },
    { url: '/sounds/cheer-4.mp3', start: 0.00, end: 1.00, gain: 0.56 },
  ],
  select: [
    { url: '/sounds/select-2.mp3', start: 0.00, end: 0.69, gain: 0.50 },
    { url: '/sounds/select-3.mp3', start: 0.00, end: 0.59, gain: 0.74 },
    { url: '/sounds/select-4.mp3', start: 0.00, end: 0.30, gain: 0.68 },
  ],
};
