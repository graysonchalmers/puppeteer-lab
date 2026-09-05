/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless build smoke test. Runs AFTER `npm run build` and asserts the
 * produced bundle is structurally sane and free of the secret-leak regression
 * the teardown caught (GEMINI_API_KEY was once inlined into the client bundle
 * via vite `define`). No browser, no camera: safe to run in CI.
 *
 * Usage: node scripts/smoke.mjs   (or `npm run smoke`, which builds first)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const MIN_BUNDLE_BYTES = 100 * 1024; // a real build is >1MB; 100KB catches an empty/broken one
const FORBIDDEN = ['PLACEHOLDER_API_KEY', 'GEMINI_API_KEY'];

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
};

// 1. dist/index.html exists and is non-trivial.
const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) fail(`${indexPath} missing - did the build run?`);
const indexHtml = readFileSync(indexPath, 'utf8');
if (indexHtml.length < 200) fail('dist/index.html is suspiciously small');

// 2. A JS bundle exists in dist/assets and is a real, non-empty build.
if (!existsSync(ASSETS)) fail(`${ASSETS} missing`);
const jsAssets = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
if (jsAssets.length === 0) fail('no .js bundle emitted in dist/assets');

let checkedBytes = 0;
for (const file of jsAssets) {
  const full = join(ASSETS, file);
  const bytes = statSync(full).size;
  checkedBytes += bytes;
  const code = readFileSync(full, 'utf8');
  for (const secret of FORBIDDEN) {
    if (code.includes(secret)) fail(`bundle ${file} contains forbidden token "${secret}" (secret leak regression)`);
  }
}
if (checkedBytes < MIN_BUNDLE_BYTES) {
  fail(`total JS bundle is only ${checkedBytes} bytes (< ${MIN_BUNDLE_BYTES}); build looks broken`);
}

// 3. index.html actually references an emitted asset (wired, not orphaned).
const referencesAsset = jsAssets.some((f) => indexHtml.includes(f)) || /assets\/.+\.js/.test(indexHtml);
if (!referencesAsset) fail('dist/index.html does not reference any JS asset');

console.log(`SMOKE OK: index.html + ${jsAssets.length} JS asset(s), ${checkedBytes} bytes, no secret leak.`);
