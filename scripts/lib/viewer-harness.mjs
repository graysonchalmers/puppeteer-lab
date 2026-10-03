/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pieces of the viewer browser gates (cleanup-check, orbit-check): serve dist/ with vite preview on a port
 * this script owns, mock GET /api/takes/<id> with a parsed recording, drive the scrubber, and compare stage frames.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const FIXTURE = 'tools/fixtures/synthetic-face-hands-take.json';
export const TAKE_ID = 'a'.repeat(22);

export function ensureFixture() {
  if (!existsSync(FIXTURE)) spawnSync(process.execPath, ['tools/make-synthetic-take.mjs', '--hands'], { stdio: 'inherit' });
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

export function makeCheck() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  };
  /** Call from the script's catch: a thrown assertion/timeout must never read as a green run. */
  const fail = (e) => check('script completed without throwing', false, e instanceof Error ? (e.stack ?? e.message) : String(e));
  /** Zero checks is a failure too (the script died before asserting anything). */
  const finish = () => {
    const bad = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - bad}/${results.length} checks passed`);
    return results.length > 0 && bad === 0 ? 0 : 1;
  };
  return { check, fail, finish };
}

/**
 * Never test a server we did not start: refuse a busy port, fail fast if our child exits. Serves dist/ unless `outDir`
 * names another build directory.
 */
export async function startPreview(port, outDir) {
  const base = `http://localhost:${port}`;
  const dir = outDir ?? 'dist';
  if (await fetch(base).then(() => true, () => false)) {
    throw new Error(`port ${port} is already serving something; refusing to test a server this script did not start`);
  }
  const args = ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'];
  if (outDir) args.push('--outDir', outDir);
  const child = spawn(process.execPath, args, { stdio: 'ignore' });
  // On Windows the child is not reaped when this process dies, so kill it on any exit path.
  const stop = () => child.kill();
  process.on('exit', stop);
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = `vite preview exited (code ${code}, signal ${signal})`;
  });
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error(`${exited}; is ${dir}/ built?`);
    try {
      if ((await fetch(base)).ok) return { base, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  stop();
  throw new Error(`vite preview did not start (is ${dir}/ built?)`);
}

/** Serve `take` (a parsed recording) as the shared take, then open the viewer paused at t=0. */
export async function openViewer(page, base, take, query = '') {
  await page.route('**/api/takes/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'X-Expires-At': new Date(Date.now() + 20 * 3600e3).toISOString() },
      body: JSON.stringify(take),
    }),
  );
  await page.goto(`${base}/t/${TAKE_ID}${query}`);
  await page.getByTestId('take-canvas').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
}

/** The scrubber is a range input with step 16; set it the way React sees a user change, then let the stage settle. */
export async function seek(page, ms) {
  await page.evaluate((v) => {
    const el = document.querySelector('input[aria-label=Scrub]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, ms);
  await page.waitForTimeout(450);
}

/** Copy the stage canvas pixels into window.__snaps[name]. The viewer's canvas by default; Face Puppet's is stage-canvas. */
export async function snap(page, name, selector = '[data-testid=take-canvas]') {
  await page.evaluate(([n, sel]) => {
    const c = document.querySelector(sel);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    (window.__snaps ??= {})[n] = new Uint8ClampedArray(d);
  }, [name, selector]);
}

/** Fraction of pixels whose largest channel difference exceeds 24. */
export async function diff(page, a, b) {
  return page.evaluate(([x, y]) => {
    const A = window.__snaps[x];
    const B = window.__snaps[y];
    if (A.length !== B.length) return 1;
    let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 24) n++;
    }
    return n / (A.length / 4);
  }, [a, b]);
}
