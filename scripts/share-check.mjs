/**
 * Share-link gate: runs the REAL server (temp data dir) and `vite preview` of dist/ with /api proxied to it, then
 * drives real browsers through the whole flow:
 *   - Face Puppet: Save & get link is disabled until a take is loaded, then uploads and shows a /t/<id> link + disclosure;
 *   - the link page plays the take, shows the expiry, links a JSON download; an unknown id shows "can't find";
 *   - the admin endpoint lists the take (and refuses a missing token); scripts/Pull-Takes.ps1 pulls it;
 *   - the viewer fits an iPhone-sized WebKit window (no sideways scroll, Play reachable).
 * Screenshots go to $PROOF_DIR or .proof/<date>-share-links/ (gitignored). Needs network (Tailwind CDN).
 * Ports: $SHARE_CHECK_API_PORT (8791) and $SHARE_CHECK_PORT (4174); a busy port is refused.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const API_PORT = Number(process.env.SHARE_CHECK_API_PORT ?? 8791);
const WEB_PORT = Number(process.env.SHARE_CHECK_PORT ?? 4174);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const TOKEN = 'share-check-token';
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-share-links`;
const FIXTURE = 'tools/fixtures/synthetic-face-hands-take.json';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const children = [];
const dataDir = mkdtempSync(path.join(tmpdir(), 'share-check-'));
const pulledDir = path.join(dataDir, 'pulled');

async function waitFor(url, label) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start`);
}

async function start() {
  for (const url of [`${API}/api/health`, WEB]) {
    if (await fetch(url).then(() => true, () => false)) throw new Error(`${url} is already serving; refusing to test a server this script did not start`);
  }
  if (!existsSync(FIXTURE)) spawnSync(process.execPath, ['tools/make-synthetic-take.mjs', '--hands'], { stdio: 'inherit' });
  children.push(spawn(process.execPath, ['server/index.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, CONTACT_EMAIL: 'removal@example.test', ADMIN_TOKEN: TOKEN },
  }));
  children.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(WEB_PORT), '--strictPort'], {
    stdio: 'ignore',
    env: { ...process.env, MOCAP_API: API },
  }));
  await waitFor(`${API}/api/health`, 'API');
  await waitFor(WEB, 'vite preview');
}

async function main() {
  await start();
  let link = '';

  // 1. Face Puppet on desktop Chromium: load a take, save it, get the link.
  const chrome = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const page = await (await chrome.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(WEB);
    const save = page.getByTestId('save-link-button');
    await save.waitFor({ timeout: 15000 });
    check('Save & get link shows when the API is up', true);
    check('it is disabled before there is a take', await save.isDisabled());
    await page.setInputFiles('input[type=file]', FIXTURE);
    await page.waitForFunction(() => !document.querySelector('[data-testid=save-link-button]').disabled, null, { timeout: 15000 });
    check('it enables once a take is loaded', true);
    check('the disclosure names the contact address', /removal@example\.test/.test(await page.getByTestId('save-link-disclosure').innerText()));
    await save.click();
    const urlBox = page.getByTestId('save-link-url');
    await urlBox.waitFor({ timeout: 15000 });
    link = await urlBox.inputValue();
    check('a /t/<id> link comes back', /\/t\/[A-Za-z0-9_-]{22}$/.test(link), link);
    await page.screenshot({ path: path.join(OUT, '01-face-puppet-save-link.png') });

    // 2. The link page.
    const viewer = await (await chrome.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    viewer.on('pageerror', (e) => errors.push(String(e)));
    await viewer.goto(link);
    await viewer.getByTestId('take-canvas').waitFor({ timeout: 15000 });
    check('the link page shows the stage', true);
    check('it shows when the link expires', /expires in 2[34] hours/.test(await viewer.getByTestId('take-expiry').innerText()));
    const href = await viewer.getByTestId('take-download').getAttribute('href');
    check('it links a JSON download', /\/api\/takes\/[A-Za-z0-9_-]{22}\?download=1$/.test(href ?? ''), href ?? '');
    const dl = await viewer.request.get(new URL(href, WEB).toString());
    check('the download is the recording', (await dl.json()).schema === 'puppeteer-lab/recording');
    const stage = viewer.getByTestId('take-canvas');
    const before = await stage.screenshot();
    await viewer.getByTestId('take-play').click();
    await viewer.waitForTimeout(700);
    const after = await stage.screenshot();
    check('Play animates the puppet', !before.equals(after));
    await viewer.screenshot({ path: path.join(OUT, '02-viewer-desktop.png') });
    check('no page errors on the viewer', errors.length === 0, errors.join(' | '));

    const missing = await (await chrome.newContext()).newPage();
    await missing.goto(`${WEB}/t/${'a'.repeat(22)}`);
    check('an unknown id says it cannot find the take', /can't find that take/i.test(await missing.getByTestId('take-state').innerText()));
  } finally {
    await chrome.close();
  }

  // 3. Admin listing and the pull script.
  const noAuth = await fetch(`${API}/api/admin/takes`);
  check('the admin list refuses a missing token', noAuth.status === 401);
  const list = await (await fetch(`${API}/api/admin/takes`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  check('the admin list has the saved take', list.count === 1 && list.takes[0].frames > 0);
  const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const pull = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/Pull-Takes.ps1', '-Base', API, '-Dest', pulledDir, '-Token', TOKEN], { encoding: 'utf8' });
  if (pull.error) check('Pull-Takes.ps1 ran', false, `${ps} not available: ${pull.error.message}`);
  else {
    const files = existsSync(pulledDir) ? readdirSync(pulledDir) : [];
    check('Pull-Takes.ps1 pulled the recording and its meta', pull.status === 0 && files.some((f) => f.endsWith('.meta.json')) && files.some((f) => f.endsWith('.json') && !f.endsWith('.meta.json')), pull.stderr.trim().split('\n')[0]);
  }

  // 4. iPhone-sized WebKit: the viewer fits (layout only; WebKit has no camera here).
  const wk = await webkit.launch();
  try {
    const page = await (await wk.newContext({ ...devices['iPhone 13'] })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(link);
    await page.getByTestId('take-play').waitFor({ timeout: 20000 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check('iPhone: the viewer has no sideways scroll', fits);
    const box = await page.getByTestId('take-play').boundingBox();
    const vp = page.viewportSize();
    check('iPhone: Play is inside the window', !!box && box.y + box.height <= vp.height && box.x >= 0);
    await page.screenshot({ path: path.join(OUT, '03-viewer-iphone-webkit.png') });
    check('iPhone: no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await wk.close();
  }
}

try {
  await main();
} catch (e) {
  check('share-check completed', false, String(e.stack ?? e).split('\n').slice(0, 3).join(' '));
} finally {
  for (const c of children) c.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
