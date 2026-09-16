/**
 * Vendors MediaPipe runtime assets into public/ so the built app runs offline.
 * - WASM: copied from node_modules (always matches the pinned package version). Gitignored.
 * - Models: downloaded once into public/mediapipe/models (committed).
 * Usage: node scripts/vendor-assets.mjs [--dry-run]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const WASM_SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
const WASM_DST = 'public/mediapipe/wasm';
const MODEL_DST = 'public/mediapipe/models';
const MODELS = {
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

if (!existsSync(WASM_SRC)) { console.error(`[vendor] ${WASM_SRC} missing; run npm install`); process.exit(1); }
mkdirSync(WASM_DST, { recursive: true });
mkdirSync(MODEL_DST, { recursive: true });

for (const f of readdirSync(WASM_SRC)) {
  const src = join(WASM_SRC, f), dst = join(WASM_DST, f);
  if (DRY) { console.log(`[vendor] would copy ${src} -> ${dst}`); continue; }
  cpSync(src, dst);
}
if (!DRY) console.log(`[vendor] wasm: ${readdirSync(WASM_DST).length} files in ${WASM_DST}`);

for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(MODEL_DST, name);
  if (existsSync(dst) && statSync(dst).size > 100_000) { console.log(`[vendor] model present: ${name} (${statSync(dst).size} B)`); continue; }
  if (DRY) { console.log(`[vendor] would download ${url}`); continue; }
  console.log(`[vendor] downloading ${name} ...`);
  const res = await fetch(url);
  if (!res.ok) { console.error(`[vendor] download failed ${res.status} ${url}`); process.exit(1); }
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`[vendor] model: ${name} (${statSync(dst).size} B)`);
}
