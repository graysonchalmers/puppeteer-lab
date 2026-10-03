/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orbit gate: builds nothing itself (npm run orbit-check builds first). Serves dist/ with vite preview, mocks the
 * shared take, and asserts in Chromium that: orbit is off by default; switching it on at rest looks like the front
 * view (capture-pose camera); a drag moves the camera; Reset restores the rest pose; the wheel zooms; switching it
 * off returns the default view pixel-for-pixel; touch-action is only 'none' while orbit is on. Then records a short
 * video of a drag-orbit during playback, and (if WebGL exists there) repeats a drag in WebKit on the iPhone
 * profile. Output goes to $PROOF_DIR or .proof/<date>-orbit/. The port is $ORBIT_CHECK_PORT (default 4176); a busy
 * port is refused. Run it LAST (after the unit gates).
 */
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { ensureFixture, makeCheck, startPreview, openViewer, seek, snap, diff } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.ORBIT_CHECK_PORT ?? 4176);
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-orbit`;
mkdirSync(OUT, { recursive: true });
const { check, fail, finish } = makeCheck();
const take = ensureFixture();
const T_POSE = 496; // frame ~10: face and both hands present, a multiple of the scrubber step

async function drag(page, fracX, fracY, steps = 12) {
  const box = await page.getByTestId('take-canvas').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * fracX, y + box.height * fracY, { steps });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

let server;
let chrome;
let wk;
let code = 1;
try {
  server = await startPreview(PORT);
  chrome = await chromium.launch();

  // 1. Desktop Chromium, deterministic stills.
  const page = await (await chrome.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openViewer(page, server.base, take);
  await seek(page, T_POSE);
  await snap(page, 'front');
  await page.screenshot({ path: path.join(OUT, '01-front-ortho.png') });

  check('orbit is off by default', (await page.getByTestId('orbit-toggle').getAttribute('aria-checked')) === 'false');
  const touchOff = await page.getByTestId('take-canvas').evaluate((el) => getComputedStyle(el).touchAction);
  check('touch-action is untouched while orbit is off', touchOff !== 'none', touchOff);

  await page.getByTestId('orbit-toggle').click();
  await page.waitForTimeout(500);
  await snap(page, 'orbit-rest');
  await page.screenshot({ path: path.join(OUT, '02-orbit-rest.png') });
  const rest = await diff(page, 'front', 'orbit-rest');
  check('orbit at rest looks like the front view', rest < 0.08, `${(rest * 100).toFixed(2)}% of pixels differ`);
  const touchOn = await page.getByTestId('take-canvas').evaluate((el) => getComputedStyle(el).touchAction);
  check('touch-action is none while orbit is on', touchOn === 'none', touchOn);

  await drag(page, 0.3, 0);
  await snap(page, 'orbited');
  await page.screenshot({ path: path.join(OUT, '03-orbit-yaw.png') });
  const moved = await diff(page, 'orbit-rest', 'orbited');
  check('a drag orbits the camera', moved > Math.max(0.03, rest * 3), `${(moved * 100).toFixed(2)}% vs rest ${(rest * 100).toFixed(2)}%`);

  await page.getByTestId('orbit-reset').click();
  await page.waitForTimeout(450);
  await snap(page, 'reset');
  const afterReset = await diff(page, 'orbit-rest', 'reset');
  check('Reset view restores the rest pose', afterReset < 0.005, `${(afterReset * 100).toFixed(3)}%`);

  const box = await page.getByTestId('take-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(450);
  await snap(page, 'zoomed');
  const zoomed = await diff(page, 'reset', 'zoomed');
  check('the wheel zooms', zoomed > 0.02, `${(zoomed * 100).toFixed(2)}%`);

  await page.getByTestId('orbit-toggle').click();
  await page.waitForTimeout(500);
  await snap(page, 'off');
  const off = await diff(page, 'front', 'off');
  check('switching orbit off returns the default view unchanged', off < 0.005, `${(off * 100).toFixed(3)}%`);
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await page.context().close();

  // 2. Video: drag-orbit while the take plays.
  const vctx = await chrome.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
  const vpage = await vctx.newPage();
  await openViewer(vpage, server.base, take);
  await vpage.getByTestId('orbit-toggle').click();
  await vpage.getByTestId('take-play').click();
  await drag(vpage, 0.25, -0.05, 20);
  await drag(vpage, -0.5, 0.1, 30);
  await drag(vpage, 0.25, -0.05, 20);
  await vpage.mouse.wheel(0, -300);
  await vpage.waitForTimeout(800);
  await vctx.close();
  const webm = readdirSync(OUT).find((f) => f.endsWith('.webm') && f !== 'orbit-drag.webm');
  if (webm) renameSync(path.join(OUT, webm), path.join(OUT, 'orbit-drag.webm'));
  check('a drag-orbit video was recorded', !!webm);

  // 3. WebKit on the iPhone profile (the phone is iPhone Safari). Only a genuine lack of WebGL there is a SKIP;
  // any other error propagates to the catch below and fails the run.
  wk = await webkit.launch();
  const ctx = await wk.newContext({ ...devices['iPhone 13'] });
  const wpage = await ctx.newPage();
  await openViewer(wpage, server.base, take);
  const hasGL = await wpage.evaluate(() => !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl'));
  if (!hasGL) {
    console.log('SKIP  WebKit iPhone drag: this Playwright WebKit has no WebGL here (Chromium coverage stands; do a real-iPhone run)');
  } else {
    await seek(wpage, T_POSE);
    await wpage.getByTestId('orbit-toggle').click();
    await wpage.waitForTimeout(500);
    await snap(wpage, 'wk-rest');
    await drag(wpage, 0.3, 0);
    await snap(wpage, 'wk-orbited');
    const wkMoved = await diff(wpage, 'wk-rest', 'wk-orbited');
    check('WebKit iPhone: a drag orbits the camera', wkMoved > 0.03, `${(wkMoved * 100).toFixed(2)}%`);
    await wpage.screenshot({ path: path.join(OUT, '04-webkit-iphone-orbit.png') });
  }
} catch (e) {
  fail(e);
} finally {
  code = finish();
  await wk?.close().catch(() => {});
  await chrome?.close().catch(() => {});
  server?.stop();
}
process.exit(code);
