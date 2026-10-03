/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cleanup gate: builds nothing itself (npm run cleanup-check builds first). Serves dist/ with vite preview, mocks a
 * shared take that has a short face dropout (frames 20..23 of the 20 fps fixture = 200 ms) plus the fixture's own
 * 800 ms dropout, and asserts in Chromium that the Clean up switch is off by default, fills only the short gap,
 * reports it, and is remembered across a reload. Screenshots go to $PROOF_DIR or .proof/<date>-take-cleanup/.
 * The port is $CLEANUP_CHECK_PORT (default 4175); a busy port is refused. Run it LAST (after the unit gates).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureFixture, makeCheck, startPreview, openViewer, seek, snap, diff } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.CLEANUP_CHECK_PORT ?? 4175);
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-take-cleanup`;
mkdirSync(OUT, { recursive: true });
const { check, finish } = makeCheck();

const take = ensureFixture();
for (let f = 20; f <= 23; f++) {
  delete take.frames[f].faceLandmarks;
  delete take.frames[f].blendshapes;
}

const server = await startPreview(PORT);
const browser = await chromium.launch();
let code = 1;
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openViewer(page, server.base, take);

  check('cleanup is off by default', (await page.getByTestId('cleanup-toggle').getAttribute('aria-checked')) === 'false');

  await seek(page, 1056); // inside the 200 ms gap (1000..1150 ms)
  await snap(page, 'raw-short');
  await page.screenshot({ path: path.join(OUT, '01-raw-inside-short-gap.png') });

  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(900);
  const badge = await page.getByTestId('cleanup-badge').innerText();
  check('the badge reports the filled gap', /filled 1 gap/i.test(badge), badge);
  check('...and the gap that is too long to fill', /1 too long to fill/i.test(badge), badge);

  await seek(page, 1056);
  await snap(page, 'clean-short');
  await page.screenshot({ path: path.join(OUT, '02-cleaned-inside-short-gap.png') });
  const dShort = await diff(page, 'raw-short', 'clean-short');
  check('inside the short gap the cleaned puppet has a face the raw one lacks', dShort > 0.01, `${(dShort * 100).toFixed(2)}% of pixels differ`);

  await seek(page, 2208); // inside the fixture's own 800 ms dropout (1800..2550 ms)
  await snap(page, 'clean-long');
  await page.screenshot({ path: path.join(OUT, '03-cleaned-inside-long-gap.png') });
  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(500);
  await seek(page, 2208);
  await snap(page, 'raw-long');
  const dLong = await diff(page, 'raw-long', 'clean-long');
  check('inside the long gap neither version invents a face', dLong < dShort / 3, `${(dLong * 100).toFixed(2)}% vs ${(dShort * 100).toFixed(2)}%`);

  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByTestId('take-canvas').waitFor({ timeout: 15000 });
  check('the choice is remembered across a reload', (await page.getByTestId('cleanup-toggle').getAttribute('aria-checked')) === 'true');
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error(e);
} finally {
  code = finish();
  await browser.close();
  server.stop();
}
process.exit(code);
