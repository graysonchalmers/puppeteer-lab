/**
 * Phone gate: builds nothing itself (npm run phone-check builds first), serves
 * dist/ with vite preview, and asserts Face Puppet is reachable and tappable at
 * 390x844 in Chromium (touch, fake camera) and WebKit (no camera), and that the
 * desktop layout at 1440x900 is intact. Needs network: Tailwind loads from a CDN.
 * Screenshots go to .proof/<date>-phone-port/ (gitignored).
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = `.proof/${new Date().toISOString().slice(0, 10)}-phone-port`;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

// Never test a server we did not start: refuse a busy port up front, and fail fast if our child exits.
let server = null;
let serverExit = null;
async function startServer() {
  const busy = await fetch(BASE).then(() => true, () => false);
  if (busy) throw new Error(`port ${PORT} is already serving something; refusing to test a server this script did not start`);
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  server.on('exit', (code, signal) => {
    serverExit = `vite preview exited (code ${code}, signal ${signal})`;
  });
  for (let i = 0; i < 60; i++) {
    if (serverExit) throw new Error(`${serverExit}; is dist/ built and port ${PORT} free?`);
    try {
      if ((await fetch(BASE)).ok && !serverExit) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite preview did not start (is dist/ built?)');
}

// A section (browser session) that throws records one FAIL and lets the next section run.
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name}: section completed`, false, String(e.message ?? e).split('\n')[0]);
  }
}

const bbox = (locator) => locator.boundingBox({ timeout: 10000 }).catch(() => null);

const inViewport = (b, vp) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;

async function openFace(page, query = '') {
  await page.goto(`${BASE}/${query}`);
  // The hub card title is not clickable; the card's "Open Puppet" button is.
  await page.getByRole('button', { name: /Open Puppet/ }).click();
  // 'attached', not visible: a 0px-tall stage must surface as a FAIL on the height check, not a timeout.
  await page.locator('canvas').first().waitFor({ state: 'attached' });
}

async function phoneLayout(page, label, vp) {
  const stage = await bbox(page.locator('canvas').first());
  check(`${label}: stage is tall enough`, stage && stage.height >= 400, `h=${stage?.height}`);

  const rb = await bbox(page.getByTitle('Start Recording (With Audio)'));
  check(`${label}: Record is on-screen and >= 44px`, inViewport(rb, vp) && rb.width >= 44 && rb.height >= 44, JSON.stringify(rb));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 0, `+${overflow}px`);
  await page.screenshot({ path: `${OUT}/${label}-bar.png` });

  try {
    await page.getByRole('button', { name: 'Controls', exact: true }).click({ timeout: 5000 });
  } catch (e) {
    check(`${label}: Controls button opens the drawer`, false, String(e.message).split('\n')[0]);
    await page.screenshot({ path: `${OUT}/${label}-no-controls.png` });
    return;
  }
  await page.waitForTimeout(400);
  const drawer = page.getByTestId('controls-drawer');
  const db = await bbox(drawer);
  check(`${label}: Controls drawer opens on-screen`, inViewport(db, vp), JSON.stringify(db));

  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, input[type=range]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (Math.min(r.width, r.height) < 44) {
        const name = (el.getAttribute('aria-label') || el.title || el.textContent || el.tagName).trim().slice(0, 24);
        out.push(`${name} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
  check(`${label}: touch targets >= 44px`, small.length === 0, small.join(' | '));

  if (page.context().browser().browserType().name() === 'chromium') {
    // index.html sets touch-action:none on html/body/#root; the drawer must still scroll by finger.
    try {
      const cdp = await page.context().newCDPSession(page);
      const before = await drawer.evaluate((e) => e.scrollTop, undefined, { timeout: 3000 });
      // Real touch events: synthesizeScrollGesture(touch) does not scroll in headless Chromium, even on a plain page.
      const tx = db ? db.x + db.width / 2 : vp.width / 2;
      const y0 = db ? db.y + db.height - 60 : 700;
      const y1 = db ? db.y + 60 : 450;
      const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y }] });
      await touch('touchStart', y0);
      for (let y = y0; y >= y1; y -= 10) {
        await touch('touchMove', y);
        await page.waitForTimeout(16);
      }
      await touch('touchEnd', y1);
      await page.waitForTimeout(400);
      const after = await drawer.evaluate((e) => e.scrollTop, undefined, { timeout: 3000 });
      check(`${label}: drawer scrolls by touch`, after > before, `${before} -> ${after}`);
    } catch (e) {
      check(`${label}: drawer scrolls by touch`, false, String(e.message).split('\n')[0]);
    }
  }
  await page.screenshot({ path: `${OUT}/${label}-drawer.png` });
}

const CAM_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

async function chromiumPhone(vp) {
  const cr = await chromium.launch({ args: CAM_ARGS });
  try {
    const ctx = await cr.newContext({ ...devices['Pixel 7'], viewport: vp, permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    await openFace(page, '?debug');
    await phoneLayout(page, 'chromium-phone', vp);
    const playing = await page
      .waitForFunction(() => {
        const v = document.querySelector('video');
        return !!v && v.readyState >= 2 && !v.paused;
      }, null, { timeout: 30000 })
      .then(() => true, () => false);
    check('chromium-phone: hidden camera video is playing', playing);
    const readout = await page
      .waitForFunction(() => {
        const t = document.querySelector('[data-testid=debug-readout]')?.textContent ?? '';
        const m = /track (\d+) fps/.exec(t);
        return m && Number(m[1]) > 0 ? t : null;
      }, null, { timeout: 30000 })
      .then((h) => h.jsonValue(), () => null);
    check('chromium-phone: ?debug readout shows a live tracker fps', !!readout, readout ?? '');
  } finally {
    await cr.close();
  }
}

// WebKit phone, no camera: layout must hold and the failure must be actionable.
async function webkitPhone(vp) {
  const wk = await webkit.launch();
  try {
    const ctx = await wk.newContext({ ...devices['iPhone 13'], viewport: vp });
    const page = await ctx.newPage();
    await openFace(page);
    await phoneLayout(page, 'webkit-phone', vp);
    const retry = await page.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 30000 }).then(() => true, () => false);
    check('webkit-phone: camera failure shows a Retry button', retry);
  } finally {
    await wk.close();
  }
}

// Desktop must look like it did before.
async function desktop() {
  const dk = await chromium.launch({ args: CAM_ARGS });
  try {
    const ctx = await dk.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    await openFace(page);
    const side = await bbox(page.getByTestId('controls-drawer'));
    check('desktop: sidebar is 320px wide on the right', side && Math.abs(side.width - 320) <= 2 && Math.abs(side.x - 1120) <= 2, JSON.stringify(side));
    const rec = await bbox(page.getByTitle('Start Recording (With Audio)'));
    check('desktop: recorder panel is bottom-right of the stage', rec && rec.x > 600 && rec.y > 450, JSON.stringify(rec));
    check('desktop: no phone bar', (await page.getByRole('button', { name: 'Controls', exact: true }).count()) === 0);
    check('desktop: header toggles visible', await page.getByText('GAZE RAYS').first().isVisible());
    await page.screenshot({ path: `${OUT}/desktop.png` });
  } finally {
    await dk.close();
  }
}

let crashed = false;
try {
  await startServer();
  const vp = { width: 390, height: 844 };
  await section('chromium-phone', () => chromiumPhone(vp));
  await section('webkit-phone', () => webkitPhone(vp));
  await section('desktop', desktop);
} catch (e) {
  crashed = true;
  console.error('phone-check crashed:', e);
} finally {
  server?.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(crashed || failed.length ? 1 : 0);
