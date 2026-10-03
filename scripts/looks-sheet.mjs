/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Looks comparison sheet (throwaway design tool): builds nothing itself (npm run looks-sheet builds first). Serves
 * dist/ with vite preview, mocks the shared take, and renders every look through the share viewer
 * (/t/<id>?look=<id>&mesh=<low|full>) at a pinned pose, front and orbited, then composes one contact sheet.
 *   node scripts/looks-sheet.mjs --baseline   render only the default look to .proof/looks-baseline/ (run BEFORE the
 *                                             looks are wired in, to pin what "unchanged" means)
 *   node scripts/looks-sheet.mjs              render all looks, assert, and write the sheet
 * Asserts: no page errors (including a frame with no face under every look); every render is non-blank; the looks
 * are pairwise distinct; the full mesh differs from the low mesh; the default look matches the baseline.
 * Output: $PROOF_DIR or .proof/<date>-looks/ (gitignored). Port: $LOOKS_SHEET_PORT (default 4178).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureFixture, makeCheck, startPreview, openViewer, seek } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.LOOKS_SHEET_PORT ?? 4178);
const BASELINE = process.argv.includes('--baseline');
const BASE_DIR = '.proof/looks-baseline';
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-looks`;
const LOOKS = BASELINE ? ['default'] : ['default', 'clay', 'faceted', 'toon', 'neon'];
const MESHES = ['low', 'full'];
const T_POSE = 496; // face and both hands present, a multiple of the scrubber step
const T_NOFACE = 2208; // inside the fixture's 800 ms face dropout (1800..2550 ms)
const SEL = '[data-testid=take-canvas]';
const dir = BASELINE ? BASE_DIR : OUT;
mkdirSync(dir, { recursive: true });
const { check, fail, finish } = makeCheck();
const take = ensureFixture();

const dataUrl = (page) => page.evaluate((s) => document.querySelector(s).toDataURL('image/png'), SEL);
const save = (file, url) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
const asUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

async function drag(page, fracX) {
  const box = await page.locator(SEL).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * fracX, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

/** Fraction of pixels whose largest channel difference exceeds 24, between two PNG data URLs; also the share of
 * pixels unlike the top-left background pixel when b is null (a blank render scores ~0). */
async function pixelDiff(page, a, b) {
  return page.evaluate(async ([ua, ub]) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const px = async (u) => { const i = await load(u); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const A = await px(ua);
    const B = ub ? await px(ub) : null;
    if (B && A.length !== B.length) return 1;
    let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      const r = B ? B[i] : A[0], g = B ? B[i + 1] : A[1], bl = B ? B[i + 2] : A[2];
      if (Math.max(Math.abs(A[i] - r), Math.abs(A[i + 1] - g), Math.abs(A[i + 2] - bl)) > 24) n++;
    }
    return n / (A.length / 4);
  }, [a, b]);
}

let server, chrome, code = 1;
try {
  server = await startPreview(PORT);
  chrome = await chromium.launch();
  const ctx = await chrome.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const shots = {}; // `${look}-${mesh}-${view}` -> data URL

  for (const look of LOOKS) {
    for (const mesh of MESHES) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${look}/${mesh}: ${e}`));
      await openViewer(page, server.base, take, `?look=${look}&mesh=${mesh}`);
      await seek(page, T_POSE);
      shots[`${look}-${mesh}-front`] = await dataUrl(page);
      await seek(page, T_NOFACE); // a face-less frame must not throw under any look
      await seek(page, T_POSE);
      await page.getByTestId('orbit-toggle').click();
      await page.waitForTimeout(500);
      await drag(page, 0.3);
      shots[`${look}-${mesh}-orbit`] = await dataUrl(page);
      await page.close();
    }
  }
  check('no page errors in any look/mesh', errors.length === 0, errors.slice(0, 3).join(' | '));

  const probe = await ctx.newPage();
  await probe.goto('about:blank');
  for (const [key, url] of Object.entries(shots)) {
    const [look, mesh, view] = key.split('-');
    save(BASELINE ? path.join(BASE_DIR, `${mesh}-${view}.png`) : path.join(OUT, `${key}.png`), url);
    const live = await pixelDiff(probe, url, null);
    check(`${key} is not blank`, live > 0.02, `${(live * 100).toFixed(1)}% of pixels unlike the background`);
  }

  if (!BASELINE) {
    const front = (l) => shots[`${l}-low-front`];
    for (let i = 0; i < LOOKS.length; i++) {
      for (let j = i + 1; j < LOOKS.length; j++) {
        const d = await pixelDiff(probe, front(LOOKS[i]), front(LOOKS[j]));
        check(`${LOOKS[i]} and ${LOOKS[j]} differ`, d > 0.02, `${(d * 100).toFixed(1)}%`);
      }
    }
    const dm = await pixelDiff(probe, shots['default-low-front'], shots['default-full-front']);
    // 0.001 (0.1%) is calibrated to the pinned pose (T_POSE 496): measured 0.24%, about 2x headroom.
    check('default: the full mesh differs from the low mesh', dm > 0.001,`${(dm * 100).toFixed(2)}%`);

    for (const mesh of MESHES) {
      for (const view of ['front', 'orbit']) {
        const f = path.join(BASE_DIR, `${mesh}-${view}.png`);
        if (!existsSync(f)) { check(`default matches baseline (${mesh} ${view})`, false, `no baseline at ${f}; run --baseline on the pre-looks build`); continue; }
        const d = await pixelDiff(probe, shots[`default-${mesh}-${view}`], asUrl(f));
        check(`default matches the pre-looks baseline (${mesh} ${view})`, d < 0.002, `${(d * 100).toFixed(3)}% differ`);
      }
    }

    // Contact sheet: one row per look; columns low/full x front/orbit, plus a phone-width thumbnail of low-front.
    const cell = (l, m, v, w) => `<img width="${w}" src="${shots[`${l}-${m}-${v}`]}">`;
    const rows = LOOKS.map((l) => `<tr><th>${l}</th><td>${cell(l, 'low', 'front', 300)}</td><td>${cell(l, 'low', 'orbit', 300)}</td><td>${cell(l, 'full', 'front', 300)}</td><td>${cell(l, 'full', 'orbit', 300)}</td><td>${cell(l, 'low', 'front', 130)}</td></tr>`).join('');
    const sheet = await ctx.newPage();
    await sheet.setContent(`<body style="margin:0;background:#222;color:#ddd;font:14px sans-serif"><table cellspacing="6"><tr><th></th><th>low front</th><th>low orbit</th><th>full front</th><th>full orbit</th><th>phone size</th></tr>${rows}</table></body>`);
    await sheet.setViewportSize({ width: 1700, height: 400 });
    await sheet.screenshot({ path: path.join(OUT, 'sheet.png'), fullPage: true });
    console.log(`contact sheet: ${path.join(OUT, 'sheet.png')}`);
  }
} catch (e) {
  fail(e);
} finally {
  code = finish();
  await chrome?.close().catch(() => {});
  server?.stop();
}
process.exit(code);
