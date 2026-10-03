# Face Mesh Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three face-mesh topology variants (Current, Flip, Flow), render them side by side on the synthetic take with wireframes and quality numbers, and after Grayson picks one, ship it as the face triangle tables and delete the rest.

**Architecture:** A pure optimizer module `tools/lib/meshOpt.mjs` (edge flips against the 3D canonical face, constraint enforcement by flips, quality report) is used by a builder `tools/lib/faceTopologyBuild.mjs` that holds the generator's existing logic plus the Flip and Flow variants. `tools/gen-face-topology.mjs` becomes a thin CLI (`--variant`, `--out`, `--emit-candidates`). A sheet-only build flag lets Playwright inject a candidate table into the renderer; a throwaway script renders the variants and wireframes into a contact sheet.

**Tech Stack:** Node 22 ESM (`.mjs`), `delaunator` (already a dependency), Vitest 5, TypeScript, Vite 6 (`define` flag), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-face-mesh-topology-design.md`

## Global Constraints
- Vertices never change (low = the ~191-point `SUBSET`, full = all 468); only triangle tables change. No change to eyes, teeth, brows, hands, looks or the neon look.
- `--variant current` must reproduce the committed `components/face/faceTopology.ts` byte for byte (after normalizing `\r\n` to `\n`).
- Triangle count bounds that existing tests pin: low 250..450 (strictly between 250 and 450), full 800..898.
- Optimizer is deterministic: no randomness, candidate edges visited in sorted `(min id, max id)` order, ties never flip (a flip needs a strict energy decrease of at least 1e-9).
- Normal builds (`npm run build`) must contain no candidate data and no topology-override branch (the marker string `__topo` must not appear in `dist/assets/*.js`).
- The sheet script builds into `dist-topo/` and never touches `dist/`.
- No new dependency. Tasks run sequentially on local `main`; no worktrees; do not push, do not deploy.
- Run the node-hog reaper before gates: `. C:\Projects-local\_agent-commons\tools\Stop-NodeHogs.ps1; Invoke-NodeHogReaper -Force`. `components/shared/recordingSchema.test.ts` "under 100ms" is a known load-sensitive flake; rerun it alone.
- Shell for Grayson is PowerShell 5.1: no `&&`; use `;`. Subagent shell tools may use either.
- The checkout is shared with other sessions: always commit with `git add <paths>` then `git commit -m ... -- <paths>`; never `git add -A`, never stash.
- Commit messages: subject line, a BLANK line, then `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
1. Degenerate or inverted triangles in the input (zero or opposite 2D area, as on the canonical mesh rim) must never be flipped across and must not crash: their triangles are frozen. (Task 1 test.)
2. A constraint edge that cannot be recovered (passes through a vertex, crosses a locked edge, or hits the flip cap) must throw with the edge or chain name, never hang. (Task 2 tests.)
3. No variant may leave an interior vertex with fewer than 3 neighbors or an edge in more than 2 triangles. (Task 4 validity tests.)
4. Lip flags must be recomputed per variant (not copied) with the existing rules. (Task 4 test.)
5. The normal build must not carry the override branch, and the sheet build must not overwrite `dist/`. (Task 5 grep step, Task 6 script.)
6. Running the CLI with no flags must still write the same file as before the refactor. (Task 3 test.)

## File Structure
- Create `tools/lib/meshOpt.mjs`: `edgeKey`, `keyEdge`, `orient2`, `buildAdjacency`, `boundaryKeys`, `valences`, `triQuality`, `dihedral`, `flowPenalty`, `totalEnergy`, `optimize`, `enforceEdge`, `enforceChains`, `qualityReport`, `formatReport`.
- Create `tools/lib/meshOpt.test.mjs`.
- Create `tools/lib/faceTopologyBuild.mjs`: `SETS`, `FLOW_CHAINS`, `loadObj`, `buildVariants`.
- Create `tools/lib/faceTopologyBuild.test.mjs`.
- Modify `tools/gen-face-topology.mjs`: thin CLI with `--variant`, `--out`, `--emit-candidates`.
- Modify `vitest.config.ts`: include `tools/**/*.test.mjs`.
- Create `components/face/topoSheetHook.ts`; modify `components/face/faceGeometry.ts`, `components/face/cavity.ts`, `components/face/cavity.test.ts`, `components/face/FaceMeshRenderer.ts`, `vite.config.ts`.
- Create `scripts/topo-sheet.mjs`; modify `scripts/lib/viewer-harness.mjs` (`startPreview(port, outDir)`), `package.json` (`topo-sheet`), `.gitignore` (`dist-topo`).
- Modify `docs/superpowers/specs/2026-10-03-face-mesh-topology-design.md` (small corrections, Task 4).

---

### Task 0: Face normal orientation fix with a regression guard, plus the looks-review corrections

Origin: the final whole-branch review of the looks work (Important 1 and 2, Minor 3, 4, 7, 8). It touches the same normals the topology pass depends on, so it lands first.

**Files:**
- Modify: `components/face/faceGeometry.ts` (normal orientation, header comment), `components/face/PuppetScene.ts` (delete the per-frame negation loop), `components/face/looks.ts` (handColor comment, `import type`), `components/face/looks.test.ts` (background equals `STAGE_BG`)
- Test: `components/face/faceGeometry.test.ts`
- Modify (docs): `HANDOFF.md`, `handoff-log/2026-10-03-face-puppet-looks.md`

**Interfaces:**
- Consumes: `updateFaceBuffers(buf, detail, lm, p, groups)`, `FaceBuffers { positions, normals, colors, faceNormals }`, `STAGE_BG` from `FaceMeshRenderer.ts`.
- Produces: after this task `buf.faceNormals` hold the OUTWARD triangle normals (unconditionally, never flipped toward the camera) and `buf.normals` hold the smoothed INWARD normals the shader expects (three flips the stored normal for back-facing triangles, and the X-mirrored mesh is drawn back-facing, so the stored normal must be the inward one). `PuppetScene` no longer touches `faceBuf.normals`.

Background (verified by the reviewer with scratch scripts): the X mirror reverses every triangle's winding, the tables are consistently wound, so the geometric outward normal is `-w` where `w = cross(P1-P0, P2-P0)` of the mirrored positions, for every triangle at every pose. Today `updateFaceBuffers` flips each normal toward +z (`if (nz < 0)`) and `PuppetScene` then negates all of them; that is right only for triangles facing the camera at the current pose, so triangles that fold when the head turns (and 2 full-mesh triangles under the nose at rest, `[458,459,461]` and `[238,241,239]`) end up lit inside-out. Reviewer numbers: current code gives an inward normal on 20/50/80 low and 72/135/236 full triangles at 30/45/60 degrees of head yaw.

- [ ] **Step 1: Write the failing tests** in `components/face/faceGeometry.test.ts` (reuse its existing helpers for building a landmark set and projection; the reviewer's scratch scripts `fold.ts` and `edges.ts` in the session scratchpad `C:\Users\Grayson\AppData\Local\Temp\claude\C--Projects-local-Tool-PuppeteerLab\b808fecb-01da-42df-8535-3b0635bf9213\scratchpad\` show how to yaw the canonical face in scene space; read them first):
  1. For the canonical face yawed by 45 degrees (and 0 and 60), at least 98% of triangles have `faceNormals` agreeing in sign with the outward direction (dot of the normal with `centroid - headCenter` is positive, where `headCenter` is the mean of the face vertices pushed back along the head's local -z by half the face depth), for both `low` and `full`.
  2. `buf.normals` is the negation of the normalized smoothed `faceNormals` per corner (so for a single-triangle crease group the stored normal is exactly `-faceNormal / |faceNormal|`).
  3. Frontal pose, existing expectation preserved: `faceNormals` are mostly +z (this already passes and must keep passing).
- [ ] **Step 2: Run to verify they fail:** `npx vitest run components/face/faceGeometry.test.ts` (expected FAIL on 1 at the yawed poses and on 2).
- [ ] **Step 3: Implement.** In `updateFaceBuffers`: delete the `if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }` line; set `FN = [-nx, -ny, -nz]` unconditionally, with a comment: the X mirror reverses every triangle's winding and the tables are consistently wound, so `-w` is the outward normal at every pose; do not flip toward the camera. In the corner loop, store the smoothed normal NEGATED (`N[...] = -x / m` etc.) with a comment: three flips the stored normal of back-facing triangles and the mirrored mesh is drawn back-facing, so the shader needs the inward normal stored. In `PuppetScene.ts` delete the per-frame negation loop and its comment (the buffers are now final). Refresh the `faceGeometry.ts` header comment (per-corner gray x tint x cavity, outward face normals, inward stored normals).
- [ ] **Step 4: Also apply the review's small corrections.** `looks.ts`: fix the `handColor` comment to say it is tuned brighter than the face for phone-size legibility; write `import type { FaceShade }` if it is imported as a value. `looks.test.ts`: add `expect(LOOK.background).toBe(parseInt(STAGE_BG.slice(1), 16))` (import `STAGE_BG` from `./FaceMeshRenderer`; if importing that file under vitest pulls in three and fails in the node environment, parse the literal from the source text with `readFileSync` instead and say so).
- [ ] **Step 5: Run and gate.** `npx vitest run components/face; npx tsc --noEmit`. Reaper first, then `npm run phone-check`, `npm run share-check`, `npm run cleanup-check`, `npm run orbit-check`, `npm run facedemo-check`. The shading of folded triangles changes by design, so a pixel gate may move: record the measured values. If orbit-check or facedemo-check fails, STOP and report the numbers (the facedemo drag margin was only about 2%); do not change thresholds yourself.
- [ ] **Step 6: Visual proof (not committed).** Screenshot the real Face Puppet stage and the share viewer at a turned-head moment into `.proof\2026-10-03-normals\` and Read one; also render the same turned pose with the previous commit's normals for a before/after if cheap (checkout is shared: do not stash or switch branches; compare against the existing `.proof\2026-10-03-neon-shipped\` images instead).
- [ ] **Step 7: Docs.** `HANDOFF.md` and `handoff-log/2026-10-03-face-puppet-looks.md`: cite the post-change export (`.proof/2026-10-03-neon-shipped/puppet-take-20261003-125429.mp4`, 242,595 B, 3.81 s, vp9 1120x900) instead of the 273,360 B one; add `scripts/facedemo-check.mjs` and `components/face/creaseGroups.test.ts` to the changed-files list; correct "face and hands now share light directions" to say it holds for every triangle after this fix (and that before it, folded triangles were still lit inside-out); correct the commit count to the actual number ahead of origin; record orbit-check's measured rest-pose value (7.21% against its 8% bound) next to the facedemo one. Do not write `_agent-commons` logs.
- [ ] **Step 8: Commit** with explicit paths: `fix(face): outward face normals and inward stored normals at every pose; regression-tested`.

---

### Task 1: Optimizer core (`meshOpt.mjs`: adjacency, energy, edge-flip optimize)

**Files:**
- Create: `tools/lib/meshOpt.mjs`
- Create: `tools/lib/meshOpt.test.mjs`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (signatures later tasks rely on):
  ```js
  edgeKey(a, b) -> number            // a*1024+b with a<b; vertex ids < 1024
  keyEdge(key) -> [a, b]
  orient2(p, q, r) -> number         // 2D signed double-area
  buildAdjacency(tris) -> Map<key, number[]>   // triangle indices per edge
  boundaryKeys(tris) -> Set<key>     // edges in exactly one triangle
  valences(adj) -> Map<vertex, number>
  triQuality(pos3, t) -> number      // 4*sqrt(3)*area / sum(edge^2), 1 = equilateral
  dihedral(pos3, t1, t2) -> number   // radians between unit normals
  flowPenalty(pos2, centers, a, b) -> number
  totalEnergy(tris, { pos2, pos3, wQuality, wValence, wDihedral, wFlow, centers }) -> number
  optimize(tris, { pos2, pos3, locked?: Set<key>, wQuality?: 1, wValence?: 0.1, wDihedral?: 1, wFlow?: 0, centers?: [], maxSweeps?: 50 })
    -> { tris, flips, sweeps, frozen }
  // pos2 / pos3: arrays indexed by vertex id: pos2[i] = [x, y], pos3[i] = [x, y, z]
  // centers: [{ c: [x, y], r }]
  ```

- [ ] **Step 1: Add the vitest include.** In `vitest.config.ts` change `include` to `['**/*.test.ts', 'server/**/*.test.mjs', 'tools/**/*.test.mjs']`.

- [ ] **Step 2: Write the failing tests** `tools/lib/meshOpt.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { edgeKey, keyEdge, orient2, buildAdjacency, boundaryKeys, valences, totalEnergy, optimize } from './meshOpt.mjs';

/** n x n vertex grid; every cell split along the same diagonal; pos3 gets a bumpy height field. */
function grid(n, bumpy = true) {
  const pos2 = [], pos3 = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    pos2.push([c, r]);
    const z = bumpy ? 0.9 * Math.sin(1.7 * c + 0.9 * r) + 0.6 * Math.cos(2.3 * r - c) : 0;
    pos3.push([c, r, z]);
  }
  const id = (r, c) => r * n + c;
  const tris = [];
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) {
    tris.push([id(r, c), id(r, c + 1), id(r + 1, c + 1)], [id(r, c), id(r + 1, c + 1), id(r + 1, c)]);
  }
  return { pos2, pos3, tris, id };
}
const signs = (tris, pos2) => tris.map((t) => Math.sign(orient2(pos2[t[0]], pos2[t[1]], pos2[t[2]])));
const verts = (tris) => [...new Set(tris.flat())].sort((a, b) => a - b);

describe('meshOpt basics', () => {
  it('edgeKey is symmetric and invertible', () => {
    expect(edgeKey(5, 9)).toBe(edgeKey(9, 5));
    expect(keyEdge(edgeKey(467, 3))).toEqual([3, 467]);
  });
  it('adjacency, boundary and valence of a 2x2 cell', () => {
    const { tris } = grid(2, false);
    const adj = buildAdjacency(tris);
    expect(adj.get(edgeKey(0, 3))).toHaveLength(2); // the shared diagonal
    expect(boundaryKeys(tris).size).toBe(4);
    expect(valences(adj).get(0)).toBe(3);
  });
});

describe('optimize', () => {
  // A long diagonal over a flat diamond flips to the short one (quality only).
  const diamond = () => ({
    pos2: [[0, 0], [4, 0], [2, 1], [2, -1]],
    pos3: [[0, 0, 0], [4, 0, 0], [2, 1, 0], [2, -1, 0]],
    tris: [[0, 1, 2], [1, 0, 3]], // u=0 v=1 c=2 d=3, shared edge 0-1
  });
  const qOnly = { wQuality: 1, wValence: 0, wDihedral: 0 };

  it('flips a long diagonal to the better-shaped one', () => {
    const { pos2, pos3, tris } = diamond();
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.flips).toBe(1);
    const adj = buildAdjacency(r.tris);
    expect(adj.has(edgeKey(2, 3))).toBe(true);
    expect(adj.has(edgeKey(0, 1))).toBe(false);
    expect(signs(r.tris, pos2)).toEqual([1, 1]);
  });

  it('never flips a locked edge', () => {
    const { pos2, pos3, tris } = diamond();
    const r = optimize(tris, { pos2, pos3, ...qOnly, locked: new Set([edgeKey(0, 1)]) });
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
  });

  it('never flips when the quad is not convex (no fold-over)', () => {
    const pos2 = [[0, 0], [2, 0], [5, 1], [1, -1]];
    const pos3 = pos2.map(([x, y]) => [x, y, 0]);
    const tris = [[0, 1, 2], [1, 0, 3]];
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
  });

  it('prefers the diagonal with the smaller dihedral (dihedral only)', () => {
    // Unit square a b c d with only d lifted. Diagonal b-d gives 60 degrees, a-c gives 54.7: b-d must flip to a-c.
    const pos2 = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const pos3 = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 1]];
    const tris = [[0, 1, 3], [1, 2, 3]]; // diagonal 1-3 (b-d)
    const r = optimize(tris, { pos2, pos3, wQuality: 0, wValence: 0, wDihedral: 1 });
    expect(r.flips).toBe(1);
    expect(buildAdjacency(r.tris).has(edgeKey(0, 2))).toBe(true);
  });

  it('freezes degenerate and inverted triangles instead of flipping across them', () => {
    // Triangle 1 is collinear (zero area): the edge it shares with triangle 0 must stay.
    const pos2 = [[0, 0], [2, 0], [1, 1], [4, 0]];
    const pos3 = pos2.map(([x, y]) => [x, y, 0]);
    const tris = [[0, 1, 2], [1, 3, 0]];
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.frozen).toBeGreaterThan(0);
    expect(r.flips).toBe(0);
  });

  it('on a bumpy grid: keeps vertices, count, boundary and winding, lowers energy, and is deterministic', () => {
    const { pos2, pos3, tris } = grid(6);
    const opts = { pos2, pos3, wQuality: 1, wValence: 0.1, wDihedral: 1 };
    const r1 = optimize(tris, opts);
    const r2 = optimize(tris, opts);
    expect(r2.tris).toEqual(r1.tris);
    expect(r1.flips).toBeGreaterThan(0);
    expect(r1.sweeps).toBeLessThanOrEqual(50);
    expect(r1.tris).toHaveLength(tris.length);
    expect(verts(r1.tris)).toEqual(verts(tris));
    expect([...boundaryKeys(r1.tris)].sort()).toEqual([...boundaryKeys(tris)].sort());
    expect(new Set(signs(r1.tris, pos2))).toEqual(new Set([1]));
    expect(totalEnergy(r1.tris, opts)).toBeLessThan(totalEnergy(tris, opts));
    for (const l of buildAdjacency(r1.tris).values()) expect(l.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run to verify they fail**
Run: `npx vitest run tools/lib/meshOpt.test.mjs`
Expected: FAIL (cannot resolve `./meshOpt.mjs`).

- [ ] **Step 4: Write `tools/lib/meshOpt.mjs`**

```js
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Triangle-mesh edge optimization for the face topology generator (tools/gen-face-topology.mjs). Pure functions over
 * triangle lists (arrays of 3 vertex ids, consistently wound in the 2D frontal projection) with per-vertex positions
 * pos2[i] = [x, y] (the projection the triangulation lives in) and pos3[i] = [x, y, z] (the canonical face in 3D).
 *
 * Edge-flip optimization: a flip replaces the shared edge of two triangles with the other diagonal of their quad. It is
 * applied only when the quad is strictly convex in 2D (no fold-over), the edge is neither locked nor on the boundary,
 * and the exact change in a global energy is strictly negative, so the sweeps terminate and the result is deterministic.
 * Energy = wQuality * sum(1 - triangle quality) + wValence * sum((valence - target)^2)
 *        + wDihedral * sum(dihedral over interior edges) + wFlow * sum(flow penalty over interior edges).
 */
export const edgeKey = (a, b) => (a < b ? a * 1024 + b : b * 1024 + a);
export const keyEdge = (k) => [Math.floor(k / 1024), k % 1024];
export const orient2 = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

const EPS = 1e-9;
const DEFAULTS = { wQuality: 1, wValence: 0.1, wDihedral: 1, wFlow: 0, centers: [], maxSweeps: 50 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

export function buildAdjacency(tris) {
  const adj = new Map();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(t[k], t[(k + 1) % 3]);
      const l = adj.get(key);
      if (l) l.push(i); else adj.set(key, [i]);
    }
  });
  return adj;
}

export function boundaryKeys(tris) {
  const out = new Set();
  for (const [k, l] of buildAdjacency(tris)) if (l.length === 1) out.add(k);
  return out;
}

export function valences(adj) {
  const v = new Map();
  for (const k of adj.keys()) {
    const [a, b] = keyEdge(k);
    v.set(a, (v.get(a) ?? 0) + 1);
    v.set(b, (v.get(b) ?? 0) + 1);
  }
  return v;
}

function boundaryVertices(bnd) {
  const s = new Set();
  for (const k of bnd) { const [a, b] = keyEdge(k); s.add(a); s.add(b); }
  return s;
}

export function triQuality(pos3, t) {
  const a = pos3[t[0]], b = pos3[t[1]], c = pos3[t[2]];
  const ab = sub(b, a), ac = sub(c, a), bc = sub(c, b);
  const area = 0.5 * len(cross(ab, ac));
  const s = dot(ab, ab) + dot(ac, ac) + dot(bc, bc);
  return s > 0 ? (4 * Math.sqrt(3) * area) / s : 0;
}

function unitNormal(pos3, t) {
  const a = pos3[t[0]], b = pos3[t[1]], c = pos3[t[2]];
  const n = cross(sub(b, a), sub(c, a));
  const l = len(n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function dihedral(pos3, t1, t2) {
  return Math.acos(Math.max(-1, Math.min(1, dot(unitNormal(pos3, t1), unitNormal(pos3, t2)))));
}

/** 0 (edge tangent to the nearest feature ring) .. 1 (edge pointing radially at it); only near a feature center. */
export function flowPenalty(pos2, centers, a, b) {
  let worst = 0;
  const mx = (pos2[a][0] + pos2[b][0]) / 2, my = (pos2[a][1] + pos2[b][1]) / 2;
  const ex = pos2[b][0] - pos2[a][0], ey = pos2[b][1] - pos2[a][1];
  const el = Math.hypot(ex, ey) || 1;
  for (const { c, r } of centers) {
    const dx = mx - c[0], dy = my - c[1];
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-9 || dl > 2.2 * r) continue;
    const p = (1 - dl / (2.2 * r)) * Math.abs((ex / el) * (dx / dl) + (ey / el) * (dy / dl));
    if (p > worst) worst = p;
  }
  return worst;
}

export function totalEnergy(tris, { pos2, pos3, ...opts }) {
  const o = { ...DEFAULTS, ...opts };
  const adj = buildAdjacency(tris);
  const val = valences(adj);
  const bv = boundaryVertices(boundaryKeys(tris));
  let e = 0;
  for (const t of tris) e += o.wQuality * (1 - triQuality(pos3, t));
  for (const [x, n] of val) e += o.wValence * (n - (bv.has(x) ? 4 : 6)) ** 2;
  for (const [k, l] of adj) {
    if (l.length !== 2) continue;
    const [a, b] = keyEdge(k);
    e += o.wDihedral * dihedral(pos3, tris[l[0]], tris[l[1]]);
    e += o.wFlow * flowPenalty(pos2, o.centers, a, b);
  }
  return e;
}

/** Winding sign of the mesh (majority) and the indices of triangles that are degenerate or wound the other way. */
function windingInfo(tris, pos2) {
  const area = tris.map((t) => orient2(pos2[t[0]], pos2[t[1]], pos2[t[2]]));
  let pos = 0, neg = 0;
  for (const a of area) { if (a > EPS) pos++; else if (a < -EPS) neg++; }
  const sign0 = pos >= neg ? 1 : -1;
  const frozen = new Set();
  area.forEach((a, i) => { if (a * sign0 <= EPS) frozen.add(i); });
  return { sign0, frozen };
}

/** The geometric part of flipping edge `key`: returns the two replacement triangles, or null if the flip is invalid. */
function flipCandidate(tris, adj, key, pos2, sign0, frozen) {
  const l = adj.get(key);
  if (!l || l.length !== 2) return null;
  const [i1, i2] = l;
  if (frozen.has(i1) || frozen.has(i2)) return null;
  const T1 = tris[i1], T2 = tris[i2];
  let u = -1, v = -1, c = -1;
  for (let k = 0; k < 3; k++) {
    if (edgeKey(T1[k], T1[(k + 1) % 3]) === key) { u = T1[k]; v = T1[(k + 1) % 3]; c = T1[(k + 2) % 3]; }
  }
  let d = -1;
  for (let k = 0; k < 3; k++) if (T2[k] === v && T2[(k + 1) % 3] === u) d = T2[(k + 2) % 3];
  if (u < 0 || d < 0) return null; // inconsistent winding across the edge
  if (adj.has(edgeKey(c, d))) return null;
  const n1 = [u, d, c], n2 = [d, v, c];
  const s1 = orient2(pos2[n1[0]], pos2[n1[1]], pos2[n1[2]]) * sign0;
  const s2 = orient2(pos2[n2[0]], pos2[n2[1]], pos2[n2[2]]) * sign0;
  if (!(s1 > EPS && s2 > EPS)) return null; // not strictly convex
  return { i1, i2, u, v, c, d, n1, n2 };
}

/** Exact change of the global energy if the flip were applied (negative = better). */
function flipDelta(tris, adj, val, bv, f, o, pos2, pos3) {
  const { i1, i2, u, v, c, d, n1, n2 } = f;
  const T1 = tris[i1], T2 = tris[i2];
  const vp = (x, dv) => (val.get(x) + dv - (bv.has(x) ? 4 : 6)) ** 2;
  const outside = (a, b) => {
    const l = adj.get(edgeKey(a, b));
    const j = l ? l.find((x) => x !== i1 && x !== i2) : undefined;
    return j === undefined ? null : tris[j];
  };
  let before = o.wQuality * (2 - triQuality(pos3, T1) - triQuality(pos3, T2));
  let after = o.wQuality * (2 - triQuality(pos3, n1) - triQuality(pos3, n2));
  before += o.wValence * (vp(u, 0) + vp(v, 0) + vp(c, 0) + vp(d, 0));
  after += o.wValence * (vp(u, -1) + vp(v, -1) + vp(c, 1) + vp(d, 1));
  before += o.wDihedral * dihedral(pos3, T1, T2);
  after += o.wDihedral * dihedral(pos3, n1, n2);
  for (const [a, b, oldT, newT] of [[u, c, T1, n1], [c, v, T1, n2], [v, d, T2, n2], [d, u, T2, n1]]) {
    const N = outside(a, b);
    if (!N) continue;
    before += o.wDihedral * dihedral(pos3, oldT, N);
    after += o.wDihedral * dihedral(pos3, newT, N);
  }
  before += o.wFlow * flowPenalty(pos2, o.centers, u, v);
  after += o.wFlow * flowPenalty(pos2, o.centers, c, d);
  return after - before;
}

export function optimize(trisIn, { pos2, pos3, locked = new Set(), ...opts }) {
  const o = { ...DEFAULTS, ...opts };
  const tris = trisIn.map((t) => t.slice());
  const { sign0, frozen } = windingInfo(tris, pos2);
  const bnd = boundaryKeys(tris);
  const bv = boundaryVertices(bnd);
  let adj = buildAdjacency(tris);
  let val = valences(adj);
  let flips = 0, sweeps = 0;
  while (sweeps < o.maxSweeps) {
    sweeps++;
    let changed = 0;
    for (const key of [...adj.keys()].sort((x, y) => x - y)) {
      if (locked.has(key) || bnd.has(key)) continue;
      const f = flipCandidate(tris, adj, key, pos2, sign0, frozen);
      if (!f) continue;
      if (flipDelta(tris, adj, val, bv, f, o, pos2, pos3) < -EPS) {
        tris[f.i1] = f.n1;
        tris[f.i2] = f.n2;
        adj = buildAdjacency(tris);
        val = valences(adj);
        flips++;
        changed++;
      }
    }
    if (!changed) break;
  }
  return { tris, flips, sweeps, frozen: frozen.size };
}

// Task 2 appends enforceEdge, enforceChains, qualityReport and formatReport below this line; they reuse windingInfo
// and flipCandidate (keep those two module-private helpers in this file).
```

- [ ] **Step 5: Run to verify they pass**
Run: `npx vitest run tools/lib/meshOpt.test.mjs`
Expected: PASS (7 tests). If "flips a long diagonal" or "prefers the smaller dihedral" fails, recheck the hand-computed geometry in the test comments before touching the optimizer; if "bumpy grid ... flips > 0" fails with 0 flips, increase the height amplitudes in `grid` (the test only needs a surface where some cell prefers the other diagonal).

- [ ] **Step 6: Commit**
```
git add tools/lib/meshOpt.mjs tools/lib/meshOpt.test.mjs vitest.config.ts
git commit -m "feat(tools): edge-flip mesh optimizer with exact energy delta" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- tools/lib/meshOpt.mjs tools/lib/meshOpt.test.mjs vitest.config.ts
```
(Use a real blank line between subject and trailer: build the message with two `-m` args as shown, or a heredoc.)

---

### Task 2: Constraint enforcement and quality report (`meshOpt.mjs`)

**Files:**
- Modify: `tools/lib/meshOpt.mjs` (append)
- Modify: `tools/lib/meshOpt.test.mjs` (append)

**Interfaces:**
- Consumes: `windingInfo`, `flipCandidate`, `buildAdjacency`, `boundaryKeys`, `valences`, `edgeKey`, `keyEdge`, `orient2` from Task 1.
- Produces:
  ```js
  enforceEdge(tris, pos2, a, b, locked = new Set(), maxFlips = 5000) -> { tris, flips }   // throws Error on failure
  enforceChains(tris, pos2, chains, { locked } = {}) -> { tris, locked: Set<key>, flips, dropped: string[] }
  // chains: [{ name: string, ids: number[], optional?: boolean }]; consecutive ids are enforced as edges and locked.
  // A failing non-optional chain throws Error(`chain "<name>": ...`); a failing optional chain is rolled back and its name goes in `dropped`.
  qualityReport(tris, pos3) -> {
    tris, minAngleMin, minAngleMean, slivers20, aspectOver3,
    interiorVertices, valenceHistogram: { [valence]: count }, valenceShare5to7, dihedralMean, dihedral90   // angles in degrees
  }
  formatReport(name, r) -> string   // one block of text
  ```

- [ ] **Step 1: Append failing tests** to `tools/lib/meshOpt.test.mjs` (reuse its `grid`, `signs`, `verts` helpers and extend its import with `enforceEdge, enforceChains, qualityReport, formatReport`)

```js
describe('enforceEdge / enforceChains', () => {
  it('forces an edge across several crossings without changing the triangle count', () => {
    const { pos2, tris, id } = grid(5, false);
    const a = id(0, 0), b = id(1, 3); // segment (0,0)-(3,1): crosses several cell edges
    expect(buildAdjacency(tris).has(edgeKey(a, b))).toBe(false);
    const r = enforceEdge(tris, pos2, a, b);
    expect(r.flips).toBeGreaterThan(0);
    expect(buildAdjacency(r.tris).has(edgeKey(a, b))).toBe(true);
    expect(r.tris).toHaveLength(tris.length);
    expect(verts(r.tris)).toEqual(verts(tris));
    expect(new Set(signs(r.tris, pos2))).toEqual(new Set([1]));
  });

  it('throws when the constraint crosses a locked edge', () => {
    const { pos2, tris, id } = grid(5, false);
    const locked = new Set([edgeKey(id(0, 1), id(1, 1))]); // vertical edge x=1, crossed by (0,0)-(3,1)
    expect(() => enforceEdge(tris, pos2, id(0, 0), id(1, 3), locked)).toThrow(/locked/);
  });

  it('throws (never hangs) when the segment passes exactly through another vertex', () => {
    const { pos2, tris, id } = grid(5, false);
    expect(() => enforceEdge(tris, pos2, id(0, 0), id(2, 2))).toThrow(/cannot be enforced/);
  });

  it('enforces a chain and locks its edges; an unrecoverable optional chain is dropped and rolled back', () => {
    const { pos2, tris, id } = grid(5, false);
    const good = { name: 'good', ids: [id(0, 0), id(1, 2), id(0, 4)] };
    const bad = { name: 'bad', ids: [id(0, 0), id(2, 2)], optional: true };
    const r = enforceChains(tris, pos2, [good, bad]);
    expect(r.dropped).toEqual(['bad']);
    const adj = buildAdjacency(r.tris);
    expect(adj.has(edgeKey(id(0, 0), id(1, 2)))).toBe(true);
    expect(adj.has(edgeKey(id(1, 2), id(0, 4)))).toBe(true);
    expect(r.locked.has(edgeKey(id(0, 0), id(1, 2)))).toBe(true);
    expect(r.locked.has(edgeKey(id(0, 0), id(2, 2)))).toBe(false);
    expect(() => enforceChains(tris, pos2, [{ name: 'must', ids: [id(0, 0), id(2, 2)] }])).toThrow(/chain "must"/);
  });
});

describe('qualityReport', () => {
  it('describes a flat unit grid: right isosceles triangles, valence 6 inside', () => {
    const { pos3, tris } = grid(5, false);
    const r = qualityReport(tris, pos3);
    expect(r.tris).toBe(32);
    expect(r.minAngleMin).toBeCloseTo(45, 5);
    expect(r.minAngleMean).toBeCloseTo(45, 5);
    expect(r.slivers20).toBe(0);
    expect(r.aspectOver3).toBe(0);
    expect(r.interiorVertices).toBe(9);
    expect(r.valenceShare5to7).toBe(1);
    expect(r.dihedralMean).toBeCloseTo(0, 5);
    expect(formatReport('flat', r)).toMatch(/flat/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**
Run: `npx vitest run tools/lib/meshOpt.test.mjs`
Expected: FAIL (`enforceEdge` etc. not exported).

- [ ] **Step 3: Replace the trailing comment** in `tools/lib/meshOpt.mjs` with:

```js
/** Proper intersection (not at endpoints) of segments a-b and p-q in 2D. */
const crosses = (pos2, a, b, p, q) => {
  const A = pos2[a], B = pos2[b], P = pos2[p], Q = pos2[q];
  return orient2(A, B, P) * orient2(A, B, Q) < 0 && orient2(P, Q, A) * orient2(P, Q, B) < 0;
};

/**
 * Makes edge a-b present by flipping the edges that cross it (convex quads only). Throws if it crosses a locked edge,
 * if no crossing edge can be flipped (for example the segment passes through another vertex), or after `maxFlips`.
 */
export function enforceEdge(trisIn, pos2, a, b, locked = new Set(), maxFlips = 5000) {
  const tris = trisIn.map((t) => t.slice());
  const { sign0, frozen } = windingInfo(tris, pos2);
  const target = edgeKey(a, b);
  let flips = 0;
  for (;;) {
    const adj = buildAdjacency(tris);
    if (adj.has(target)) return { tris, flips };
    if (flips >= maxFlips) throw new Error(`edge ${a}-${b} cannot be enforced: flip cap reached`);
    const crossing = [...adj.keys()].sort((x, y) => x - y).filter((k) => {
      const [p, q] = keyEdge(k);
      return p !== a && p !== b && q !== a && q !== b && crosses(pos2, a, b, p, q);
    });
    if (!crossing.length) throw new Error(`edge ${a}-${b} cannot be enforced: no crossing edge to flip`);
    let done = false;
    for (const k of crossing) {
      if (locked.has(k)) {
        const [p, q] = keyEdge(k);
        throw new Error(`edge ${a}-${b} crosses locked edge ${p}-${q}`);
      }
      const f = flipCandidate(tris, adj, k, pos2, sign0, frozen);
      if (f) { tris[f.i1] = f.n1; tris[f.i2] = f.n2; flips++; done = true; break; }
    }
    if (!done) throw new Error(`edge ${a}-${b} cannot be enforced: no convex crossing edge`);
  }
}

/** Enforces each chain's consecutive edges in order and locks them. See the plan for the optional-chain rollback rule. */
export function enforceChains(trisIn, pos2, chains, { locked = new Set() } = {}) {
  let cur = trisIn;
  const lockedOut = new Set(locked);
  let flips = 0;
  const dropped = [];
  for (const ch of chains) {
    const added = [];
    try {
      let t = cur;
      for (let i = 0; i + 1 < ch.ids.length; i++) {
        const r = enforceEdge(t, pos2, ch.ids[i], ch.ids[i + 1], lockedOut);
        t = r.tris;
        flips += r.flips;
        const k = edgeKey(ch.ids[i], ch.ids[i + 1]);
        if (!lockedOut.has(k)) { lockedOut.add(k); added.push(k); }
      }
      cur = t;
    } catch (e) {
      for (const k of added) lockedOut.delete(k);
      if (!ch.optional) throw new Error(`chain "${ch.name}": ${e.message}`);
      dropped.push(ch.name);
    }
  }
  return { tris: cur, locked: lockedOut, flips, dropped };
}

const deg = (r) => (r * 180) / Math.PI;

export function qualityReport(tris, pos3) {
  const adj = buildAdjacency(tris);
  const val = valences(adj);
  const bv = boundaryVertices(boundaryKeys(tris));
  const minAngles = [];
  let aspectOver3 = 0;
  for (const t of tris) {
    const [a, b, c] = t.map((i) => pos3[i]);
    const la = len(sub(b, c)), lb = len(sub(a, c)), lc = len(sub(a, b));
    const ang = (opp, s1, s2) => deg(Math.acos(Math.max(-1, Math.min(1, (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2 || 1)))));
    minAngles.push(Math.min(ang(la, lb, lc), ang(lb, la, lc), ang(lc, la, lb)));
    const area = 0.5 * len(cross(sub(b, a), sub(c, a)));
    const longest = Math.max(la, lb, lc);
    if (!(area > 0) || (longest * longest) / (2 * area) > 3) aspectOver3++;
  }
  const hist = {};
  let interior = 0, ok = 0;
  for (const [x, n] of val) {
    if (bv.has(x)) continue;
    interior++;
    hist[n] = (hist[n] ?? 0) + 1;
    if (n >= 5 && n <= 7) ok++;
  }
  const dih = [];
  for (const l of adj.values()) if (l.length === 2) dih.push(deg(dihedral(pos3, tris[l[0]], tris[l[1]])));
  dih.sort((x, y) => x - y);
  return {
    tris: tris.length,
    minAngleMin: Math.min(...minAngles),
    minAngleMean: minAngles.reduce((s, x) => s + x, 0) / minAngles.length,
    slivers20: minAngles.filter((x) => x < 20).length,
    aspectOver3,
    interiorVertices: interior,
    valenceHistogram: hist,
    valenceShare5to7: interior ? ok / interior : 0,
    dihedralMean: dih.length ? dih.reduce((s, x) => s + x, 0) / dih.length : 0,
    dihedral90: dih.length ? dih[Math.floor(0.9 * (dih.length - 1))] : 0,
  };
}

export function formatReport(name, r) {
  const f = (x) => x.toFixed(2);
  return [
    `${name}: ${r.tris} triangles`,
    `  min angle: worst ${f(r.minAngleMin)} deg, mean ${f(r.minAngleMean)} deg; under 20 deg: ${r.slivers20}; aspect over 3: ${r.aspectOver3}`,
    `  interior valence: ${JSON.stringify(r.valenceHistogram)} (${(100 * r.valenceShare5to7).toFixed(1)}% at 5..7 of ${r.interiorVertices})`,
    `  dihedral across interior edges: mean ${f(r.dihedralMean)} deg, 90th percentile ${f(r.dihedral90)} deg`,
  ].join('\n');
}
```

- [ ] **Step 4: Run to verify they pass**
Run: `npx vitest run tools/lib/meshOpt.test.mjs`
Expected: PASS. If the chain test `(0,0)-(1,2)` or `(1,2)-(0,4)` unexpectedly throws (collinear with a lattice vertex), pick chain vertices on the 5x5 grid that avoid collinearity with any other vertex and keep the intent (a two-edge chain across several crossings); keep the `(0,0)-(2,2)` case as the unrecoverable one.

- [ ] **Step 5: Commit** (same pattern as Task 1, paths `tools/lib/meshOpt.mjs tools/lib/meshOpt.test.mjs`): `feat(tools): constraint enforcement by edge flips and a mesh quality report`.

---

### Task 3: Refactor the generator into a builder plus CLI, with `--variant current` byte-identical

**Files:**
- Create: `tools/lib/faceTopologyBuild.mjs` (only the `current` variant in this task)
- Create: `tools/lib/faceTopologyBuild.test.mjs`
- Modify: `tools/gen-face-topology.mjs`

**Interfaces:**
- Consumes: existing generator logic (moved, not rewritten).
- Produces:
  ```js
  // faceTopologyBuild.mjs
  export const SETS = { FACE_OVAL, LIPS_OUTER, LIPS_INNER_UPPER, LIPS_INNER_LOWER, LIPS_INNER, L_EYE_LOWER, L_EYE_UPPER, R_EYE_LOWER, R_EYE_UPPER,
                        LEFT_EYE, RIGHT_EYE, LEFT_EYEBROW, RIGHT_EYEBROW, NOSE, FILL, MOCAP_POINTS, SUBSET };
  export function loadObj(objPath) -> { V, F }          // V: 468 x [x,y,z], F: faces as 0-based id triples
  export function buildVariants(objPath) -> {
    V, F, SUBSET,
    variants: { current: { low: { tris, isLip, removed }, full: { tris, isLip, removed } } }   // tris: number[][]; isLip: (0|1)[]
  }
  // CLI: node tools/gen-face-topology.mjs [obj] [--variant current|flip|flow] [--out path] [--emit-candidates path]
  // Defaults: obj tools/data/canonical_face_model.obj, variant current, out components/face/faceTopology.ts.
  ```
  `removed` for low is `{ outside, mouth, eyes }` and for full `{ mouth, eyes }` (the counts the file header prints today).

- [ ] **Step 1: Check the committed table is reproducible BEFORE changing anything.** Run (PowerShell):
`node tools/gen-face-topology.mjs; git diff --stat -- components/face/faceTopology.ts`
Then compare ignoring line endings: `node -e "const {execSync}=require('child_process');const a=execSync('git show HEAD:components/face/faceTopology.ts').toString().replace(/\r\n/g,'\n');const b=require('fs').readFileSync('components/face/faceTopology.ts','utf8').replace(/\r\n/g,'\n');console.log(a===b?'IDENTICAL':'DRIFT')"`
Expected: `IDENTICAL`. If `DRIFT`, STOP: `git checkout -- components/face/faceTopology.ts` and report BLOCKED with the diff summary (the committed table was edited by hand or the generator changed); do not continue.

- [ ] **Step 2: Write the tests** `tools/lib/faceTopologyBuild.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVariants, SETS } from './faceTopologyBuild.mjs';

const OBJ = 'tools/data/canonical_face_model.obj';
const norm = (s) => s.replace(/\r\n/g, '\n');

describe('generator CLI', () => {
  it('--variant current reproduces the committed faceTopology.ts exactly', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'faceTopology.ts');
    const r = spawnSync(process.execPath, ['tools/gen-face-topology.mjs', '--variant', 'current', '--out', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(norm(readFileSync(out, 'utf8'))).toBe(norm(readFileSync('components/face/faceTopology.ts', 'utf8')));
  });
  it('rejects an unknown variant', () => {
    const r = spawnSync(process.execPath, ['tools/gen-face-topology.mjs', '--variant', 'nope', '--out', path.join(os.tmpdir(), 'x.ts')], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
  });
});

describe('buildVariants (current)', () => {
  const B = buildVariants(OBJ);
  it('has the shipped sizes', () => {
    expect(B.V).toHaveLength(468);
    expect(B.SUBSET).toEqual(SETS.SUBSET);
    expect(B.variants.current.low.tris.length).toBe(298);
    expect(B.variants.current.full.tris.length).toBe(840);
    expect(B.variants.current.low.isLip).toHaveLength(298);
    expect(B.variants.current.full.isLip).toHaveLength(840);
  });
});
```

- [ ] **Step 3: Run to verify they fail**
Run: `npx vitest run tools/lib/faceTopologyBuild.test.mjs`
Expected: FAIL (module missing; CLI has no `--out`).

- [ ] **Step 4: Refactor.**
  - Create `tools/lib/faceTopologyBuild.mjs`. MOVE (copy verbatim, do not rewrite) from `tools/gen-face-topology.mjs`: the OBJ parsing (into `loadObj`), the landmark constants (into the exported `SETS`, plus `SUBSET`), `inPoly`, `spans`, `isHoleTri`, the Delaunay + oval cut + hole cut loop (low), the canonical-faces hole cut (full), `LIP_SET`/`lipFlags`/`lipFlagsFull`. Wrap them in `buildVariants(objPath)` returning the structure above (`P` is `(i) => [V[i][0], -V[i][1]]`). Keep `import Delaunator from 'delaunator'`.
  - Rewrite `tools/gen-face-topology.mjs` as a thin CLI: parse args (`--variant`, `--out`, `--emit-candidates`, first positional = obj path, defaults as in Interfaces), call `buildVariants`, pick `variants[variant]` (exit non-zero with a message for an unknown variant or a variant that does not exist yet: in this task only `current` exists), and write the same TypeScript text as before using the chosen variant's `low`/`full` tables and `removed` counts and the OBJ's `V`. Keep the output template text, the header numbers (`SUBSET.length`, triangle counts, `removed` counts) and the trailing console output identical. `--emit-candidates` is accepted but only implemented in Task 4 (for now: if given, print `not available yet` and exit non-zero).
  - Pairs/`r4`/`arr` helpers used by the template stay in the CLI.

- [ ] **Step 5: Run the tests and the generator regression**
Run: `npx vitest run tools/lib/faceTopologyBuild.test.mjs components/face/faceTopology.test.ts` then the Step 1 comparison again after `node tools/gen-face-topology.mjs`.
Expected: all PASS, `IDENTICAL` (and `git status --short components/face/faceTopology.ts` shows no change ignoring line endings: if git shows a modification, `git checkout -- components/face/faceTopology.ts`).

- [ ] **Step 6: Typecheck and commit**
Run: `npx tsc --noEmit` (clean). Commit paths: `tools/lib/faceTopologyBuild.mjs tools/lib/faceTopologyBuild.test.mjs tools/gen-face-topology.mjs`: `refactor(tools): split the topology generator into a builder and a CLI`.

---

### Task 4: Flip and Flow variants, candidate emission, validity tests, spec corrections

**Files:**
- Modify: `tools/lib/faceTopologyBuild.mjs`, `tools/gen-face-topology.mjs`, `tools/lib/faceTopologyBuild.test.mjs`
- Modify: `docs/superpowers/specs/2026-10-03-face-mesh-topology-design.md`

**Interfaces:**
- Consumes: `optimize`, `enforceChains`, `qualityReport`, `formatReport`, `edgeKey`, `keyEdge`, `buildAdjacency`, `boundaryKeys`, `orient2` from `meshOpt.mjs`.
- Produces:
  ```js
  export const FLIP_OPTS = { wQuality: 1, wValence: 0.1, wDihedral: 1 };
  export const FLOW_OPTS = { ...FLIP_OPTS, wFlow: 0.3 };
  export const FLOW_CHAINS: { name: string; ids: number[]; optional?: boolean }[];
  buildVariants(objPath) -> { V, F, SUBSET,
    variants: { current, flip, flow },                // each { low: {tris, isLip, removed}, full: {tris, isLip, removed} }
    stats: { flip: { low: {flips, sweeps, frozen}, full: {...} }, flow: { low: {flips, sweeps, frozen, enforcedFlips, dropped: string[]}, full: <same as flip.full> } },
    reports: string }                                  // formatted quality report text for all variants and meshes
  // CLI --emit-candidates <path> writes JSON:
  // { verts: number[] (468*3, 4 decimals), variants: { [name]: { low: {tris: number[] (flat), isLip}, full: {...} } }, stats, report }
  ```
  `flow.full` equals `flip.full` (the optimized canonical table).

- [ ] **Step 1: Write the failing validity tests** (append to `tools/lib/faceTopologyBuild.test.mjs`; extend its imports with `edgeKey, keyEdge, buildAdjacency, boundaryKeys, orient2, qualityReport, totalEnergy` from `./meshOpt.mjs` and `FLIP_OPTS, FLOW_OPTS, FLOW_CHAINS` from the builder)

```js
describe('variants: validity', () => {
  const B = buildVariants(OBJ);
  const pos2 = B.V.map((v) => [v[0], -v[1]]);
  const pos3 = B.V;
  const ring = (ids) => ids.map((x, i) => edgeKey(x, ids[(i + 1) % ids.length]));
  const lidsL = [SETS.L_EYE_UPPER, SETS.L_EYE_LOWER], lidsR = [SETS.R_EYE_UPPER, SETS.R_EYE_LOWER];
  const spans = (t, a, b) => t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));
  const lipSet = new Set([...SETS.LIPS_OUTER, ...SETS.LIPS_INNER]);

  for (const name of ['current', 'flip', 'flow']) {
    for (const mesh of ['low', 'full']) {
      describe(`${name} ${mesh}`, () => {
        const m = B.variants[name][mesh];
        it('is manifold with no duplicate triangles and valid ids', () => {
          for (const l of buildAdjacency(m.tris).values()) expect(l.length).toBeLessThanOrEqual(2);
          const seen = new Set(m.tris.map((t) => [...t].sort((a, b) => a - b).join(',')));
          expect(seen.size).toBe(m.tris.length);
          expect(m.tris.flat().every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
          expect(m.isLip).toHaveLength(m.tris.length);
        });
        it('has consistent winding (degenerate triangles aside)', () => {
          const a = m.tris.map((t) => orient2(pos2[t[0]], pos2[t[1]], pos2[t[2]])).filter((x) => Math.abs(x) > 1e-9);
          const pos = a.filter((x) => x > 0).length;
          expect(Math.min(pos, a.length - pos) / a.length).toBeLessThan(0.01);
        });
        it('keeps every interior vertex at 3 or more neighbors', () => {
          const adj = buildAdjacency(m.tris);
          const bnd = boundaryKeys(m.tris);
          const bv = new Set([...bnd].flatMap((k) => keyEdge(k)));
          const val = new Map();
          for (const k of adj.keys()) for (const x of keyEdge(k)) val.set(x, (val.get(x) ?? 0) + 1);
          for (const [x, n] of val) if (!bv.has(x)) expect(n).toBeGreaterThanOrEqual(3);
        });
        it('never bridges the mouth or an eye hole and has lip triangles', () => {
          expect(m.tris.some((t) => spans(t, SETS.LIPS_INNER_UPPER, SETS.LIPS_INNER_LOWER))).toBe(false);
          expect(m.tris.some((t) => spans(t, lidsL[0], lidsL[1]) || spans(t, lidsR[0], lidsR[1]))).toBe(false);
          expect(m.isLip.filter((x) => x === 1).length).toBeGreaterThan(10);
        });
        it('keeps the triangle count inside the pinned bounds', () => {
          if (mesh === 'low') { expect(m.tris.length).toBeGreaterThan(250); expect(m.tris.length).toBeLessThan(450); }
          else { expect(m.tris.length).toBeGreaterThan(800); expect(m.tris.length).toBeLessThanOrEqual(898); }
        });
        it('recomputes lip flags with the existing rule', () => {
          if (mesh === 'low') m.tris.forEach((t, i) => expect(m.isLip[i]).toBe(t.every((x) => lipSet.has(x)) ? 1 : 0));
        });
      });
    }
  }

  it('Flip keeps vertices, count and the exact boundary of Current, and changes some edges', () => {
    for (const mesh of ['low', 'full']) {
      const c = B.variants.current[mesh], f = B.variants.flip[mesh];
      expect(f.tris.length).toBe(c.tris.length);
      expect([...new Set(f.tris.flat())].sort((a, b) => a - b)).toEqual([...new Set(c.tris.flat())].sort((a, b) => a - b));
      expect([...boundaryKeys(f.tris)].sort()).toEqual([...boundaryKeys(c.tris)].sort());
    }
    expect(B.stats.flip.low.flips).toBeGreaterThan(0);
    expect(B.stats.flip.full.flips).toBeGreaterThan(0);
  });

  it('Flip lowers the optimizer energy on both meshes', () => {
    for (const mesh of ['low', 'full']) {
      const o = { pos2, pos3, ...FLIP_OPTS };
      expect(totalEnergy(B.variants.flip[mesh].tris, o)).toBeLessThan(totalEnergy(B.variants.current[mesh].tris, o));
    }
  });

  it('Flow: hole boundaries are the exact rings, the outer boundary is the exact oval, chains are present', () => {
    const f = B.variants.flow.low;
    const expected = new Set([...ring(SETS.FACE_OVAL), ...ring(SETS.LEFT_EYE), ...ring(SETS.RIGHT_EYE), ...ring(SETS.LIPS_INNER)]);
    expect([...boundaryKeys(f.tris)].sort()).toEqual([...expected].sort());
    const adj = buildAdjacency(f.tris);
    const used = FLOW_CHAINS.filter((c) => !B.stats.flow.low.dropped.includes(c.name));
    expect(used.length).toBeGreaterThanOrEqual(7); // oval, 2 eyes, 2 lip rings, 2 brows, nose bridge are required
    for (const c of used) for (let i = 0; i + 1 < c.ids.length; i++) expect(adj.has(edgeKey(c.ids[i], c.ids[i + 1]))).toBe(true);
    expect(JSON.stringify(f.tris)).not.toBe(JSON.stringify(B.variants.current.low.tris));
  });

  it('Flow full equals Flip full', () => {
    expect(B.variants.flow.full.tris).toEqual(B.variants.flip.full.tris);
  });

  it('prints a report for every variant and mesh', () => {
    for (const name of ['current', 'flip', 'flow']) for (const mesh of ['low', 'full']) expect(B.reports).toContain(`${name} ${mesh}`);
  });
});

describe('generator CLI emits candidates', () => {
  it('writes a candidates JSON with verts, all three variants and the report', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'c.json');
    const r = spawnSync(process.execPath, ['tools/gen-face-topology.mjs', '--emit-candidates', out, '--out', path.join(os.tmpdir(), 'unused.ts')], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    expect(j.verts).toHaveLength(468 * 3);
    expect(Object.keys(j.variants).sort()).toEqual(['current', 'flip', 'flow']);
    expect(j.variants.flip.low.tris.length % 3).toBe(0);
    expect(typeof j.report).toBe('string');
  });
});
```

- [ ] **Step 2: Run to verify they fail**
Run: `npx vitest run tools/lib/faceTopologyBuild.test.mjs`
Expected: FAIL (`flip`/`flow` variants and exports missing).

- [ ] **Step 3: Implement in `tools/lib/faceTopologyBuild.mjs`**

Export the options and chains:

```js
export const FLIP_OPTS = { wQuality: 1, wValence: 0.1, wDihedral: 1 };
export const FLOW_OPTS = { ...FLIP_OPTS, wFlow: 0.3 };
const ringOf = (ids) => [...ids, ids[0]];
export const FLOW_CHAINS = [
  { name: 'oval', ids: ringOf(SETS.FACE_OVAL) },
  { name: 'left-eye', ids: ringOf(SETS.LEFT_EYE) },
  { name: 'right-eye', ids: ringOf(SETS.RIGHT_EYE) },
  { name: 'lips-outer', ids: ringOf(SETS.LIPS_OUTER) },
  { name: 'lips-inner', ids: ringOf(SETS.LIPS_INNER) },
  { name: 'left-brow', ids: ringOf(SETS.LEFT_EYEBROW) },
  { name: 'right-brow', ids: ringOf(SETS.RIGHT_EYEBROW) },
  { name: 'nose-bridge', ids: [168, 6, 197, 195, 5, 4, 1, 19, 94, 2] },
  { name: 'nasolabial-left', ids: [98, 61], optional: true },
  { name: 'nasolabial-right', ids: [327, 291], optional: true },
];
```

Flip: after building `current`, `const pos2 = V.map((v) => [v[0], -v[1]]); const pos3 = V;` then for low and full: `const r = optimize(cur.tris, { pos2, pos3, ...FLIP_OPTS }); flip = { tris: r.tris, isLip: <recomputed with the same rule as current for that mesh>, removed: cur.removed }`; record `stats.flip.{low,full} = { flips, sweeps, frozen }`.

Flow (low only; reuse the existing Delaunay call and `inPoly`):

```js
function buildFlowLow({ V, SUBSET, pos2, pos3 }) {
  const P = (i) => pos2[i];
  const d = new Delaunator(SUBSET.flatMap(P));
  const all = [];
  for (let k = 0; k < d.triangles.length; k += 3) all.push([0, 1, 2].map((j) => SUBSET[d.triangles[k + j]]));
  const enforced = enforceChains(all, pos2, FLOW_CHAINS);
  const centroid = (t) => [0, 1].map((a) => t.reduce((s, i) => s + P(i)[a], 0) / 3);
  const removed = { outside: 0, mouth: 0, eyes: 0 };
  const kept = [];
  for (const t of enforced.tris) {
    const c = centroid(t);
    if (!inPoly(c, SETS.FACE_OVAL)) { removed.outside++; continue; }
    if (inPoly(c, SETS.LIPS_INNER)) { removed.mouth++; continue; }
    if (inPoly(c, SETS.LEFT_EYE) || inPoly(c, SETS.RIGHT_EYE)) { removed.eyes++; continue; }
    kept.push(t);
  }
  const mean = (ids) => [ids.reduce((s, i) => s + P(i)[0], 0) / ids.length, ids.reduce((s, i) => s + P(i)[1], 0) / ids.length];
  const radius = (c, ids) => Math.max(...ids.map((i) => Math.hypot(P(i)[0] - c[0], P(i)[1] - c[1])));
  const feature = (ids) => { const c = mean(ids); return { c, r: radius(c, ids) }; };
  const centers = [feature(SETS.LEFT_EYE), feature(SETS.RIGHT_EYE), feature(SETS.LIPS_OUTER), { c: P(4), r: Math.hypot(P(4)[0] - P(98)[0], P(4)[1] - P(98)[1]) }];
  const r = optimize(kept, { pos2, pos3, locked: enforced.locked, ...FLOW_OPTS, centers });
  return { tris: r.tris, removed, stats: { flips: r.flips, sweeps: r.sweeps, frozen: r.frozen, enforcedFlips: enforced.flips, dropped: enforced.dropped } };
}
```
(`inPoly` here takes a polygon given as a list of landmark ids, as in the existing generator, which projects them with `P`; keep using the moved function. The existing code builds the lip and eye polygons the same way.) Flow `isLip` uses the same low-mesh rule as current (`t.every(i => LIP_SET.has(i))`). `flow.full = flip.full`. `stats.flow.full = stats.flip.full`.

If a required chain throws (`chain "<name>": ...`): do not hide it. Investigate the chain (landmark ids from the same MediaPipe canonical set; check whether the segment crosses a locked chain or passes through another vertex), fix the chain definition (drop or re-pick vertices, or mark the chain `optional: true` only if it is a nice-to-have, never the oval, eyes, lips, brows or nose-bridge), and record what you changed and why in the report.

`reports`: for each of `current`, `flip`, `flow` and each of `low`, `full`, `formatReport(`${name} ${mesh}`, qualityReport(tris, pos3))`, joined by blank lines; also append per variant one line with the stats (`flips`, `sweeps`, `frozen`, and for flow `enforcedFlips`, `dropped`) and the weights used.

CLI (`tools/gen-face-topology.mjs`): `--variant flip|flow` now writes that variant's tables (low and full) into the TS file exactly like `current` does (header `removed` counts come from the variant); print the quality report to stdout for the chosen variant; `--emit-candidates <path>` writes the JSON described in Interfaces (`tris` flattened to one number array per mesh) and prints the full `reports` text; when `--emit-candidates` is given the TS file is only written if `--out` is also given explicitly (never overwrite `components/face/faceTopology.ts` by default in that mode).

- [ ] **Step 4: Run to verify they pass**
Run: `npx vitest run tools/lib components/face`
Expected: PASS. Do NOT weaken a validity assertion to pass. If a Flow assertion fails because the real mesh differs from the plan's assumption (for example a hole boundary that cannot be an exact ring because a ring vertex is not in `SUBSET`), report it with numbers and propose the smallest correction; the controller decides.

- [ ] **Step 5: Look at the numbers.** Run `node tools/gen-face-topology.mjs --emit-candidates .proof/topo-candidates.json --out .proof/unused.ts` and read the printed report. Expected: Flip and Flow improve at least two of: worst min angle, slivers under 20 degrees, valence share at 5..7, mean dihedral versus Current. If neither improves anything, say so in the report (the weights in `FLIP_OPTS`/`FLOW_OPTS` may need tuning in Task 6) and do not invent a fix.

- [ ] **Step 6: Spec corrections.** In `docs/superpowers/specs/2026-10-03-face-mesh-topology-design.md` make these edits: (a) in section 2, replace the sentence "Greedy and deterministic: ... repeat sweeps until no flip happens or 50 sweeps." with: "Greedy and deterministic: visit candidate edges in sorted `(min id, max id)` order, flip when the exact change in the global energy (including the dihedral of the four side edges of the quad) is strictly negative, repeat sweeps until no flip happens or 50 sweeps. Because every applied flip lowers the global energy, sweeps terminate." (b) in the Testing section, replace "its energy never increases" with "its global energy strictly decreases when any flip happens", and replace "Flow: each eye and mouth hole boundary is exactly the contour ring and the oval boundary equals Current's." with "Flow: the whole boundary is exactly the oval ring plus the eye and inner-lip rings." (c) in section 5 replace the pixel-difference assertion "(more than 0.5% pixels, Flow also from Flip)" with "(more than 0.02% pixels; the real difference is asserted on the tables themselves, in the generator tests)". (d) in section 5 replace the hook description "`faceGeometry.ts` / `drawPuppet` consult it to pick the candidate table and mesh detail" with "Playwright injects the selected variant's tables as `window.__topo = { low, full, detail }` (no candidate data is ever bundled); `faceGeometry.ts` and `drawPuppet` consult it". Keep everything else.

- [ ] **Step 7: Commit** paths: `tools/lib/faceTopologyBuild.mjs tools/lib/faceTopologyBuild.test.mjs tools/gen-face-topology.mjs docs/superpowers/specs/2026-10-03-face-mesh-topology-design.md`: `feat(tools): Flip and Flow topology variants, candidate emission and validity tests`.

---

### Task 5: Sheet-only product hook (candidate injection) and normal-build check

**Files:**
- Create: `components/face/topoSheetHook.ts`
- Modify: `components/face/faceGeometry.ts`, `components/face/cavity.ts`, `components/face/cavity.test.ts`, `components/face/FaceMeshRenderer.ts`, `vite.config.ts`
- Test: `components/face/topoSheetHook.test.ts`

**Interfaces:**
- Consumes: `FACE_MESHES` (faceGeometry), `drawPuppet` options (FaceMeshRenderer).
- Produces:
  ```ts
  // topoSheetHook.ts
  export interface TopoTable { tris: readonly number[]; isLip: readonly (0 | 1)[] }
  export interface TopoOverride { low: TopoTable; full: TopoTable; detail: 'low' | 'full' }
  export function topoOverride(): TopoOverride | null;   // null unless the sheet build flag is on AND window.__topo is set
  // cavity.ts: cornerCavity(tris: readonly number[]): Float32Array   (cached per array in a WeakMap; was cornerCavity(detail))
  // vite.config.ts: define __TOPO_SHEET__ = JSON.stringify(process.env.VITE_TOPO_SHEET === '1')
  ```

- [ ] **Step 1: Write the failing tests.**
  `components/face/topoSheetHook.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { topoOverride } from './topoSheetHook';

describe('topoSheetHook', () => {
  it('is off in normal builds and under vitest, even if window.__topo is set', () => {
    (globalThis as { __topo?: unknown }).__topo = { low: { tris: [], isLip: [] }, full: { tris: [], isLip: [] }, detail: 'low' };
    expect(topoOverride()).toBeNull();
    delete (globalThis as { __topo?: unknown }).__topo;
  });
});
```
  Update `components/face/cavity.test.ts` to the new signature: replace every `cornerCavity('low')` / `cornerCavity(d)` call with `cornerCavity(FACE_MESHES[d].tris)` (import `FACE_MESHES` from `./faceGeometry` in the test), and add an assertion that two calls with the same array return the same cached `Float32Array`, and two different arrays return different ones. Update `faceGeometry.test.ts` calls of `cornerCavity` likewise if any.

- [ ] **Step 2: Run to verify they fail**
Run: `npx vitest run components/face`
Expected: FAIL (`topoSheetHook` missing, `cornerCavity` signature).

- [ ] **Step 3: Implement.**
  - `components/face/topoSheetHook.ts`:
```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sheet-only hook for the face topology comparison (scripts/topo-sheet.mjs): lets Playwright inject a candidate
 * triangle table as window.__topo. The build flag __TOPO_SHEET__ (vite.config.ts, VITE_TOPO_SHEET=1) is a compile-time
 * constant, so normal builds drop this branch and contain no candidate data. Deleted with the losing variants.
 */
declare const __TOPO_SHEET__: boolean;

export interface TopoTable { tris: readonly number[]; isLip: readonly (0 | 1)[] }
export interface TopoOverride { low: TopoTable; full: TopoTable; detail: 'low' | 'full' }

export function topoOverride(): TopoOverride | null {
  if (typeof __TOPO_SHEET__ === 'undefined' || !__TOPO_SHEET__) return null;
  return (globalThis as { __topo?: TopoOverride }).__topo ?? null;
}
```
  - `vite.config.ts`: add to `define`: `__TOPO_SHEET__: JSON.stringify(process.env.VITE_TOPO_SHEET === '1')`.
  - `faceGeometry.ts`: import `topoOverride`; after the `FACE_MESHES` declaration add `const topo = topoOverride(); if (topo) { FACE_MESHES.low = topo.low; FACE_MESHES.full = topo.full; }`; change `createFaceBuffers` to call `cornerCavity(tris)` (it already has `tris` from `FACE_MESHES[detail]`).
  - `cavity.ts`: replace the `Map<MeshDetail, Float32Array>` cache with `WeakMap<readonly number[], Float32Array>` and the signature with `cornerCavity(tris: readonly number[])`; remove the now-unused `FACE_TRIS`/`FACE_TRIS_FULL`/`MeshDetail` imports (keep `LEFT_EYE_CONTOUR`, `RIGHT_EYE_CONTOUR`).
  - `FaceMeshRenderer.ts` `drawPuppet`: where the `scene.render({...})` input sets `meshDetail: opts.meshDetail`, use `meshDetail: topoOverride()?.detail ?? opts.meshDetail` (import `topoOverride`).

- [ ] **Step 4: Run to verify they pass; behavior unchanged**
Run: `npx vitest run components/face; npx tsc --noEmit`. Then (reaper first) `npm run orbit-check` and `npm run facedemo-check`: both must be unchanged (11/11 and 27/27).

- [ ] **Step 5: Normal-build marker check.** Run `npm run build` then (PowerShell) `Select-String -Path dist\assets\*.js -Pattern '__topo' -SimpleMatch -List`. Expected: no output (the override branch was dead-code eliminated). If the marker is present, restructure so the flag folds at build time (for example define the whole `topoOverride` result as a constant `null` when the flag is off) and rerun; do not ship a build that contains it.

- [ ] **Step 6: Commit** paths: `components/face/topoSheetHook.ts components/face/topoSheetHook.test.ts components/face/faceGeometry.ts components/face/cavity.ts components/face/cavity.test.ts components/face/faceGeometry.test.ts components/face/FaceMeshRenderer.ts vite.config.ts`: `feat(face): sheet-only topology override hook, compiled out of normal builds`.

---

### Task 6: Topology comparison sheet, render, tune, and hand to Grayson

**Files:**
- Create: `scripts/topo-sheet.mjs`
- Modify: `scripts/lib/viewer-harness.mjs` (`startPreview(port, outDir)`), `package.json` (`"topo-sheet": "node scripts/topo-sheet.mjs"`), `.gitignore` (add `dist-topo`)
- Modify (tuning only): `FLIP_OPTS` / `FLOW_OPTS` / chain choices in `tools/lib/faceTopologyBuild.mjs` if the sheet shows a problem

**Interfaces:**
- Consumes: the generator's `--emit-candidates` JSON (Task 4), the hook (Task 5), harness `ensureFixture, makeCheck, startPreview, openViewer, seek`.
- Produces: `node scripts/topo-sheet.mjs` writes `.proof/<date>-topo/`: `candidates.json`, `report.txt`, `<variant>-<mesh>-front.png`, `<variant>-<mesh>-orbit.png`, `<variant>-<mesh>-wire.png`, `sheet.png`. Env `TOPO_SHEET_PORT` (default 4179), `PROOF_DIR`.

- [ ] **Step 1: Harness.** Change `startPreview(port)` to `startPreview(port, outDir)`: when `outDir` is given append `'--outDir', outDir` to the vite preview args; existing callers (no second arg) are unchanged. Add `dist-topo` to `.gitignore`.

- [ ] **Step 2: Write `scripts/topo-sheet.mjs`.** It must:
  1. Create the output dir; run the generator: `node tools/gen-face-topology.mjs --emit-candidates <out>/candidates.json --out <out>/unused.ts`, save its stdout as `report.txt`.
  2. Build the sheet bundle without touching `dist/`: run `node scripts/build-stamp.mjs`, `node scripts/vendor-assets.mjs`, then `node node_modules/vite/bin/vite.js build --outDir dist-topo --emptyOutDir` with env `VITE_TOPO_SHEET=1` (use `spawnSync` with `{ env: { ...process.env, VITE_TOPO_SHEET: '1' }, stdio: 'inherit' }`; fail the script if any step exits non-zero).
  3. `startPreview(PORT, 'dist-topo')`; launch Chromium (viewport 1280x800); load the synthetic take with `ensureFixture()`.
  4. For each `variant` in `['current', 'flip', 'flow']` and `mesh` in `['low', 'full']`: new page; `page.addInitScript(({ tables, detail }) => { window.__topo = { low: tables.low, full: tables.full, detail }; }, { tables: <that variant's low/full {tris, isLip}>, detail: mesh })`; `openViewer(page, base, take)`; `seek(page, 496)`; capture the `[data-testid=take-canvas]` data URL as `front`; click `[data-testid=orbit-toggle]`, drag the canvas 30% of its width, capture `orbit`. Collect `pageerror` messages.
  5. Wireframes (no product code): a blank page; for each variant and mesh draw the table's edges onto a canvas (600x640): vertex positions from `candidates.json` `verts` projected as `(x, -y)` scaled and centered to the face bounds, edges as 1px light lines on a dark background; `toDataURL` per image.
  6. Save every PNG, then compose `sheet.png` (rows = variants; columns = low front, low orbit, low wire, full front, full orbit, full wire) using an HTML table with `<img>` data URIs screenshotted full page (as the earlier looks-sheet did), with the variant names and the key numbers from the report as captions.
  7. Assertions via `makeCheck`: no page errors; every render is not blank (more than 2% of pixels unlike the top-left background pixel); `flip` and `flow` low front differ from `current` low front by more than 0.02% of pixels (use a max-channel difference over 24 as in the harness `diff`); flip full front differs from current full front by more than 0.02%; the three variants' low tables differ (`JSON.stringify` of the table); and a normal `dist/` build, if present, contains no `__topo` (scan `dist/assets/*.js`; if `dist/` is missing, print a SKIP line, do not fail).
  8. Always stop the server and close the browser in `finally`; exit code from `finish()`.

- [ ] **Step 3: Render and look.** Reaper first, then `npm run topo-sheet`. Read `sheet.png`, the three low wire images and `report.txt`. Check: Flip and Flow differ visibly from Current in the wires and in the front shading; Flow's rings around eyes and mouth are exact; nothing is broken (no holes in the face, no inverted shading, eyes/mouth/brows unaffected); the quality numbers improved as intended.

- [ ] **Step 4: Tune if needed (max 3 cycles).** If Flip or Flow looks worse than Current or no better, adjust `FLIP_OPTS` / `FLOW_OPTS` weights (for example raise `wDihedral`, change `wFlow`, set `wFlow` to 0 if the flow term hurts) or the flow `centers` radius factor, regenerate, re-render, compare before/after. Keep a short note of each cycle (what changed, what the wires/numbers did). Do not add new variants or touch the vertex set. If the generator tests pin weights, update them.

- [ ] **Step 5: Gate and commit.** `npx tsc --noEmit; npx vitest run` (known flake: rerun `components/shared/recordingSchema.test.ts` alone), and a final `npm run topo-sheet` with all checks PASS. Commit paths: `scripts/topo-sheet.mjs scripts/lib/viewer-harness.mjs package.json .gitignore tools/lib/faceTopologyBuild.mjs tools/lib/faceTopologyBuild.test.mjs`: `feat(face): topology comparison sheet for Current, Flip and Flow`.

- [ ] **Step 6: Report, then STOP.** Write the report with: per variant one line on what it is and its weakness, the quality numbers side by side, the tuning cycles, the sheet path. The controller sends `sheet.png` and the wireframes to Grayson. Do NOT promote a variant, delete anything, or change `faceTopology.ts` until Grayson picks.

---

### Task 7: Ship the winner (run only after Grayson picks)

**Files:**
- Modify: `components/face/faceTopology.ts` (regenerated), `components/face/faceTopology.test.ts` if bounds need to move, `components/face/faceGeometry.ts`, `components/face/FaceMeshRenderer.ts`, `components/face/cavity.ts` as needed, `vite.config.ts`, `package.json`
- Delete via move to `C:\Projects-local\_to_delete\` (never `rm`): `scripts/topo-sheet.mjs`, `components/face/topoSheetHook.ts` and its test (or delete the file contents through git removal if it is already tracked: use `git rm` for tracked files and note it), the loser variants' code in the builder if unused
- Modify: `HANDOFF.md`; Create: `handoff-log/2026-10-03-face-mesh-topology.md`

**Interfaces:**
- Consumes: Grayson's pick: `current` (nothing ships; delete the machinery), `flip` or `flow`.
- Produces: the winner's tables in `faceTopology.ts` (low and full), tests green, the other variants and the hook removed.

- [ ] **Step 1: Promote.** Run `node tools/gen-face-topology.mjs --variant <winner>` (writes `components/face/faceTopology.ts`). Check `git diff --stat` shows only `faceTopology.ts`.
- [ ] **Step 2: Remove the machinery.** Remove the `topoOverride` import and branch from `faceGeometry.ts` and `FaceMeshRenderer.ts`; delete `topoSheetHook.ts` and its test; remove `__TOPO_SHEET__` from `vite.config.ts`; remove the `topo-sheet` script from `package.json` and move `scripts/topo-sheet.mjs` to `_to_delete`; revert `startPreview`'s optional `outDir` only if nothing else uses it (keep it if harmless). In the builder keep only what the generator still needs: if the winner is `flip` or `flow`, keep `meshOpt.mjs`, the builder and the winning variant so the table stays reproducible (`--variant <winner>` becomes the default variant), and delete the losers' code paths and `--emit-candidates`; if the winner is `current`, delete `meshOpt.mjs`, the new builder code and the tests added by this plan and restore the single-script generator from git (`git show cbe97f2:tools/gen-face-topology.mjs` is not it; use the commit before Task 3). Keep `cornerCavity(tris)` (it is the better signature) with its tests.
- [ ] **Step 3: Tests and gate.** Update the byte-identical test to compare the default CLI output to the shipped table; update `faceTopology.test.ts` only if a pinned bound is genuinely moved by the winner (never loosen an invariant such as no hole bridging). After the reaper: `npx tsc --noEmit; npm test; npm run smoke; npm run phone-check; npm run share-check; npm run cleanup-check; npm run orbit-check; npm run facedemo-check`; record pass counts (last green: 437 tests, phone 97/97, share 28/28, cleanup 7/7, orbit 11/11, facedemo 27/27; tests grow with this plan). Orbit and facedemo drag margins are thin (about 2% and 5%): run both three times and report.
- [ ] **Step 4: Visual proof (not committed).** Screenshot the real Face Puppet stage and the viewer with the shipped mesh into `.proof\2026-10-03-mesh-shipped\`, plus one video export frame as in the looks task (visible Playwright Chromium, fake camera flags from `scripts/facedemo-check.mjs`, ffmpeg frame at 0.5 s). Read one image to confirm.
- [ ] **Step 5: Docs and commit.** Update `HANDOFF.md` (current state, what shipped, what was deleted, gates, not pushed or deployed) and write `handoff-log/2026-10-03-face-mesh-topology.md` (variants tried, quality numbers, the pick and why, tuning cycles, chain changes). Do NOT write the `_agent-commons` log (the controller does). Commit with explicit paths: `feat(face): ship the <winner> face topology; remove the comparison machinery`.

---

## Self-Review
- **Spec coverage:** Current byte-identical and flags (T3); Flip optimizer with exact energy, convexity, boundary and lock rules, determinism (T1); constraint chains by flips, optional-chain rollback, hole-cut to exact rings (T2, T4); Flow low only, Flip on full (T4); generator report, `--out`, `--emit-candidates` (T3, T4); validity, regression and optimizer tests (T1, T2, T3, T4); sheet-only hook compiled out and marker check (T5); sheet with wireframes, separate `dist-topo`, assertions (T6); promote and cleanup, gate, export-free visual proof (T7). Spec deviations (recorded in Task 4 Step 6): the optimizer includes the four side edges' dihedral so the energy decrease is exact; Flow's whole boundary is the exact oval and rings; pixel-difference threshold 0.02% (the real difference is asserted on tables); Playwright injects the tables instead of a bundled candidate JSON.
- **Placeholder scan:** none; moved code in Task 3 is "move verbatim" against a byte-identical test; weights are explicit starting values tuned in Task 6.
- **Type consistency:** `edgeKey/keyEdge/orient2/buildAdjacency/boundaryKeys/valences/optimize/enforceEdge/enforceChains/qualityReport/formatReport/totalEnergy`, `SETS`, `FLOW_CHAINS`, `FLIP_OPTS`, `FLOW_OPTS`, `buildVariants` result shape (`variants.{current,flip,flow}.{low,full}.{tris,isLip,removed}`, `stats`, `reports`), `topoOverride`, `TopoOverride`, `cornerCavity(tris)` are used with identical names in every task.
