// Copies the MediaPipe runtime from node_modules into public/ and downloads the
// pose model (verified by SHA-256) so everything is served from our own origin.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules/@mediapipe/tasks-vision');
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const outDir = join(root, 'public/mediapipe', version);

const MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  file: join(root, 'public/mediapipe/models/pose_landmarker_lite_f16_v1.task'),
  sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
};

const RUNTIME_FILES = [
  'vision_bundle.mjs',
  'wasm/vision_wasm_internal.js',
  'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_nosimd_internal.js',
  'wasm/vision_wasm_nosimd_internal.wasm',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

for (const rel of RUNTIME_FILES) {
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(pkgDir, rel), dest);
}

if (existsSync(MODEL.file) && sha256(readFileSync(MODEL.file)) === MODEL.sha256) {
  console.log(`mediapipe ${version}: runtime copied, model cached`);
} else {
  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== MODEL.sha256) throw new Error(`model checksum mismatch: ${got}`);
  mkdirSync(dirname(MODEL.file), { recursive: true });
  writeFileSync(MODEL.file, buf);
  console.log(`mediapipe ${version}: runtime copied, model downloaded`);
}
