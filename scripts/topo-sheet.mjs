/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face topology comparison sheet (throwaway, deleted with the losing variants). Runs the generator for every
 * candidate table (Current, Flip, Flow), builds a sheet-only bundle into dist-topo with VITE_TOPO_SHEET=1 (dist/ is
 * never touched), serves it, and renders each variant x {low, full} x {front, orbit} through the share viewer
 * (/t/<id>) on the synthetic take at the pinned pose, in the shipped neon look. The candidate tables are injected as
 * window.__topo before the app loads (components/face/topoSheetHook.ts). It also draws each table as a wireframe over
 * the frontal canonical projection (from candidates.json, no product code), with edges absent from Current in amber.
 * Writes to $PROOF_DIR or .proof/<date>-topo/: candidates.json, report.txt, <variant>-<mesh>-{front,orbit,wire}.png,
 * sheet.png. Asserts: no page errors; every render non-blank; Flip and Flow low (and Flip full) renders differ from
 * Current; the three low tables differ; a normal dist/ build carries no candidate hook (SKIP if dist/ is missing).
 * The port is $TOPO_SHEET_PORT (default 4179); a busy port is refused.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureFixture, makeCheck, startPreview, openViewer, seek } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.TOPO_SHEET_PORT ?? 4179);
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-topo`;
const T_POSE = 496; // frame ~10: face and both hands present, a multiple of the scrubber step
const VARIANTS = ['current', 'flip', 'flow'];
const MESHES = ['low', 'full'];
const VIEWS = ['front', 'orbit', 'wire'];
const MARKER = '__topo';
mkdirSync(OUT, { recursive: true });
const { check, fail, finish } = makeCheck();

function run(args, env = {}) {
  const r = spawnSync(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`node ${args.join(' ')} exited with ${r.status}`);
}

async function drag(page, fracX) {
  const box = await page.getByTestId('take-canvas').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * fracX, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

const canvasUrl = (page) => page.evaluate(() => document.querySelector('[data-testid=take-canvas]').toDataURL('image/png'));
const toPng = (file, url) => writeFileSync(path.join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));

/** The key numbers of one "<variant> <mesh>:" section of the generator report. */
function keyNumbers(report, name) {
  const sec = report.split('\n\n').find((s) => s.startsWith(`${name}:`)) ?? '';
  const m = (re) => (sec.match(re) ?? [])[1] ?? '?';
  return {
    worst: m(/worst ([\d.]+) deg/),
    slivers: m(/under 20 deg: (\d+)/),
    aspect: m(/aspect over 3: (\d+)/),
    valence: m(/\(([\d.]+)% at 5\.\.7/),
    dihedral: m(/dihedral across interior edges: mean ([\d.]+) deg/),
  };
}

let server;
let browser;
let code = 1;
try {
  // 1. Candidate tables and the quality report.
  const candPath = path.join(OUT, 'candidates.json');
  const gen = spawnSync(process.execPath, ['tools/gen-face-topology.mjs', '--emit-candidates', candPath, '--out', path.join(OUT, 'unused.ts')], { encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(`generator exited with ${gen.status}: ${gen.stderr}`);
  writeFileSync(path.join(OUT, 'report.txt'), gen.stdout);
  const cand = JSON.parse(readFileSync(candPath, 'utf8'));
  const report = cand.report;

  // 2. Sheet-only bundle in dist-topo (dist/ is never touched).
  run(['scripts/build-stamp.mjs']);
  run(['scripts/vendor-assets.mjs']);
  run(['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-topo', '--emptyOutDir'], { VITE_TOPO_SHEET: '1' });

  // 3. Serve it.
  server = await startPreview(PORT, 'dist-topo');
  browser = await chromium.launch();
  const take = ensureFixture();
  const shots = {};
  const errors = [];

  // 4. Renders: one fresh page per variant and mesh, the table injected before any app script runs.
  for (const variant of VARIANTS) {
    for (const mesh of MESHES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${variant} ${mesh}: ${e}`));
      const tables = { low: cand.variants[variant].low, full: cand.variants[variant].full };
      await page.addInitScript(({ tables, detail }) => {
        window.__topo = { low: tables.low, full: tables.full, detail };
      }, { tables, detail: mesh });
      await openViewer(page, server.base, take);
      await seek(page, T_POSE);
      shots[`${variant}-${mesh}-front`] = await canvasUrl(page);
      await page.getByTestId('orbit-toggle').click();
      await page.waitForTimeout(500);
      await drag(page, 0.3);
      shots[`${variant}-${mesh}-orbit`] = await canvasUrl(page);
      await ctx.close();
    }
  }

  // 5. Wireframes over the frontal canonical projection, one framing for all six.
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.setContent('<!doctype html><html><body style="margin:0;background:#000"></body></html>');
  const wires = await page.evaluate(({ verts, variants, VARIANTS, MESHES }) => {
    const W = 600, H = 640, PAD = 24;
    const xs = [], ys = [];
    for (let i = 0; i < verts.length; i += 3) { xs.push(verts[i]); ys.push(-verts[i + 1]); }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
    const ox = (W - s * (maxX - minX)) / 2 - s * minX, oy = (H - s * (maxY - minY)) / 2 - s * minY;
    const P = (i) => [ox + s * xs[i], oy + s * ys[i]];
    const edges = (tris) => {
      const set = new Set();
      for (let k = 0; k < tris.length; k += 3) {
        for (let j = 0; j < 3; j++) {
          const a = tris[k + j], b = tris[k + (j + 1) % 3];
          set.add(a < b ? a * 1024 + b : b * 1024 + a);
        }
      }
      return set;
    };
    const out = {};
    for (const mesh of MESHES) {
      const base = edges(variants.current[mesh].tris);
      for (const variant of VARIANTS) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = '#0d1117';
        g.fillRect(0, 0, W, H);
        g.lineWidth = 1;
        const own = [...edges(variants[variant][mesh].tris)];
        for (const changed of [false, true]) {
          g.strokeStyle = changed ? '#ffb020' : '#c9d4e3';
          g.beginPath();
          for (const k of own) {
            if (base.has(k) === changed) continue;
            const [ax, ay] = P(Math.floor(k / 1024)), [bx, by] = P(k % 1024);
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
          }
          g.stroke();
        }
        out[`${variant}-${mesh}-wire`] = c.toDataURL('image/png');
      }
    }
    return out;
  }, { verts: cand.verts, variants: cand.variants, VARIANTS, MESHES });
  Object.assign(shots, wires);

  // 6. Save every image (full frames), then the contact sheet with the renders cropped to the face. The crop boxes are
  // fractions of the stage canvas, calibrated on the 1280x650 stage at this pose (front face ~500..795 x 130..495,
  // orbited face ~285..625 x 70..535).
  for (const [name, url] of Object.entries(shots)) toPng(`${name}.png`, url);
  const CROP = { front: [450 / 1280, 60 / 650, 400 / 1280, 500 / 650], orbit: [255 / 1280, 55 / 650, 400 / 1280, 500 / 650] };
  const cropped = await page.evaluate(async ({ shots, CROP }) => {
    const out = {};
    for (const [k, src] of Object.entries(shots)) {
      const view = k.split('-').pop();
      if (!CROP[view]) { out[k] = src; continue; }
      const i = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
      const [fx, fy, fw, fh] = CROP[view];
      const [sx, sy, sw, sh] = [fx * i.width, fy * i.height, fw * i.width, fh * i.height].map(Math.round);
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(i, sx, sy, sw, sh, 0, 0, sw, sh);
      out[k] = c.toDataURL('image/png');
    }
    return out;
  }, { shots, CROP });
  const cols = MESHES.flatMap((m) => VIEWS.map((v) => [m, v]));
  const caption = (variant) => MESHES.map((mesh) => {
    const k = keyNumbers(report, `${variant} ${mesh}`);
    return `<b>${mesh}</b>: worst angle ${k.worst}&deg;, under 20&deg; ${k.slivers}, aspect&gt;3 ${k.aspect}, valence 5-7 ${k.valence}%, mean dihedral ${k.dihedral}&deg;`;
  }).join('<br>');
  const html = `<!doctype html><html><head><style>
    body { margin: 0; padding: 16px; background: #0b0d12; color: #d6dde8; font: 13px/1.4 system-ui, sans-serif; }
    h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #8b96a8; }
    table { border-collapse: collapse; } th { font-weight: 600; padding: 4px; color: #8b96a8; }
    td { padding: 4px; vertical-align: top; } img { height: 360px; display: block; border: 1px solid #222a36; }
    .cap { padding: 2px 4px 14px; color: #c3ccd9; } .name { font-size: 16px; font-weight: 700; color: #fff; }
  </style></head><body>
    <h1>Face mesh topology: Current vs Flip vs Flow</h1>
    <p>Share viewer, synthetic take at ${T_POSE} ms, shipped neon look. Renders cropped to the face (full frames saved beside); orbit = 30% drag. Wires: frontal canonical projection; amber = edges not in Current.</p>
    <table><tr>${cols.map(([m, v]) => `<th>${m} ${v}</th>`).join('')}</tr>
    ${VARIANTS.map((variant) => `<tr>${cols.map(([m, v]) => `<td><img src="${cropped[`${variant}-${m}-${v}`]}"></td>`).join('')}</tr>
      <tr><td class="cap" colspan="${cols.length}"><span class="name">${variant}</span><br>${caption(variant)}</td></tr>`).join('')}
    </table></body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'sheet.png'), fullPage: true });

  // 7. Assertions. Pixel stats are computed on decoded PNGs (each render came from its own page).
  check('no page errors', errors.length === 0, errors.join(' | '));
  const stats = await page.evaluate(async ({ shots, pairs }) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const px = async (src) => {
      const i = await load(src);
      const c = document.createElement('canvas');
      c.width = i.width; c.height = i.height;
      const g = c.getContext('2d');
      g.drawImage(i, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const far = (A, i, B, j) => Math.max(Math.abs(A[i] - B[j]), Math.abs(A[i + 1] - B[j + 1]), Math.abs(A[i + 2] - B[j + 2])) > 24;
    const data = {};
    for (const [k, v] of Object.entries(shots)) data[k] = await px(v);
    const nonBg = {};
    for (const [k, A] of Object.entries(data)) {
      let n = 0;
      for (let i = 0; i < A.length; i += 4) if (far(A, i, A, 0)) n++;
      nonBg[k] = n / (A.length / 4);
    }
    const diffs = {};
    for (const [a, b] of pairs) {
      const A = data[a], B = data[b];
      if (A.length !== B.length) { diffs[`${a}|${b}`] = 1; continue; }
      let n = 0;
      for (let i = 0; i < A.length; i += 4) if (far(A, i, B, i)) n++;
      diffs[`${a}|${b}`] = n / (A.length / 4);
    }
    return { nonBg, diffs };
  }, {
    shots,
    pairs: [
      ['current-low-front', 'flip-low-front'], ['current-low-front', 'flow-low-front'], ['current-full-front', 'flip-full-front'],
      ...VARIANTS.flatMap((v) => MESHES.map((m) => [`${v}-${m}-front`, `${v}-${m}-orbit`])),
    ],
  });
  const pct = (x) => `${(x * 100).toFixed(3)}%`;
  const blank = Object.entries(stats.nonBg).filter(([, f]) => !(f > 0.02));
  check(`every render and wire is non-blank (${Object.keys(stats.nonBg).length} images, over 2% unlike the corner)`, blank.length === 0,
    blank.length ? blank.map(([k, f]) => `${k} ${pct(f)}`).join(', ') : `lowest ${pct(Math.min(...Object.values(stats.nonBg)))}`);
  for (const [a, b] of [['current-low-front', 'flip-low-front'], ['current-low-front', 'flow-low-front'], ['current-full-front', 'flip-full-front']]) {
    const d = stats.diffs[`${a}|${b}`];
    check(`${b} differs from ${a} (over 0.02% of pixels)`, d > 0.0002, pct(d));
  }
  const orbitMoves = VARIANTS.flatMap((v) => MESHES.map((m) => [`${v} ${m}`, stats.diffs[`${v}-${m}-front|${v}-${m}-orbit`]]));
  check('every orbit render moved away from its front view (over 3% of pixels)', orbitMoves.every(([, d]) => d > 0.03),
    orbitMoves.map(([k, d]) => `${k} ${pct(d)}`).join(', '));
  const lows = VARIANTS.map((v) => JSON.stringify(cand.variants[v].low));
  check('the three low tables differ', new Set(lows).size === 3);

  const scan = (dir) => readdirSync(path.join(dir, 'assets')).filter((f) => f.endsWith('.js'))
    .filter((f) => readFileSync(path.join(dir, 'assets', f), 'utf8').includes(MARKER));
  check(`the sheet build carries the hook (control: ${MARKER} found in dist-topo)`, scan('dist-topo').length > 0);
  if (existsSync('dist/assets')) {
    const hits = scan('dist');
    check(`the normal dist/ build carries no candidate hook (${MARKER} absent)`, hits.length === 0, hits.join(', '));
  } else {
    console.log('SKIP  normal dist/ build check: dist/ is missing (run npm run build to check it)');
  }
  console.log(`\nsheet: ${path.join(OUT, 'sheet.png')}`);
} catch (e) {
  fail(e);
} finally {
  code = finish();
  await browser?.close().catch(() => {});
  server?.stop();
}
process.exit(code);
