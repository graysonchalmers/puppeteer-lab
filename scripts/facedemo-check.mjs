/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet playback gate: builds nothing itself (npm run facedemo-check builds first). cleanup-check and
 * orbit-check only drive the /t/<id> viewer; this drives the live app's own playback path (FaceDemo.tsx: the cleaned
 * frames, the per-frame hand depth, orbit gated on playback, the view reset on stop). Serves dist/ with vite preview,
 * imports the synthetic take (with its frames 20..23 face dropout = a 200 ms gap) through the real file input in
 * Chromium with a fake camera, and asserts that:
 *   - Clean up and Orbit are off by default and disabled until a take exists;
 *   - inside the gap the cleaned stage has a face the raw one lacks, and the badge reports the filled gap;
 *   - Orbit during playback: a drag moves the stage, Reset view restores it, Stop playback drops the view, and
 *     switching Orbit off returns the default view;
 *   - there are no page errors.
 * Screenshots go to $PROOF_DIR or .proof/<date>-facedemo/ (gitignored). The port is $FACEDEMO_CHECK_PORT (default
 * 4177); a busy port is refused. Run it LAST (after the unit gates).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureFixture, makeCheck, startPreview, seek, snap, diff } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.FACEDEMO_CHECK_PORT ?? 4177);
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-facedemo`;
mkdirSync(OUT, { recursive: true });
const { check, fail, finish } = makeCheck();

const STAGE = '[data-testid=stage-canvas]';
const T_GAP = 1056; // inside the 200 ms face dropout (1000..1150 ms), a multiple of the scrubber step
const T_LONG = 2208; // inside the fixture's own 800 ms dropout (1800..2550 ms)

// The same take cleanup-check uses: a short face dropout at frames 20..23 on top of the fixture's own long one.
const take = ensureFixture();
for (let f = 20; f <= 23; f++) {
  delete take.frames[f].faceLandmarks;
  delete take.frames[f].blendshapes;
}
const FIXTURE_FILE = path.join(OUT, '_fixture-short-dropout.json');
writeFileSync(FIXTURE_FILE, JSON.stringify(take));

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const attr = (page, id, name) => page.getByTestId(id).getAttribute(name);

/** Face Puppet's scrubber is a range input titled Scrub. Set it the way React sees a user change. React drops an input
 * event whose value equals the one it last saw (the DOM value survives a Stop/Play), so go via 0 first: setting the
 * value it already has would silently seek nowhere. */
async function setScrub(page, ms) {
  await page.evaluate((v) => {
    const el = document.querySelector('input[title=Scrub]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const x of [0, v]) {
      set.call(el, String(x));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, ms);
}

/** Pause deterministically: a pointerdown on the scrubber pauses playback (and enters it from stopped); no pointerup,
 * so it stays paused on the scrubbed frame. Then park on `ms` and let the stage settle. */
async function pauseAt(page, ms) {
  await page.evaluate(() => {
    document.querySelector('input[title=Scrub]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  });
  await setScrub(page, ms);
  await page.waitForTimeout(450);
}

async function drag(page, fracX, fracY, steps = 12) {
  const box = await page.locator(STAGE).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * fracX, y + box.height * fracY, { steps });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

let server;
let browser;
let code = 1;
try {
  server = await startPreview(PORT);
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(server.base);
  await page.getByTestId('cleanup-toggle').waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);

  // 1. Defaults, before there is a take.
  check('Clean up is off by default', (await attr(page, 'cleanup-toggle', 'aria-checked')) === 'false');
  check('Orbit is off by default', (await attr(page, 'orbit-toggle', 'aria-checked')) === 'false');
  check('both switches are disabled until a take exists', (await page.getByTestId('cleanup-toggle').isDisabled()) && (await page.getByTestId('orbit-toggle').isDisabled()));
  await page.screenshot({ path: path.join(OUT, '00-before-import.png') });

  // 2. Import the take through the real file input, then play it and park inside the short dropout.
  await page.setInputFiles('input[type=file]', FIXTURE_FILE);
  await page.waitForFunction(() => !document.querySelector('[data-testid=cleanup-toggle]').disabled, null, { timeout: 15000 });
  check('both switches enable once a take is loaded', !(await page.getByTestId('cleanup-toggle').isDisabled()) && !(await page.getByTestId('orbit-toggle').isDisabled()));
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(300);
  check('Play enters playback (the Stop playback button appears)', await page.getByTitle('Stop playback, back to live').isVisible());
  await pauseAt(page, T_GAP);
  check('the scrubber parks on the gap', Number(await page.locator('input[title=Scrub]').inputValue()) === T_GAP);

  // 3. Clean up on the live app's playback path.
  await snap(page, 'raw-a', STAGE);
  await page.waitForTimeout(300);
  await snap(page, 'raw-b', STAGE);
  const noise = await diff(page, 'raw-a', 'raw-b');
  await page.screenshot({ path: path.join(OUT, '01-raw-inside-short-gap.png') });

  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(900);
  check('the switch reads on', (await attr(page, 'cleanup-toggle', 'aria-checked')) === 'true');
  const badge = await page.getByTestId('cleanup-badge').innerText();
  check('the badge reports the filled gap', /filled 1 gap/i.test(badge), badge);
  check('...and the gap that is too long to fill', /1 too long to fill/i.test(badge), badge);
  await setScrub(page, T_GAP);
  await page.waitForTimeout(450);
  await snap(page, 'clean-short', STAGE);
  await page.screenshot({ path: path.join(OUT, '02-cleaned-inside-short-gap.png') });
  const dShort = await diff(page, 'raw-a', 'clean-short');

  await setScrub(page, T_LONG);
  await page.waitForTimeout(450);
  await snap(page, 'clean-long', STAGE);
  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(500);
  await setScrub(page, T_LONG);
  await page.waitForTimeout(450);
  await snap(page, 'raw-long', STAGE);
  const dLong = await diff(page, 'raw-long', 'clean-long');
  const msg = `${pct(dShort)} short vs ${pct(dLong)} long, noise ${pct(noise)}`;
  // Calibration: see the measured values this prints. A restored face moves a large share of the stage; with no face in
  // either version only the hand smoothing differs, and an idle paused stage differs from itself by the noise value.
  check('inside the short gap the cleaned puppet has a face the raw one lacks', dShort > Math.max(0.03, 3 * noise) && dShort > 3 * dLong, msg);
  check('inside the long gap neither version invents a face', dLong < 0.03 && dLong < dShort / 3, msg);

  // 4. Orbit during playback, with Clean up on (the cleaned frames drive the per-frame hand depth).
  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(900);
  await setScrub(page, T_GAP);
  await page.waitForTimeout(450);
  await snap(page, 'front', STAGE);
  await page.getByTestId('orbit-toggle').click();
  await page.waitForTimeout(600);
  check('the Orbit switch reads on', (await attr(page, 'orbit-toggle', 'aria-checked')) === 'true');
  await snap(page, 'orbit-rest', STAGE);
  await page.screenshot({ path: path.join(OUT, '03-orbit-rest.png') });
  const rest = await diff(page, 'front', 'orbit-rest');
  check('orbit at rest looks like the front view', rest < 0.08, pct(rest));

  await drag(page, 0.3, 0);
  await snap(page, 'orbited', STAGE);
  await page.screenshot({ path: path.join(OUT, '04-orbit-yaw.png') });
  const moved = await diff(page, 'orbit-rest', 'orbited');
  check('a drag on the stage orbits the camera', moved > Math.max(0.03, rest * 3), `${pct(moved)} vs rest ${pct(rest)}`);

  await page.getByTestId('orbit-reset').click();
  await page.waitForTimeout(450);
  await snap(page, 'reset', STAGE);
  const afterReset = await diff(page, 'orbit-rest', 'reset');
  check('Reset view restores the rest pose', afterReset < 0.005, pct(afterReset));

  // Stop playback drops the orbited view: orbit again, stop, play again and park on the same frame.
  await drag(page, 0.3, 0);
  await snap(page, 'orbited-again', STAGE);
  check('...and the stage is orbited again before Stop', (await diff(page, 'orbit-rest', 'orbited-again')) > 0.03);

  // The gaze-ray and mocap-dot overlays are drawn with the front-view mapping, so they must stay off an orbited stage.
  const overlays = ['GAZE RAYS', 'MOCAP DOTS'];
  for (const name of overlays) await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(500);
  await snap(page, 'orbited-overlays', STAGE);
  await page.screenshot({ path: path.join(OUT, '04b-orbit-overlays-on.png') });
  const overlayOrbit = await diff(page, 'orbited-again', 'orbited-overlays');
  // Calibration: the overlays are a few dozen dots and short rays, ~0.07% of the stage when drawn (see the front-view
  // control below), so this must be (near) zero, not the 0.5% used for whole-puppet moves.
  check('the debug overlays are skipped while orbiting', overlayOrbit < 0.0001, pct(overlayOrbit));
  for (const name of overlays) await page.getByRole('button', { name, exact: true }).click();

  await page.getByTitle('Stop playback, back to live').click();
  await page.waitForTimeout(500);
  // Clean up is only computed while a take plays: after Stop (switch still ON) there is no report, so no badge text.
  check('after Stop the switch is still on but the cleanup is not computed (empty badge)',
    (await attr(page, 'cleanup-toggle', 'aria-checked')) === 'true' && (await page.getByTestId('cleanup-badge').innerText()).trim() === '');
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(600);
  const replayBadge = await page.getByTestId('cleanup-badge').innerText();
  check('Play computes it again and the badge reports the gap', /filled 1 gap/i.test(replayBadge) && /1 too long to fill/i.test(replayBadge), replayBadge);
  await pauseAt(page, T_GAP);
  await snap(page, 'after-stop', STAGE);
  await page.screenshot({ path: path.join(OUT, '05-after-stop-replay.png') });
  const afterStop = await diff(page, 'orbit-rest', 'after-stop');
  check('Stop playback resets the orbit view (Orbit stays on)', (await attr(page, 'orbit-toggle', 'aria-checked')) === 'true' && afterStop < 0.005, pct(afterStop));

  await page.getByTestId('orbit-toggle').click();
  await page.waitForTimeout(600);
  await snap(page, 'off', STAGE);
  await page.screenshot({ path: path.join(OUT, '06-orbit-off.png') });
  const off = await diff(page, 'front', 'off');
  check('switching Orbit off returns the default view unchanged', off < 0.005, pct(off));

  // Positive control for the overlay check above: in the front view the same overlays do draw.
  for (const name of overlays) await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(500);
  await snap(page, 'front-overlays', STAGE);
  await page.screenshot({ path: path.join(OUT, '07-front-overlays-on.png') });
  const overlayFront = await diff(page, 'off', 'front-overlays');
  // Calibration: the overlays are a few dozen one-pixel-radius dots and short rays, so they move only ~0.07% of the stage
  // (measured 0.07%); anything above 0.03% proves they were drawn, and the orbited check above must stay under 0.01%.
  check('...and are drawn in the front view (control)', overlayFront > 0.0003, pct(overlayFront));

  // 5. The remembered pref is ON now (the switch was left on above and persisted). Reload, import a take: nothing
  // plays, so the cleanup must not run (no badge text); Play computes it; Stop drops it again.
  await page.reload();
  await page.getByTestId('cleanup-toggle').waitFor({ timeout: 20000 });
  await page.setInputFiles('input[type=file]', FIXTURE_FILE);
  await page.waitForFunction(() => !document.querySelector('[data-testid=cleanup-toggle]').disabled, null, { timeout: 15000 });
  check('the remembered pref is ON after a reload', (await attr(page, 'cleanup-toggle', 'aria-checked')) === 'true');
  check('importing a take with the pref ON does not run the cleanup (empty badge until Play)', (await page.getByTestId('cleanup-badge').innerText()).trim() === '');
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(600);
  const rememberedBadge = await page.getByTestId('cleanup-badge').innerText();
  check('Play with the remembered pref reports the gap', /filled 1 gap/i.test(rememberedBadge), rememberedBadge);
  await page.getByTitle('Stop playback, back to live').click();
  await page.waitForTimeout(500);
  check('Stop drops the report again (no recompute while stopped)', (await page.getByTestId('cleanup-badge').innerText()).trim() === '');

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  fail(e);
} finally {
  code = finish();
  await browser?.close().catch(() => {});
  server?.stop();
}
process.exit(code);
