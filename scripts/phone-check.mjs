/**
 * Phone + permission gate: builds nothing itself (npm run phone-check builds first), serves dist/ with
 * vite preview and asserts, in real browsers:
 *   - the default load lands in Face Puppet (no hub) at 390x844 and 1440x900, with the tap-to-start state
 *     shown BEFORE any getUserMedia call;
 *   - one tap starts the camera (and the microphone in the same request), Record/Stop never ask again,
 *     flip/retry/resume never leave a second stream running;
 *   - every camera error renders its own card (blocked, dismissed, no camera, in use, constraints,
 *     insecure, unsupported) and a Retry recovers with no stale error;
 *   - an ended camera track offers a one-tap resume, mid-take too;
 *   - the phone layout (bar, drawer, 48px badge strip) still holds, and desktop is unchanged.
 * Chromium uses a fake camera (--use-fake-device-for-media-stream). WebKit has NO camera in Playwright: its
 * sections prove layout and the start/error UI (errors are stubbed getUserMedia rejections), never live tracking.
 * Needs network: Tailwind loads from a CDN. Screenshots go to $PROOF_DIR or .proof/<date>-phone-port/ (gitignored).
 * The port is $PHONE_CHECK_PORT (default 4173); a port that is already serving is refused, never reused.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const PORT = Number(process.env.PHONE_CHECK_PORT ?? 4173);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-phone-port`;
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
  if (busy) throw new Error(`port ${PORT} is already serving something; refusing to test a server this script did not start (set PHONE_CHECK_PORT)`);
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

// Counts getUserMedia calls, keeps every stream it hands out (so live tracks can be counted), can be told to
// reject with a named DOMException, and reports two cameras so the Flip button exists.
// window.__gum = { calls: [{video,audio}], streams: [], fail: {name, message, remaining} | null }
const GUM_SHIM = () => {
  const md = navigator.mediaDevices;
  window.__gum = { calls: [], streams: [], fail: null };
  window.__live = () => {
    const live = window.__gum.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live');
    return { video: live.filter((t) => t.kind === 'video').length, audio: live.filter((t) => t.kind === 'audio').length };
  };
  if (!md) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    window.__gum.calls.push({ video: !!c?.video, audio: !!c?.audio });
    const f = window.__gum.fail;
    if (f && f.remaining > 0) {
      f.remaining--;
      throw new DOMException(f.message || f.name, f.name);
    }
    const s = await orig(c);
    window.__gum.streams.push(s);
    return s;
  };
  const enumOrig = md.enumerateDevices.bind(md);
  md.enumerateDevices = async () => {
    const d = await enumOrig();
    if (d.filter((x) => x.kind === 'videoinput').length < 2) d.push({ kind: 'videoinput', deviceId: 'fake-2', label: 'Fake rear', groupId: 'g2', toJSON() { return {}; } });
    return d;
  };
};

// For a browser with no mediaDevices at all (Playwright WebKit): a stand-in that rejects like a device-less phone,
// so the error UI can be driven with stubbed rejections. Installed BEFORE GUM_SHIM.
const FAKE_MEDIA_DEVICES = () => {
  if (navigator.mediaDevices) return;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        throw new DOMException('Requested device not found', 'NotFoundError');
      },
      enumerateDevices: async () => [],
    },
  });
};

const seen = (locator, timeout = 20000) => locator.waitFor({ timeout }).then(() => true, () => false);
const gumCount = (page) => page.evaluate(() => window.__gum.calls.length);
const gumCalls = (page) => page.evaluate(() => window.__gum.calls);
const live = (page) => page.evaluate(() => window.__live());
const failWith = (page, name, message = name, remaining = 99) => page.evaluate((f) => (window.__gum.fail = f), { name, message, remaining });
const clearFail = (page) => page.evaluate(() => (window.__gum.fail = null));
const videoPlaying = (page, timeout = 30000) =>
  page
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 2 && !v.paused && v.videoWidth > 0;
    }, null, { timeout })
    .then(() => true, () => false);

// Stand-in for the deploy-time attribution badge (badge.js: fixed, bottom-right, z 9999), which is not
// present in dist during local gates. Geometry measured on the live site at 390x844: ~170x28, 12px from
// the right and bottom edges. It sits on document.body, so it survives the SPA route.
async function injectBadge(page) {
  await page.evaluate(() => {
    const b = document.createElement('div');
    b.id = 'gate-badge';
    b.style.cssText = 'position:fixed;right:12px;bottom:12px;width:170px;height:28px;z-index:9999;background:#888;pointer-events:auto';
    document.body.appendChild(b);
  });
}

/** Default load: no hub click. Waits until Face Puppet's stage exists. */
async function openFace(page, query = '', { badge = false } = {}) {
  await page.goto(`${BASE}/${query}`);
  // 'attached', not visible: a 0px-tall stage must surface as a FAIL on the height check, not a timeout.
  await page.locator('canvas').first().waitFor({ state: 'attached' });
  if (badge) await injectBadge(page);
}

const startCard = (page) => page.getByTestId('start-card');
const issueCard = (page) => page.getByTestId('camera-issue');
const lostCard = (page) => page.getByTestId('camera-lost');
const tapStart = (page) => page.getByRole('button', { name: 'Start camera' }).click();
const issueKind = (page) => issueCard(page).getAttribute('data-kind', { timeout: 15000 }).catch(() => null);

// Every bottom-bar button must be the topmost element at its own center (nothing, e.g. the badge, covers it).
async function barHitTest(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="phone-bar"]');
    if (!bar) return { error: 'no [data-testid=phone-bar]' };
    const barRect = bar.getBoundingClientRect();
    const drawer = document.querySelector('[data-testid="controls-drawer"]');
    const covered = [];
    const buttons = [...bar.querySelectorAll('button')];
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !(top === b || b.contains(top))) {
        const name = b.getAttribute('aria-label') || b.title || b.textContent || 'button';
        covered.push(`${name} covered by ${top ? (top.id ? '#' + top.id : top.tagName.toLowerCase()) : 'nothing'}`);
      }
    }
    return {
      count: buttons.length,
      covered,
      badge: !!document.getElementById('gate-badge'),
      barTop: barRect.top,
      barBottom: barRect.bottom,
      drawerBottom: drawer ? drawer.getBoundingClientRect().bottom : null,
    };
  });
}

async function phoneLayout(page, label, vp) {
  const stage = await bbox(page.locator('canvas').first());
  check(`${label}: stage is tall enough`, stage && stage.height >= 400, `h=${stage?.height}`);

  const rb = await bbox(page.getByTitle(/Start Recording/));
  check(`${label}: Record is on-screen and >= 44px`, inViewport(rb, vp) && rb.width >= 44 && rb.height >= 44, JSON.stringify(rb));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 0, `+${overflow}px`);
  await page.screenshot({ path: `${OUT}/${label}-bar.png` });

  const hit = await barHitTest(page);
  check(`${label}: stand-in badge is present`, !hit.error && hit.badge, hit.error ?? '');
  check(
    `${label}: every bottom-bar button is hit-testable (not covered by the badge)`,
    !hit.error && hit.count > 0 && hit.covered.length === 0,
    hit.error ?? (hit.covered.length ? hit.covered.join(' | ') : `${hit.count} buttons`),
  );

  try {
    await page.getByRole('button', { name: 'Controls', exact: true }).click({ timeout: 5000 });
  } catch (e) {
    check(`${label}: Controls button opens the drawer`, false, String(e.message).split('\n')[0]);
    await page.screenshot({ path: `${OUT}/${label}-no-controls.png` });
    return;
  }
  await page.waitForTimeout(400);
  const hitOpen = await barHitTest(page);
  check(
    `${label}: with the drawer open, every bottom-bar button is still hit-testable`,
    !hitOpen.error && hitOpen.count > 0 && hitOpen.covered.length === 0,
    hitOpen.error ?? (hitOpen.covered.length ? hitOpen.covered.join(' | ') : `${hitOpen.count} buttons`),
  );
  check(
    `${label}: drawer bottom edge is at or above the bar top`,
    !hitOpen.error && hitOpen.drawerBottom !== null && hitOpen.drawerBottom <= hitOpen.barTop + 0.5,
    `drawer bottom ${hitOpen.drawerBottom} vs bar top ${hitOpen.barTop}`,
  );
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
  await page.getByRole('button', { name: 'Controls', exact: true }).click(); // close it again
  await page.waitForTimeout(300);
}

const CAM_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

// ---------------------------------------------------------------------------------------------
// Chromium phone, camera + mic NOT pre-granted: the whole first-run flow.
async function chromiumPhone(vp) {
  const cr = await chromium.launch({ args: CAM_ARGS });
  try {
    const ctx = await cr.newContext({ ...devices['Pixel 7'], viewport: vp });
    await ctx.addInitScript(GUM_SHIM);
    const page = await ctx.newPage();
    await openFace(page, '?debug', { badge: true });
    const L = 'chromium-phone';

    // Default load is Face Puppet (not the hub), showing the start state, with nothing requested yet.
    await startCard(page).waitFor({ timeout: 15000 });
    check(`${L}: default load lands in Face Puppet`, (await page.getByText('Demos').first().isVisible()) && (await page.getByText('Open Puppet').count()) === 0);
    check(`${L}: start card shows before any getUserMedia call`, (await startCard(page).isVisible()) && (await gumCount(page)) === 0, `calls=${await gumCount(page)}`);
    const cardText = await startCard(page).innerText();
    check(`${L}: start card says what is used and that it stays on the device`, /camera/i.test(cardText) && /microphone/i.test(cardText) && /stays? on this device/i.test(cardText));
    check(`${L}: Record is disabled until the camera runs`, await page.getByRole('button', { name: 'Record', exact: true }).isDisabled());
    const cb = await bbox(startCard(page));
    const barTop = (await bbox(page.getByTestId('phone-bar')))?.y ?? 0;
    check(`${L}: start card fits above the bar`, inViewport(cb, vp) && cb.y + cb.height <= barTop + 0.5, JSON.stringify(cb));
    await page.screenshot({ path: `${OUT}/${L}-01-start.png` });
    await page.waitForTimeout(1500);
    check(`${L}: still no getUserMedia call while the card sits there`, (await gumCount(page)) === 0);

    // One tap: camera + microphone in a single request.
    await tapStart(page);
    const playing = await videoPlaying(page);
    check(`${L}: the tap starts tracking (hidden camera video is playing)`, playing);
    const calls = await gumCalls(page);
    check(`${L}: exactly one request, camera and microphone together`, calls.length === 1 && calls[0].video && calls[0].audio, JSON.stringify(calls));
    check(`${L}: start card is gone once running`, (await startCard(page).count()) === 0);
    await page.waitForFunction(() => /track (\d+) fps/.test(document.querySelector('[data-testid=debug-readout]')?.textContent ?? '') && Number(/track (\d+) fps/.exec(document.querySelector('[data-testid=debug-readout]').textContent)[1]) > 0, null, { timeout: 30000 }).then(
      () => check(`${L}: ?debug readout shows a live tracker fps`, true),
      () => check(`${L}: ?debug readout shows a live tracker fps`, false),
    );
    let lv = await live(page);
    check(`${L}: one camera track and one microphone track are live`, lv.video === 1 && lv.audio === 1, JSON.stringify(lv));
    check(`${L}: microphone stays silent until a take records`, await page.evaluate(() => window.__gum.streams[0].getAudioTracks()[0].enabled === false));
    await page.screenshot({ path: `${OUT}/${L}-02-running.png` });

    await phoneLayout(page, L, vp);

    // Record / Stop never ask for anything.
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.waitForTimeout(1200);
    check(`${L}: while recording the microphone is unmuted`, await page.evaluate(() => window.__gum.streams[0].getAudioTracks()[0].enabled === true));
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.waitForTimeout(500);
    check(`${L}: Record and Stop made no new getUserMedia call`, (await gumCount(page)) === 1, `calls=${await gumCount(page)}`);
    lv = await live(page);
    check(`${L}: Stop muted the mic again but stopped no track`, lv.video === 1 && lv.audio === 1 && (await page.evaluate(() => window.__gum.streams[0].getAudioTracks()[0].enabled === false)), JSON.stringify(lv));
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    await page.waitForTimeout(300);
    check(`${L}: the take has audio`, await page.getByText('AUDIO ACTIVE').first().isVisible().catch(() => false));
    await page.getByRole('button', { name: 'Controls', exact: true }).click();

    // Flip: reopen the camera only. No second prompt, no second stream.
    const flip = page.getByRole('button', { name: 'Flip camera' });
    check(`${L}: Flip camera is offered`, await flip.isVisible());
    await flip.click();
    await page.waitForFunction(() => window.__gum.calls.length >= 2, null, { timeout: 10000 }).catch(() => {});
    await videoPlaying(page);
    await page.waitForTimeout(800);
    const afterFlip = await gumCalls(page);
    lv = await live(page);
    check(`${L}: flip re-requested the camera only (no microphone)`, afterFlip.length === 2 && afterFlip[1].video && !afterFlip[1].audio, JSON.stringify(afterFlip));
    check(`${L}: after flip still exactly one camera track and one microphone track`, lv.video === 1 && lv.audio === 1, JSON.stringify(lv));

    // The OS ends the stream (iOS backgrounding): a one-tap resume instead of a dead screen.
    await page.evaluate(() => {
      const t = window.__gum.streams[window.__gum.streams.length - 1].getVideoTracks()[0];
      t.dispatchEvent(new Event('ended'));
    });
    await lostCard(page).waitFor({ timeout: 5000 }).catch(() => {});
    check(`${L}: an ended camera track shows the resume card`, await lostCard(page).isVisible().catch(() => false));
    await page.screenshot({ path: `${OUT}/${L}-05-lost.png` });
    await page.getByRole('button', { name: 'Resume camera' }).click();
    await videoPlaying(page);
    await page.waitForFunction(() => document.querySelector('[data-testid=camera-lost]') === null, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    lv = await live(page);
    check(`${L}: resume tap brings the camera back`, (await lostCard(page).count()) === 0 && (await videoPlaying(page)));
    check(`${L}: after resume still exactly one camera track and one microphone track`, lv.video === 1 && lv.audio === 1, JSON.stringify(lv));
    check(`${L}: resume never asked for the microphone again`, (await gumCalls(page)).slice(2).every((c) => !c.audio));

    // Camera dies mid-take: the take stops cleanly.
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const t = window.__gum.streams[window.__gum.streams.length - 1].getVideoTracks()[0];
      t.dispatchEvent(new Event('ended'));
    });
    await lostCard(page).waitFor({ timeout: 5000 }).catch(() => {});
    check(`${L}: camera lost mid-take ends the take and offers resume`, (await lostCard(page).isVisible().catch(() => false)) && (await page.getByRole('button', { name: 'Stop recording' }).count()) === 0);
    check(`${L}: the mid-take card tells the take was kept`, /saved/i.test(await lostCard(page).innerText().catch(() => '')));
  } finally {
    await cr.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Every error, one fresh page each: name -> card kind, buttons, and a Retry that does not stack streams.
async function chromiumErrors(vp) {
  const cr = await chromium.launch({ args: CAM_ARGS });
  try {
    const ctx = await cr.newContext({ ...devices['Pixel 7'], viewport: vp });
    await ctx.addInitScript(GUM_SHIM);
    const L = 'errors';
    const fresh = async () => {
      const page = await ctx.newPage();
      await openFace(page);
      await startCard(page).waitFor({ timeout: 15000 });
      return page;
    };

    // Blocked (the browser cannot say whose fault: camera or mic): explains, offers Try again + continue without mic.
    {
      const page = await fresh();
      await failWith(page, 'NotAllowedError', 'Permission denied');
      await tapStart(page);
      const kind = await issueKind(page);
      const card = issueCard(page);
      const txt = await card.innerText().catch(() => '');
      check(`${L}: NotAllowedError (denied) -> blocked card with steps`, kind === 'blocked' && /blocked/i.test(txt) && (await card.locator('li').count()) >= 2, `kind=${kind}`);
      check(`${L}: blocked card offers Try again and Continue without microphone`, (await page.getByRole('button', { name: 'Try again' }).isVisible()) && (await page.getByRole('button', { name: 'Continue without microphone' }).isVisible()));
      check(`${L}: blocked asked once (no auto re-prompt loop)`, (await gumCount(page)) === 1, `calls=${await gumCount(page)}`);
      await page.screenshot({ path: `${OUT}/${L}-blocked-chromium-phone.png` });
      // Continue without the mic: one camera-only request, camera runs, sound is quietly off.
      await clearFail(page);
      await page.getByRole('button', { name: 'Continue without microphone' }).click();
      const ok = await videoPlaying(page);
      const calls = await gumCalls(page);
      check(`${L}: continue-without-mic starts the camera with a video-only request`, ok && calls.length === 2 && !calls[1].audio, JSON.stringify(calls));
      check(`${L}: the error card is gone after success (no stale error)`, (await issueCard(page).count()) === 0);
      check(`${L}: a quiet note says takes are motion only`, /motion only/i.test(await page.getByTestId('mic-note').innerText().catch(() => '')));
      check(`${L}: Record button says motion only`, (await page.getByTitle('Start Recording (Motion Only)').count()) > 0);
      // Record with no mic: no request, no prompt.
      await page.getByRole('button', { name: 'Record', exact: true }).click();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Stop recording' }).click();
      check(`${L}: Record without a mic made no getUserMedia call`, (await gumCount(page)) === 2);
      // Turn the mic on afterwards, from an explicit tap (never mid-take).
      await page.getByRole('button', { name: 'Turn on' }).click();
      await page.waitForFunction(() => window.__gum.calls.length >= 3, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      const c3 = await gumCalls(page);
      const lv3 = await live(page);
      check(`${L}: Turn on asks for the microphone alone, once, on its own tap`, c3.length === 3 && c3[2].audio && !c3[2].video, JSON.stringify(c3));
      check(`${L}: after Turn on: one camera track, one microphone track`, lv3.video === 1 && lv3.audio === 1, JSON.stringify(lv3));
      await page.close();
    }

    // Dismissed prompt.
    {
      const page = await fresh();
      await failWith(page, 'NotAllowedError', 'Permission dismissed');
      await tapStart(page);
      check(`${L}: NotAllowedError (dismissed) -> "not allowed yet" card`, (await issueKind(page)) === 'dismissed');
      await page.screenshot({ path: `${OUT}/${L}-dismissed-chromium-phone.png` });
      await page.close();
    }

    // No camera (also proves a missing device does not need the mic to work: it falls back to video-only once).
    {
      const page = await fresh();
      await failWith(page, 'NotFoundError');
      await tapStart(page);
      const kind = await issueKind(page);
      const calls = await gumCalls(page);
      check(`${L}: NotFoundError -> no camera card`, kind === 'no-camera', `kind=${kind}`);
      check(`${L}: no camera tried video-only once, no more`, calls.length === 2 && calls[0].audio && !calls[1].audio, JSON.stringify(calls));
      check(`${L}: no-camera card has no microphone shortcut`, (await page.getByRole('button', { name: 'Continue without microphone' }).count()) === 0);
      await page.screenshot({ path: `${OUT}/${L}-no-camera-chromium-phone.png` });
      await page.close();
    }

    // Camera in use -> Try again recovers; the stale error goes away; a double tap sends one request.
    {
      const page = await fresh();
      await failWith(page, 'NotReadableError');
      await tapStart(page);
      const kind = await issueKind(page);
      check(`${L}: NotReadableError -> camera busy card`, kind === 'in-use', `kind=${kind}`);
      check(`${L}: busy card tells to close the other app or tab`, /another app or browser tab/i.test(await issueCard(page).innerText().catch(() => '')));
      await page.screenshot({ path: `${OUT}/${L}-in-use-chromium-phone.png` });
      const before = await gumCount(page);
      await clearFail(page);
      await page.getByRole('button', { name: 'Try again' }).dblclick();
      const ok = await videoPlaying(page);
      await page.waitForTimeout(800);
      const after = await gumCount(page);
      const lv = await live(page);
      check(`${L}: Try again (double-tapped) sent exactly one request`, after - before === 1, `delta=${after - before}`);
      check(`${L}: Try again recovers and the error card is gone`, ok && (await issueCard(page).count()) === 0);
      check(`${L}: after retry exactly one camera track is live (no duplicate stream)`, lv.video === 1, JSON.stringify(lv));
      await page.close();
    }

    // Constraints (some Android cameras): tries plain video first; only shows the card if that fails too.
    {
      const page = await fresh();
      await failWith(page, 'OverconstrainedError');
      await tapStart(page);
      const kind = await issueKind(page);
      const calls = await gumCalls(page);
      check(`${L}: OverconstrainedError -> camera not supported card`, kind === 'constraints', `kind=${kind}`);
      check(`${L}: overconstrained retried with plain video before giving up`, calls.some((c) => c.video && !c.audio) && calls.length >= 3, JSON.stringify(calls));
      await page.close();
    }
    {
      const page = await fresh();
      await failWith(page, 'OverconstrainedError', 'OverconstrainedError', 1); // only the first (sized) request fails
      await tapStart(page);
      check(`${L}: overconstrained + plain video works -> camera runs, no error`, (await videoPlaying(page)) && (await issueCard(page).count()) === 0);
      await page.close();
    }

    // Unknown error name still gets a card with Try again.
    {
      const page = await fresh();
      await failWith(page, 'WeirdError');
      await tapStart(page);
      check(`${L}: unknown error -> generic card with Try again`, (await issueKind(page)) === 'unknown' && (await page.getByRole('button', { name: 'Try again' }).isVisible()));
      await page.close();
    }

    // Not https / no getUserMedia at all: caught BEFORE asking.
    {
      const insecure = await cr.newContext({ ...devices['Pixel 7'], viewport: vp });
      await insecure.addInitScript(GUM_SHIM);
      await insecure.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
      const page = await insecure.newPage();
      await openFace(page);
      await startCard(page).waitFor({ timeout: 15000 });
      await tapStart(page);
      check(`${L}: insecure page -> "needs a secure page" card`, (await issueKind(page)) === 'insecure');
      check(`${L}: insecure page never called getUserMedia`, (await gumCount(page)) === 0);
      check(`${L}: insecure card has no Try again (it cannot succeed)`, (await page.getByRole('button', { name: 'Try again' }).count()) === 0);
      await page.screenshot({ path: `${OUT}/${L}-insecure-chromium-phone.png` });
      await insecure.close();

      const noApi = await cr.newContext({ ...devices['Pixel 7'], viewport: vp });
      await noApi.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }));
      const p2 = await noApi.newPage();
      await openFace(p2);
      await startCard(p2).waitFor({ timeout: 15000 });
      await tapStart(p2);
      check(`${L}: no getUserMedia in this browser -> "not available here" card`, (await issueKind(p2)) === 'unsupported');
      await p2.screenshot({ path: `${OUT}/${L}-unsupported-chromium-phone.png` });
      await noApi.close();
    }
  } finally {
    await cr.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Everything already granted in the browser: the explainer is skipped, nothing prompts.
async function chromiumGranted(vp) {
  const cr = await chromium.launch({ args: CAM_ARGS });
  try {
    const ctx = await cr.newContext({ ...devices['Pixel 7'], viewport: vp, permissions: ['camera', 'microphone'] });
    await ctx.addInitScript(GUM_SHIM);
    const page = await ctx.newPage();
    await openFace(page, '?debug', { badge: true });
    const L = 'chromium-phone-granted';
    const playing = await videoPlaying(page);
    check(`${L}: already granted -> starts without the explainer`, playing && (await startCard(page).count()) === 0);
    const calls = await gumCalls(page);
    check(`${L}: one combined request`, calls.length === 1 && calls[0].audio, JSON.stringify(calls));
    await page.screenshot({ path: `${OUT}/${L}-running.png` });
  } finally {
    await cr.close();
  }
}

// ---------------------------------------------------------------------------------------------
// WebKit phone: NO camera in Playwright WebKit. Layout, start state, and the error UI (stubbed rejections) only.
async function webkitPhone(vp) {
  const wk = await webkit.launch();
  try {
    const L = 'webkit-phone';
    // (1) Real Playwright WebKit: no camera, and in this build no navigator.mediaDevices at all.
    {
      const ctx = await wk.newContext({ ...devices['iPhone 13'], viewport: vp });
      const page = await ctx.newPage();
      await openFace(page, '', { badge: true });
      await startCard(page).waitFor({ timeout: 20000 });
      check(`${L}: default load lands in Face Puppet with the start card`, await startCard(page).isVisible());
      await page.screenshot({ path: `${OUT}/${L}-01-start.png` });
      await phoneLayout(page, L, vp);
      await tapStart(page);
      const kind = await issueKind(page);
      check(`${L}: real WebKit (no camera API here): the tap shows a readable card, not a dead screen`, !!kind, `kind=${kind}`);
      await page.screenshot({ path: `${OUT}/${L}-02-real-webkit-no-camera.png` });
      await ctx.close();
    }
    // (2) Stubbed rejections (iPhone Safari UA): what a person who tapped Don't Allow / has another app open would see.
    {
      const ctx = await wk.newContext({ ...devices['iPhone 13'], viewport: vp });
      await ctx.addInitScript(FAKE_MEDIA_DEVICES);
      await ctx.addInitScript(GUM_SHIM);
      const page = await ctx.newPage();
      await openFace(page, '', { badge: true });
      await startCard(page).waitFor({ timeout: 20000 });
      check(`${L}: (stubbed) start card shows before any getUserMedia call`, (await gumCount(page)) === 0, `calls=${await gumCount(page)}`);
      await failWith(page, 'NotAllowedError', 'The request is not allowed by the user agent or the platform in the current context.');
      await tapStart(page);
      const kind = await issueKind(page);
      const blockedText = await issueCard(page).innerText().catch(() => '');
      check(`${L}: (stubbed) denied -> blocked card with the iPhone Safari steps (aA > Website Settings)`, kind === 'blocked' && /aA/.test(blockedText) && /Website Settings/.test(blockedText), `kind=${kind}`);
      check(`${L}: (stubbed) Continue without microphone is offered`, await page.getByRole('button', { name: 'Continue without microphone' }).isVisible());
      await page.screenshot({ path: `${OUT}/${L}-03-blocked-stubbed.png` });
      await failWith(page, 'NotReadableError');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid=camera-issue]')?.getAttribute('data-kind') === 'in-use', null, { timeout: 10000 }).catch(() => {});
      check(`${L}: (stubbed) camera busy card renders`, (await issueKind(page)) === 'in-use');
      await page.screenshot({ path: `${OUT}/${L}-04-in-use-stubbed.png` });
      await ctx.close();
    }
  } finally {
    await wk.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Desktop: default load, start state, layout unchanged, demo switcher and deep links.
async function desktop() {
  const dk = await chromium.launch({ args: CAM_ARGS });
  try {
    const L = 'desktop';
    // Not granted: the explainer.
    const ctx = await dk.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(GUM_SHIM);
    const page = await ctx.newPage();
    await openFace(page, '?debug');
    await startCard(page).waitFor({ timeout: 15000 });
    check(`${L}: default load lands in Face Puppet (no hub)`, (await page.getByText('Face Puppet & Expressions').first().isVisible()) && (await page.getByText('5 Interactive Demos').count()) === 0);
    check(`${L}: start card shows before any getUserMedia call`, (await gumCount(page)) === 0);
    await page.screenshot({ path: `${OUT}/${L}-01-start.png` });
    await tapStart(page);
    check(`${L}: one tap starts tracking`, await videoPlaying(page));
    const calls = await gumCalls(page);
    check(`${L}: one combined camera + microphone request`, calls.length === 1 && calls[0].audio, JSON.stringify(calls));
    const side = await bbox(page.getByTestId('controls-drawer'));
    check(`${L}: sidebar is 320px wide on the right`, side && Math.abs(side.width - 320) <= 2 && Math.abs(side.x - 1120) <= 2, JSON.stringify(side));
    const rec = await bbox(page.getByTitle(/Start Recording/));
    check(`${L}: recorder panel is bottom-right of the stage`, rec && rec.x > 600 && rec.y > 450, JSON.stringify(rec));
    check(`${L}: no phone bar`, (await page.getByRole('button', { name: 'Controls', exact: true }).count()) === 0);
    check(`${L}: header toggles visible`, await page.getByText('GAZE RAYS').first().isVisible());
    check(`${L}: ?debug readout still works`, (await page.getByTestId('debug-readout').count()) === 1);
    await page.getByTitle(/Start Recording/).click();
    await page.waitForTimeout(700);
    await page.getByTitle('Stop Recording').click();
    check(`${L}: Record/Stop made no new getUserMedia call`, (await gumCount(page)) === 1);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${L}-02-running-fake-camera.png` });

    // Demo switcher and deep links.
    await page.getByRole('button', { name: /Demos/ }).click();
    const menu = page.getByTestId('demo-menu');
    check(`${L}: Demos menu lists all five demos and the overview`, (await menu.getByRole('menuitem').count()) === 6);
    check(`${L}: Demos menu shows the build stamp`, /·\s[0-9a-f]{6}\s·/.test(await menu.innerText()) || /dev\/unknown/.test(await menu.innerText()));
    await page.screenshot({ path: `${OUT}/${L}-03-demo-menu.png` });
    await menu.getByRole('menuitem', { name: 'All demos' }).click();
    await page.getByText('5 Interactive Demos').waitFor({ timeout: 15000 });
    check(`${L}: All demos opens the overview and the URL says so (keeps ?debug)`, page.url().includes('demo=menu') && page.url().includes('debug'));
    await page.getByRole('button', { name: /Face Puppet/ }).first().click();
    await page.getByText('Face Puppet & Expressions').first().waitFor({ timeout: 15000 });
    check(`${L}: the overview has a way back to Face Puppet`, !page.url().includes('demo=') && page.url().includes('debug'));
    await page.getByRole('button', { name: /Demos/ }).click();
    await page.getByTestId('demo-menu').getByRole('menuitem', { name: 'Hand Telemetry' }).click();
    await page.waitForFunction(() => location.search.includes('demo=telemetry'), null, { timeout: 10000 }).catch(() => {});
    check(`${L}: switching to Hand Telemetry works`, page.url().includes('demo=telemetry') && (await seen(page.getByRole('button', { name: /Hub/ }).first())));
    await page.close();

    // Deep links.
    const p2 = await ctx.newPage();
    await p2.goto(`${BASE}/?demo=telemetry`);
    check(`${L}: ?demo=telemetry deep link opens that demo`, await seen(p2.getByRole('button', { name: /Hub/ }).first()));
    await p2.close();
    const p3 = await ctx.newPage();
    await p3.goto(`${BASE}/?demo=menu`);
    check(`${L}: ?demo=menu deep link opens the overview`, await seen(p3.getByText('5 Interactive Demos')));
    await p3.screenshot({ path: `${OUT}/${L}-04-overview.png` });
    await p3.close();
    await ctx.close();

    // Granted: no explainer at all.
    const gctx = await dk.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
    await gctx.addInitScript(GUM_SHIM);
    const gp = await gctx.newPage();
    await openFace(gp);
    check(`${L}: already granted -> starts without the explainer`, (await videoPlaying(gp)) && (await startCard(gp).count()) === 0);
    await gctx.close();
  } finally {
    await dk.close();
  }
}

let crashed = false;
try {
  await startServer();
  const vp = { width: 390, height: 844 };
  await section('chromium-phone', () => chromiumPhone(vp));
  await section('errors', () => chromiumErrors(vp));
  await section('chromium-phone-granted', () => chromiumGranted(vp));
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
