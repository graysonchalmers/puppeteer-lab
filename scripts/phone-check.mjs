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

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite preview did not start (is dist/ built?)');
}

const inViewport = (b, vp) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;

async function openFace(page, query = '') {
  await page.goto(`${BASE}/${query}`);
  // The hub card title is not clickable; the card's "Open Puppet" button is.
  await page.getByRole('button', { name: /Open Puppet/ }).click();
  // 'attached', not visible: a 0px-tall stage must surface as a FAIL on the height check, not a timeout.
  await page.locator('canvas').first().waitFor({ state: 'attached' });
}

async function phoneLayout(page, label, vp) {
  const stage = await page.locator('canvas').first().boundingBox();
  check(`${label}: stage is tall enough`, stage && stage.height >= 400, `h=${stage?.height}`);

  const rb = await page.getByTitle('Start Recording (With Audio)').boundingBox();
  check(`${label}: Record is on-screen and >= 44px`, inViewport(rb, vp) && rb.width >= 44 && rb.height >= 44, JSON.stringify(rb));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 0, `+${overflow}px`);
  await page.screenshot({ path: `${OUT}/${label}-bar.png` });

  await page.getByRole('button', { name: 'Controls' }).click();
  await page.waitForTimeout(400);
  const drawer = page.getByTestId('controls-drawer');
  const db = await drawer.boundingBox();
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
    const cdp = await page.context().newCDPSession(page);
    const before = await drawer.evaluate((e) => e.scrollTop);
    await cdp.send('Input.synthesizeScrollGesture', { x: vp.width / 2, y: 500, yDistance: -250, gestureSourceType: 'touch', speed: 800 });
    await page.waitForTimeout(400);
    const after = await drawer.evaluate((e) => e.scrollTop);
    check(`${label}: drawer scrolls by touch`, after > before, `${before} -> ${after}`);
  }
  await page.screenshot({ path: `${OUT}/${label}-drawer.png` });
}

async function main() {
  await waitForServer();
  const vp = { width: 390, height: 844 };

  // Chromium phone, fake camera.
  const cr = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const crCtx = await cr.newContext({ ...devices['Pixel 7'], viewport: vp, permissions: ['camera', 'microphone'] });
  const crPage = await crCtx.newPage();
  await openFace(crPage, '?debug');
  await phoneLayout(crPage, 'chromium-phone', vp);
  const playing = await crPage
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 2 && !v.paused;
    }, null, { timeout: 30000 })
    .then(() => true, () => false);
  check('chromium-phone: hidden camera video is playing', playing);
  const readout = await crPage
    .waitForFunction(() => {
      const t = document.querySelector('[data-testid=debug-readout]')?.textContent ?? '';
      const m = /track (\d+) fps/.exec(t);
      return m && Number(m[1]) > 0 ? t : null;
    }, null, { timeout: 30000 })
    .then((h) => h.jsonValue(), () => null);
  check('chromium-phone: ?debug readout shows a live tracker fps', !!readout, readout ?? '');
  await cr.close();

  // WebKit phone, no camera: layout must hold and the failure must be actionable.
  const wk = await webkit.launch();
  const wkCtx = await wk.newContext({ ...devices['iPhone 13'], viewport: vp });
  const wkPage = await wkCtx.newPage();
  await openFace(wkPage);
  await phoneLayout(wkPage, 'webkit-phone', vp);
  const retry = await wkPage.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 30000 }).then(() => true, () => false);
  check('webkit-phone: camera failure shows a Retry button', retry);
  await wk.close();

  // Desktop must look like it did before.
  const dk = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const dkCtx = await dk.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
  const dkPage = await dkCtx.newPage();
  await openFace(dkPage);
  const side = await dkPage.getByTestId('controls-drawer').boundingBox();
  check('desktop: sidebar is 320px wide on the right', side && Math.abs(side.width - 320) <= 2 && Math.abs(side.x - 1120) <= 2, JSON.stringify(side));
  const rec = await dkPage.getByTitle('Start Recording (With Audio)').boundingBox();
  check('desktop: recorder panel is bottom-right of the stage', rec && rec.x > 600 && rec.y > 450, JSON.stringify(rec));
  check('desktop: no phone bar', (await dkPage.getByRole('button', { name: 'Controls' }).count()) === 0);
  check('desktop: header toggles visible', await dkPage.getByText('GAZE RAYS').first().isVisible());
  await dkPage.screenshot({ path: `${OUT}/desktop.png` });
  await dk.close();
}

let crashed = false;
try {
  await main();
} catch (e) {
  crashed = true;
  console.error('phone-check crashed:', e);
} finally {
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(crashed || failed.length ? 1 : 0);
