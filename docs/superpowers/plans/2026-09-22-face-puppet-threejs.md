# Face Puppet on Three.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Face Puppet's Canvas-2D renderer with a Three.js scene: smooth shading with a crease-angle slider, three-point studio lighting, self-lit eyeballs occluded by the lids, Blink Boost, and capsule hands with a palm pad, plus a Low/Full mesh toggle.

**Architecture:** `drawPuppet(ctx, frame, w, h, opts)` keeps its signature. Inside, a `PuppetScene` (one per target canvas, held in a `WeakMap`) updates a WebGL scene from the boosted landmarks, renders, and `drawImage`s into `ctx`; 2D overlays (gaze rays, mocap dots) draw on top. All maths lives in small pure modules (no `three`, no DOM) with Vitest tests. `PuppetScene.ts` is the only file that touches `three`, and it is verified by screenshots.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (node environment), `three@0.167.1` (already a dependency), MediaPipe tasks-vision 0.10.9.

**Spec:** `docs/superpowers/specs/2026-09-22-face-puppet-threejs-design.md`

## Global Constraints

- Renderer: plain `three` (imperative). Do NOT use `@react-three/fiber` for the Face Puppet.
- Pure modules (`projection.ts`, `faceGeometry.ts`, `creaseGroups.ts`, `eyes.ts`, `handRig.ts`, `puppetState.ts`) must not import `three` or touch `document`/`window`: Vitest runs with `environment: 'node'`.
- Boosts (brows, jaw, blink) return landmark COPIES; never mutate the landmark arrays passed in (they are tracker frames and recorder buffers).
- Crease Angle: slider 0–90 degrees, default 35. Mesh toggle: `'low' | 'full'`, default `'low'`. Blink Boost: 0–1, default 0.5.
- Stage background stays `#090A0C`. Accent stays `#EE3B2B`. Grays only on the head and hands.
- Commits go straight to `main`, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test command: `npx vitest run <path>`; full gate: `npm run typecheck; npm test; npm run smoke`.
- Windows repo: files are LF in the working tree (git warns about CRLF, ignore it).

## Coordinate conventions (every task uses these)

- **Stage pixels** come from `Projection` (`fitProjection(w, h, videoAspect)`): `x` right, `y` down, `z = lm.z * drawW` (negative = closer to the camera).
- **Scene units** = stage pixels with y and z flipped: `[p.x(lm), -p.y(lm), -p.z(lm)]`. So +Y is up and +Z points toward the camera. The camera is `OrthographicCamera(0, w, 0, -h, -10000, 10000)` at the origin, looking down -Z.

## File map

| File | Status | Responsibility |
|---|---|---|
| `tools/gen-face-topology.mjs` | modify | Emit LOW + FULL tris, lip flags for both, neutral vertices, eye-lid pairs |
| `components/face/faceTopology.ts` | regenerated | Generated tables |
| `components/face/faceTopology.test.ts` | modify | Tests for both meshes and the new tables |
| `components/face/projection.ts` | create | `Projection`, `fitProjection`, `toScene` (moved out of `lowPoly.ts`) |
| `components/face/projection.test.ts` | create | fitProjection tests (moved) + `toScene` |
| `components/face/creaseGroups.ts` | create | Smoothing groups from the neutral face + angle |
| `components/face/faceGeometry.ts` | create | Per-frame positions, crease normals, lip colors into Float32Arrays |
| `components/face/eyes.ts` | create | Eyeball pose (center, radius, depth, rotation) |
| `components/face/handRig.ts` | create | Capsule segments, joints, palm pad frame |
| `components/face/puppetState.ts` | modify | Blink state, `boostBlink`, `eyeClosure`, rename side constant |
| `components/face/PuppetScene.ts` | create | The only `three` code: scene, lights, meshes, render |
| `components/face/FaceMeshRenderer.ts` | rewrite | `drawPuppet` → PuppetScene + 2D overlays; `disposePuppet` |
| `components/FaceDemo.tsx` | modify | New controls, new options, dispose after export |
| `tools/make-synthetic-take.mjs` | modify | Blink phase |
| `components/face/lowPoly.ts`, `lowPoly.test.ts`, `handMesh.ts`, `handMesh.test.ts` | delete (git rm) | Replaced |

---

### Task 1: Topology generator emits the FULL mesh, neutral vertices and lid pairs

**Files:**
- Modify: `tools/gen-face-topology.mjs`
- Regenerate: `components/face/faceTopology.ts`
- Test: `components/face/faceTopology.test.ts`

**Interfaces:**
- Produces (in `faceTopology.ts`, all `readonly number[]` unless noted):
  - `FACE_TRIS` / `FACE_TRI_IS_LIP` (LOW, unchanged names and content)
  - `FACE_TRIS_FULL: readonly number[]` and `FACE_TRI_IS_LIP_FULL: readonly (0|1)[]`
  - `CANONICAL_VERTS: readonly number[]`: 468×3 flat, canonical obj coordinates rounded to 4 decimals
  - `LEFT_EYE_LID_PAIRS: readonly [number, number][]` and `RIGHT_EYE_LID_PAIRS: readonly [number, number][]`: `[upper, lower]` landmark pairs, corner to corner

- [ ] **Step 1: Write the failing tests.** Append to `components/face/faceTopology.test.ts` (keep the existing tests; add these imports to the existing import):

```ts
import {
  FACE_TRIS_FULL, FACE_TRI_IS_LIP_FULL, CANONICAL_VERTS,
  LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS,
} from './faceTopology';

const trisOf = (flat: readonly number[]) => {
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
};

describe('faceTopology FULL mesh', () => {
  const full = trisOf(FACE_TRIS_FULL);

  it('is the dense mesh: between 800 and 900 triangles, one lip flag each', () => {
    expect(full.length).toBeGreaterThan(800);
    expect(full.length).toBeLessThanOrEqual(898);
    expect(FACE_TRI_IS_LIP_FULL.length).toBe(full.length);
    expect(FACE_TRI_IS_LIP_FULL.filter((f) => f === 1).length).toBeGreaterThan(10);
  });

  it('only uses face-mesh landmark indices (0..467)', () => {
    expect(FACE_TRIS_FULL.every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
  });

  it('never bridges the mouth or an eye hole', () => {
    const lidsL = [LEFT_EYE_CONTOUR.slice(1, 8), LEFT_EYE_CONTOUR.slice(9, 16)];
    const lidsR = [RIGHT_EYE_CONTOUR.slice(1, 8), RIGHT_EYE_CONTOUR.slice(9, 16)];
    expect(full.some((t) => spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER))).toBe(false);
    expect(full.some((t) => spans(t, lidsL[0], lidsL[1]) || spans(t, lidsR[0], lidsR[1]))).toBe(false);
  });
});

describe('faceTopology neutral vertices and lid pairs', () => {
  it('has 468 xyz vertices', () => {
    expect(CANONICAL_VERTS.length).toBe(468 * 3);
    expect(CANONICAL_VERTS.every(Number.isFinite)).toBe(true);
  });

  it('pairs 7 upper-lid points with 7 lower-lid points per eye, outer corner first', () => {
    expect(LEFT_EYE_LID_PAIRS).toEqual([[246, 7], [161, 163], [160, 144], [159, 145], [158, 153], [157, 154], [173, 155]]);
    expect(RIGHT_EYE_LID_PAIRS).toEqual([[466, 249], [388, 390], [387, 373], [386, 374], [385, 380], [384, 381], [398, 382]]);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run components/face/faceTopology.test.ts`. Expected: FAIL (`FACE_TRIS_FULL` is not exported).

- [ ] **Step 3: Implement in the generator.** In `tools/gen-face-topology.mjs`:

After the existing `const V = ...` line, add a parser for the obj faces (1-based `f a/b c/d e/f`):

```js
const F = fs.readFileSync(objPath, 'utf8').split('\n')
  .filter((l) => l.startsWith('f '))
  .map((l) => l.trim().split(/\s+/).slice(1, 4).map((s) => Number(s.split('/')[0]) - 1));
```

Replace the LOW-only filtering loop's hole test with a shared helper, used for both meshes:

```js
const isHoleTri = (t) => {
  const c = [0, 1].map((a) => t.reduce((s, i) => s + P(i)[a], 0) / 3);
  if (spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER) || inPoly(c, LIPS_INNER)) return 'mouth';
  if (spans(t, L_EYE_UPPER, L_EYE_LOWER) || spans(t, R_EYE_UPPER, R_EYE_LOWER) || inPoly(c, LEFT_EYE) || inPoly(c, RIGHT_EYE)) return 'eyes';
  return null;
};
```

In the existing Delaunay loop, keep the outside-oval check and use `const hole = isHoleTri(t); if (hole) { removed[hole]++; continue; }`.

After it, build the FULL mesh from the obj faces:

```js
const fullTris = [];
const removedFull = { mouth: 0, eyes: 0 };
for (const t of F) {
  const hole = isHoleTri(t);
  if (hole) { removedFull[hole]++; continue; }
  fullTris.push(t);
}
const lipFlags = (ts) => ts.map((t) => (t.every((i) => LIP_SET.has(i)) ? 1 : 0));
```

Change `isLip` to `const isLip = lipFlags(tris);` (define `LIP_SET` before both uses). Build the lid pairs (upper reversed so both run outer corner to inner corner):

```js
const pairs = (upper, lower) => [...upper].reverse().map((u, k) => [u, lower[k]]);
const r4 = (n) => Math.round(n * 1e4) / 1e4;
```

Append to the `out` template, after `FACE_TRI_IS_LIP`:

```js
/** FULL mesh: the canonical model's own faces, same holes cut. */
export const FACE_TRIS_FULL: readonly number[] = ${arr(fullTris.flat())};
export const FACE_TRI_IS_LIP_FULL: readonly (0 | 1)[] = ${arr(lipFlags(fullTris))};

/** Neutral canonical face, 468 x (x, y, z), obj coordinates. Crease groups are computed on it. */
export const CANONICAL_VERTS: readonly number[] = ${arr(V.flat().map(r4))};

/** [upper, lower] lid landmark pairs, outer corner to inner corner. */
export const LEFT_EYE_LID_PAIRS: readonly [number, number][] = ${JSON.stringify(pairs(L_EYE_UPPER, L_EYE_LOWER))};
export const RIGHT_EYE_LID_PAIRS: readonly [number, number][] = ${JSON.stringify(pairs(R_EYE_UPPER, R_EYE_LOWER))};
```

Update the header comment line to also mention `${fullTris.length} FULL triangles`, and the final `console.log` to print `fullTris.length` and `removedFull`.

- [ ] **Step 4: Regenerate and test.** Run: `node tools/gen-face-topology.mjs; npx vitest run components/face/faceTopology.test.ts`. Expected: the generator prints `191 verts, 298 tris` for LOW (unchanged) plus the FULL count, and all topology tests PASS. If the FULL count falls outside 800–898, stop and report the removed counts instead of loosening the test.

- [ ] **Step 5: Commit.**

```bash
git add tools/gen-face-topology.mjs components/face/faceTopology.ts components/face/faceTopology.test.ts
git commit -m "Topology: FULL canonical mesh, neutral vertices, eye-lid pairs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `projection.ts` (fitProjection moved) and `toScene`

**Files:**
- Create: `components/face/projection.ts`, `components/face/projection.test.ts`
- Modify: `components/face/lowPoly.ts` (re-export for now, so nothing breaks until Task 8 deletes it)

**Interfaces:**
- Produces:
  - `interface Projection { x(lm: Landmark): number; y(lm: Landmark): number; z(lm: Landmark): number; drawW: number; drawH: number; offsetX: number; offsetY: number }`
  - `fitProjection(w: number, h: number, videoAspect: number): Projection`
  - `type V3 = [number, number, number]`
  - `toScene(lm: Landmark, p: Projection): V3` returning `[p.x(lm), -p.y(lm), -p.z(lm)]`

- [ ] **Step 1: Write the failing test** `components/face/projection.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { fitProjection, toScene } from './projection';

describe('fitProjection', () => {
  it('contain-fits a 4:3 camera into a wide stage, centered and mirrored', () => {
    const p = fitProjection(800, 400, 4 / 3);
    expect(p.drawH).toBe(400);
    expect(p.drawW).toBeCloseTo(533.333, 2);
    expect(p.offsetX).toBeCloseTo(133.333, 2);
    expect(p.x({ x: 0, y: 0, z: 0 })).toBeCloseTo(133.333 + 533.333, 2);
    expect(p.x({ x: 1, y: 1, z: 0 })).toBeCloseTo(133.333, 2);
    expect(p.y({ x: 1, y: 1, z: 0 })).toBe(400);
  });

  it('letterboxes vertically on a tall stage', () => {
    const p = fitProjection(400, 800, 4 / 3);
    expect(p.drawW).toBe(400);
    expect(p.drawH).toBe(300);
    expect(p.offsetY).toBe(250);
  });

  it('scales z by drawn width', () => {
    const p = fitProjection(800, 600, 4 / 3);
    expect(p.z({ x: 0, y: 0, z: -0.1 })).toBeCloseTo(-80);
  });
});

describe('toScene', () => {
  it('flips y up and z toward the camera', () => {
    const p = fitProjection(800, 600, 4 / 3);
    const [x, y, z] = toScene({ x: 0.5, y: 0.25, z: -0.1 }, p);
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(-150);
    expect(z).toBeCloseTo(80);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run components/face/projection.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `components/face/projection.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Camera-to-stage mapping for the Face Puppet (contain-fit, X mirrored) and
 * stage-to-scene conversion for the Three.js renderer: scene units are stage
 * pixels with y flipped up and z flipped toward the camera.
 */
import { Landmark } from '../shared/trackerTypes';

export interface Projection {
  x(lm: Landmark): number;
  y(lm: Landmark): number;
  z(lm: Landmark): number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
}

export type V3 = [number, number, number];

/** Fit the camera frame (videoAspect = width / height) inside the stage without
 * stretching, centered. X is mirrored so the puppet moves like a mirror. */
export function fitProjection(w: number, h: number, videoAspect: number): Projection {
  let drawW: number;
  let drawH: number;
  if (w / h > videoAspect) {
    drawH = h;
    drawW = h * videoAspect;
  } else {
    drawW = w;
    drawH = w / videoAspect;
  }
  const offsetX = (w - drawW) / 2;
  const offsetY = (h - drawH) / 2;
  return {
    x: (lm) => offsetX + (1 - lm.x) * drawW,
    y: (lm) => offsetY + lm.y * drawH,
    z: (lm) => lm.z * drawW,
    drawW,
    drawH,
    offsetX,
    offsetY,
  };
}

/** Stage pixels -> scene units: +Y up, +Z toward the camera. */
export function toScene(lm: Landmark, p: Projection): V3 {
  return [p.x(lm), -p.y(lm), -p.z(lm)];
}
```

In `components/face/lowPoly.ts`, delete its own `Projection` interface and `fitProjection` function, and add at the top, after the imports: `export { fitProjection } from './projection'; export type { Projection } from './projection';` plus `import { Projection } from './projection';` for its own use.

- [ ] **Step 4: Run.** Run: `npx vitest run components/face; npm run typecheck`. Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add components/face/projection.ts components/face/projection.test.ts components/face/lowPoly.ts
git commit -m "Face: projection.ts (fitProjection moved) with toScene for the 3D renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `creaseGroups.ts`

**Files:**
- Create: `components/face/creaseGroups.ts`, `components/face/creaseGroups.test.ts`

**Interfaces:**
- Consumes: `FACE_TRIS`, `FACE_TRIS_FULL`, `CANONICAL_VERTS` (Task 1).
- Produces:
  - `interface CreaseGroups { offsets: Int32Array; tris: Int32Array }`: CSR layout. The group of corner `c` (corner = `triIndex * 3 + k`) is `tris[offsets[c] .. offsets[c + 1])`, a list of triangle indices, always including its own triangle.
  - `buildCreaseGroups(triIdx: readonly number[], verts: readonly number[], angleDeg: number): CreaseGroups`

- [ ] **Step 1: Write the failing test** `components/face/creaseGroups.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildCreaseGroups } from './creaseGroups';
import { FACE_TRIS, CANONICAL_VERTS } from './faceTopology';

const group = (g: ReturnType<typeof buildCreaseGroups>, c: number) =>
  Array.from(g.tris.subarray(g.offsets[c], g.offsets[c + 1]));

// Two triangles sharing edge 0-1, folded 90 degrees along it.
const FOLD_TRIS = [0, 1, 2, 1, 0, 3];
const FOLD_VERTS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('buildCreaseGroups', () => {
  it('at 0 degrees every corner smooths only with its own triangle (flat shading)', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 0);
    const n = FACE_TRIS.length;
    for (let c = 0; c < n; c++) expect(group(g, c)).toEqual([Math.floor(c / 3)]);
  });

  it('keeps a 90-degree fold hard below 90 and smooth at 90+', () => {
    expect(group(buildCreaseGroups(FOLD_TRIS, FOLD_VERTS, 60), 0)).toEqual([0]);
    expect(group(buildCreaseGroups(FOLD_TRIS, FOLD_VERTS, 91), 0).sort()).toEqual([0, 1]);
  });

  it('is symmetric: if A smooths with B at a shared vertex, B smooths with A', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 35);
    for (let c = 0; c < FACE_TRIS.length; c++) {
      const a = Math.floor(c / 3);
      const v = FACE_TRIS[c];
      for (const b of group(g, c)) {
        const cb = [0, 1, 2].map((k) => b * 3 + k).find((x) => FACE_TRIS[x] === v)!;
        expect(group(g, cb)).toContain(a);
      }
    }
  });

  it('smooths most of the face at 90 degrees', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 90);
    let shared = 0;
    for (let c = 0; c < FACE_TRIS.length; c++) if (g.offsets[c + 1] - g.offsets[c] > 1) shared++;
    expect(shared / FACE_TRIS.length).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run components/face/creaseGroups.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `components/face/creaseGroups.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smoothing groups for the Face Puppet's crease-angle shading. Built ONCE per
 * (mesh, angle) on the neutral canonical face, so an edge never pops between
 * smooth and hard while the live face moves: per frame, each triangle corner's
 * normal is the sum of its group's LIVE face normals (faceGeometry.ts).
 */

export interface CreaseGroups {
  /** CSR: the group of corner c is tris[offsets[c] .. offsets[c + 1]). */
  offsets: Int32Array;
  tris: Int32Array;
}

export function buildCreaseGroups(triIdx: readonly number[], verts: readonly number[], angleDeg: number): CreaseGroups {
  const nTris = triIdx.length / 3;
  const normals = new Float64Array(nTris * 3);
  for (let t = 0; t < nTris; t++) {
    const [a, b, c] = [triIdx[t * 3], triIdx[t * 3 + 1], triIdx[t * 3 + 2]];
    const ux = verts[b * 3] - verts[a * 3], uy = verts[b * 3 + 1] - verts[a * 3 + 1], uz = verts[b * 3 + 2] - verts[a * 3 + 2];
    const vx = verts[c * 3] - verts[a * 3], vy = verts[c * 3 + 1] - verts[a * 3 + 1], vz = verts[c * 3 + 2] - verts[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / m;
    normals[t * 3 + 1] = ny / m;
    normals[t * 3 + 2] = nz / m;
  }

  const byVertex = new Map<number, number[]>();
  for (let t = 0; t < nTris; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triIdx[t * 3 + k];
      const list = byVertex.get(v);
      if (list) list.push(t); else byVertex.set(v, [t]);
    }
  }

  // Winding is consistent across the canonical mesh, so the dot is a true
  // fold angle; -1e-9 keeps exactly-coplanar neighbors in at 0 degrees out.
  const cosLimit = angleDeg <= 0 ? 2 : Math.cos((angleDeg * Math.PI) / 180) - 1e-9;
  const offsets = new Int32Array(nTris * 3 + 1);
  const out: number[] = [];
  for (let c = 0; c < nTris * 3; c++) {
    const t = Math.floor(c / 3);
    out.push(t);
    for (const u of byVertex.get(triIdx[c])!) {
      if (u === t) continue;
      const dot = normals[t * 3] * normals[u * 3] + normals[t * 3 + 1] * normals[u * 3 + 1] + normals[t * 3 + 2] * normals[u * 3 + 2];
      if (dot >= cosLimit) out.push(u);
    }
    offsets[c + 1] = out.length;
  }
  return { offsets, tris: Int32Array.from(out) };
}
```

- [ ] **Step 4: Run.** Run: `npx vitest run components/face/creaseGroups.test.ts`. Expected: PASS (4 tests). If the "most of the face at 90" test fails because canonical winding is inconsistent (dot of neighbors near -1), report it; do not flip normals silently.

- [ ] **Step 5: Commit.**

```bash
git add components/face/creaseGroups.ts components/face/creaseGroups.test.ts
git commit -m "Face: crease-angle smoothing groups from the neutral canonical face

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `faceGeometry.ts` (positions, crease normals, lip colors)

**Files:**
- Create: `components/face/faceGeometry.ts`, `components/face/faceGeometry.test.ts`

**Interfaces:**
- Consumes: `Projection`, `toScene` (Task 2); `CreaseGroups` (Task 3); topology tables (Task 1).
- Produces:
  - `type MeshDetail = 'low' | 'full'`
  - `FACE_MESHES: Record<MeshDetail, { tris: readonly number[]; isLip: readonly (0|1)[] }>`
  - `SKIN_GRAY = 0.62` and `LIP_GRAY = 0.45` (linear 0..1 gray for vertex colors)
  - `interface FaceBuffers { positions: Float32Array; normals: Float32Array; colors: Float32Array }`: each `nTris * 9` long (non-indexed, 3 corners × xyz)
  - `createFaceBuffers(detail: MeshDetail): FaceBuffers` (colors filled once here)
  - `updateFaceBuffers(buf: FaceBuffers, detail: MeshDetail, lm: Landmark[], p: Projection, groups: CreaseGroups): void` (no allocation)

- [ ] **Step 1: Write the failing test** `components/face/faceGeometry.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { buildCreaseGroups } from './creaseGroups';
import { FACE_MESHES, createFaceBuffers, updateFaceBuffers, SKIN_GRAY, LIP_GRAY } from './faceGeometry';
import { CANONICAL_VERTS } from './faceTopology';

// Canonical face as landmarks (y flipped to image-down), 478 points.
const canonical = (): Landmark[] => {
  const lm: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    lm.push({ x: 0.5 + CANONICAL_VERTS[i * 3] * 0.02, y: 0.5 - CANONICAL_VERTS[i * 3 + 1] * 0.02, z: -CANONICAL_VERTS[i * 3 + 2] * 0.02 });
  }
  for (let i = 468; i < 478; i++) lm.push({ x: 0.5, y: 0.5, z: 0 });
  return lm;
};

describe('faceGeometry', () => {
  it('sizes buffers per mesh and colors lips darker', () => {
    const buf = createFaceBuffers('low');
    const n = FACE_MESHES.low.tris.length / 3;
    expect(buf.positions.length).toBe(n * 9);
    const lipTri = FACE_MESHES.low.isLip.indexOf(1);
    const skinTri = FACE_MESHES.low.isLip.indexOf(0);
    expect(buf.colors[lipTri * 9]).toBeCloseTo(LIP_GRAY);
    expect(buf.colors[skinTri * 9]).toBeCloseTo(SKIN_GRAY);
  });

  it('writes scene positions for every corner', () => {
    const lm = canonical();
    const p = fitProjection(640, 480, 4 / 3);
    const buf = createFaceBuffers('low');
    const g = buildCreaseGroups(FACE_MESHES.low.tris, CANONICAL_VERTS, 35);
    updateFaceBuffers(buf, 'low', lm, p, g);
    const v0 = FACE_MESHES.low.tris[0];
    expect(buf.positions[0]).toBeCloseTo(p.x(lm[v0]));
    expect(buf.positions[1]).toBeCloseTo(-p.y(lm[v0]));
    expect(buf.positions[2]).toBeCloseTo(-p.z(lm[v0]));
  });

  it('writes unit normals that mostly face the camera (+Z) on a frontal face', () => {
    const lm = canonical();
    const p = fitProjection(640, 480, 4 / 3);
    for (const detail of ['low', 'full'] as const) {
      const buf = createFaceBuffers(detail);
      updateFaceBuffers(buf, detail, lm, p, buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, 35));
      let front = 0;
      const corners = buf.normals.length / 3;
      for (let c = 0; c < corners; c++) {
        const [x, y, z] = [buf.normals[c * 3], buf.normals[c * 3 + 1], buf.normals[c * 3 + 2]];
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
        if (z > 0) front++;
      }
      expect(front / corners).toBeGreaterThan(0.9);
    }
  });

  it('at 0 degrees gives all three corners of a triangle the same normal (flat)', () => {
    const lm = canonical();
    const p = fitProjection(640, 480, 4 / 3);
    const buf = createFaceBuffers('low');
    updateFaceBuffers(buf, 'low', lm, p, buildCreaseGroups(FACE_MESHES.low.tris, CANONICAL_VERTS, 0));
    for (let k = 0; k < 3; k++) expect(buf.normals[3 + k]).toBeCloseTo(buf.normals[k]);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run components/face/faceGeometry.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `components/face/faceGeometry.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet geometry in scene units (see projection.ts): non-indexed
 * positions, crease-angle normals (live face normals summed over the neutral
 * smoothing groups) and per-corner gray. Writes into preallocated arrays; no
 * per-frame allocation. PuppetScene uploads these to a BufferGeometry.
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection } from './projection';
import { CreaseGroups } from './creaseGroups';
import { FACE_TRIS, FACE_TRI_IS_LIP, FACE_TRIS_FULL, FACE_TRI_IS_LIP_FULL } from './faceTopology';

export type MeshDetail = 'low' | 'full';

export const FACE_MESHES: Record<MeshDetail, { tris: readonly number[]; isLip: readonly (0 | 1)[] }> = {
  low: { tris: FACE_TRIS, isLip: FACE_TRI_IS_LIP },
  full: { tris: FACE_TRIS_FULL, isLip: FACE_TRI_IS_LIP_FULL },
};

export const SKIN_GRAY = 0.62;
export const LIP_GRAY = 0.45;

export interface FaceBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Scratch: live face normal per triangle (unnormalized, area-weighted). */
  faceNormals: Float32Array;
}

export function createFaceBuffers(detail: MeshDetail): FaceBuffers {
  const { tris, isLip } = FACE_MESHES[detail];
  const nTris = tris.length / 3;
  const colors = new Float32Array(nTris * 9);
  for (let t = 0; t < nTris; t++) colors.fill(isLip[t] ? LIP_GRAY : SKIN_GRAY, t * 9, t * 9 + 9);
  return {
    positions: new Float32Array(nTris * 9),
    normals: new Float32Array(nTris * 9),
    colors,
    faceNormals: new Float32Array(nTris * 3),
  };
}

export function updateFaceBuffers(buf: FaceBuffers, detail: MeshDetail, lm: Landmark[], p: Projection, groups: CreaseGroups): void {
  const { tris } = FACE_MESHES[detail];
  const nTris = tris.length / 3;
  const P = buf.positions;
  for (let c = 0; c < nTris * 3; c++) {
    const l = lm[tris[c]];
    P[c * 3] = p.x(l);
    P[c * 3 + 1] = -p.y(l);
    P[c * 3 + 2] = -p.z(l);
  }
  const FN = buf.faceNormals;
  for (let t = 0; t < nTris; t++) {
    const a = t * 9;
    const ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2];
    const vx = P[a + 6] - P[a], vy = P[a + 7] - P[a + 1], vz = P[a + 8] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // Two-sided: the X mirror flips winding, so orient every face toward the camera.
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    FN[t * 3] = nx; FN[t * 3 + 1] = ny; FN[t * 3 + 2] = nz;
  }
  const N = buf.normals;
  for (let c = 0; c < nTris * 3; c++) {
    let x = 0, y = 0, z = 0;
    for (let k = groups.offsets[c]; k < groups.offsets[c + 1]; k++) {
      const u = groups.tris[k];
      x += FN[u * 3]; y += FN[u * 3 + 1]; z += FN[u * 3 + 2];
    }
    const m = Math.hypot(x, y, z) || 1;
    N[c * 3] = x / m; N[c * 3 + 1] = y / m; N[c * 3 + 2] = z / m;
  }
}
```

(`faceNormals` is added to the `FaceBuffers` interface as scratch space; the test only reads `positions`, `normals`, `colors`.)

- [ ] **Step 4: Run.** Run: `npx vitest run components/face/faceGeometry.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add components/face/faceGeometry.ts components/face/faceGeometry.test.ts
git commit -m "Face: geometry buffers with crease-angle normals and lip gray, Low and Full

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Blink state and `boostBlink` in `puppetState.ts`

**Files:**
- Modify: `components/face/puppetState.ts`, `components/face/puppetState.test.ts`

**Interfaces:**
- Consumes: `LEFT_EYE_LID_PAIRS`, `RIGHT_EYE_LID_PAIRS`, `LEFT_EYE_CONTOUR`, `RIGHT_EYE_CONTOUR` (Task 1).
- Produces:
  - `PuppetState` gains `blinks: [number, number]` (smoothed raw blink 0..1) and `lidsShut: [boolean, boolean]`, indexed `[LEFT_EYE_CONTOUR eye, RIGHT_EYE_CONTOUR eye]` (the same order as `brows`).
  - `BLENDSHAPE_SIDES_SWAPPED` replaces `BROW_SIDES_SWAPPED` (value `true`, unchanged).
  - `BLINK_GAIN = 1`, `BLINK_SNAP_CLOSE = 0.8`, `BLINK_SNAP_OPEN = 0.6`, `LID_MEET = 0.2`
  - `stepPuppetState(prev, lm, bs, videoAspect, blinkBoost = 0.5)`: new optional 5th argument.
  - `eyeClosure(state: PuppetState, side: 0 | 1, blinkBoost: number): number` returning 0..1.
  - `boostBlink(lm: Landmark[], state: PuppetState, blinkBoost: number): Landmark[]` returning a copy.

- [ ] **Step 1: Write the failing tests.** In `components/face/puppetState.test.ts`, extend the import with `eyeClosure, boostBlink, BLINK_GAIN, LID_MEET` and add:

```ts
describe('blink', () => {
  const blinkBs = (l: number, r: number) => ({ eyeBlinkLeft: l, eyeBlinkRight: r });
  const settle = (bs: Record<string, number>, boost = 0.5) => {
    let s = INITIAL_PUPPET_STATE;
    for (let i = 0; i < 30; i++) s = stepPuppetState(s, face(), bs, 1, boost);
    return s;
  };

  it('maps eyeBlinkLeft to the LEFT_EYE_CONTOUR eye (same verified sides as the brows)', () => {
    const s = settle(blinkBs(1, 0));
    expect(s.blinks[0]).toBeCloseTo(1, 2);
    expect(s.blinks[1]).toBeCloseTo(0, 2);
  });

  it('boosts closure and snaps a real blink fully shut', () => {
    const s = settle(blinkBs(0.6, 0.6)); // 0.6 * (1 + 0.5 * BLINK_GAIN) = 0.9 > snap
    expect(s.lidsShut).toEqual([true, true]);
    expect(eyeClosure(s, 0, 0.5)).toBe(1);
  });

  it('leaves a squint partial', () => {
    const s = settle(blinkBs(0.3, 0.3));
    expect(s.lidsShut).toEqual([false, false]);
    expect(eyeClosure(s, 0, 0.5)).toBeCloseTo(0.3 * (1 + 0.5 * BLINK_GAIN), 2);
  });

  it('holds shut until closure drops below the release threshold', () => {
    let s = settle(blinkBs(0.6, 0.6));
    for (let i = 0; i < 30; i++) s = stepPuppetState(s, face(), blinkBs(0.45, 0.45), 1, 0.5); // 0.675: between 0.6 and 0.8
    expect(s.lidsShut[0]).toBe(true);
    for (let i = 0; i < 30; i++) s = stepPuppetState(s, face(), blinkBs(0.2, 0.2), 1, 0.5);
    expect(s.lidsShut[0]).toBe(false);
  });
});

describe('boostBlink', () => {
  const lidFace = (): Landmark[] => {
    const lm = face();
    for (const [u, l] of [...LEFT_EYE_LID_PAIRS, ...RIGHT_EYE_LID_PAIRS]) {
      lm[u] = { x: 0.5, y: 0.40, z: 0 };
      lm[l] = { x: 0.5, y: 0.45, z: 0 };
    }
    return lm;
  };
  const shut = { ...INITIAL_PUPPET_STATE, lidsShut: [true, true] as [boolean, boolean] };

  it('closes both lids to the meeting line when shut, never mutating', () => {
    const lm = lidFace();
    const before = JSON.stringify(lm);
    const out = boostBlink(lm, shut, 0.5);
    expect(JSON.stringify(lm)).toBe(before);
    const [u, l] = LEFT_EYE_LID_PAIRS[3];
    const meet = 0.45 + (0.40 - 0.45) * LID_MEET;
    expect(out[u].y).toBeCloseTo(meet);
    expect(out[l].y).toBeCloseTo(meet);
  });

  it('returns the input untouched with eyes open', () => {
    const lm = lidFace();
    expect(boostBlink(lm, INITIAL_PUPPET_STATE, 0.5)).toBe(lm);
  });
});
```

Also add `LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS` to the `./faceTopology` import in the test file.

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run components/face/puppetState.test.ts`. Expected: FAIL (`eyeClosure` is not exported).

- [ ] **Step 3: Implement** in `components/face/puppetState.ts`:

1. Rename `BROW_SIDES_SWAPPED` to `BLENDSHAPE_SIDES_SWAPPED` (keep the value `true`). Extend its doc comment: "Applies to brows AND blinks (eyeBlinkLeft/Right)."
2. Add to the imports: `LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR` from `./faceTopology`.
3. Extend `PuppetState` and `INITIAL_PUPPET_STATE`:

```ts
  /** Smoothed raw blink 0..1 for [LEFT_EYE_CONTOUR eye, RIGHT_EYE_CONTOUR eye]. */
  blinks: [number, number];
  /** Snapped shut (hysteresis on the boosted closure). */
  lidsShut: [boolean, boolean];
```

```ts
export const INITIAL_PUPPET_STATE: PuppetState = {
  mouthOpen: false, jaw: 0, brows: [0, 0], blinks: [0, 0], lidsShut: [false, false],
};
```

4. Add the constants and helpers:

```ts
export const BLINK_GAIN = 1;
export const BLINK_SNAP_CLOSE = 0.8;
export const BLINK_SNAP_OPEN = 0.6;
/** Closed lids meet this share of the way up from the lower lid. */
export const LID_MEET = 0.2;
const BLINK_ALPHA = 0.7; // light: quick blinks must survive

/** Lid aperture fallback for takes without blendshapes: 0 open .. 1 shut. */
function apertureBlink(lm: Landmark[], contour: readonly number[]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of contour) {
    minX = Math.min(minX, lm[i].x); maxX = Math.max(maxX, lm[i].x);
    minY = Math.min(minY, lm[i].y); maxY = Math.max(maxY, lm[i].y);
  }
  const ratio = (maxY - minY) / Math.max(maxX - minX, 1e-6);
  return Math.max(0, Math.min(1, (0.28 - ratio) / 0.2));
}

const boostedBlink = (raw: number, blinkBoost: number) => Math.min(1, raw * (1 + blinkBoost * BLINK_GAIN));

export function eyeClosure(state: PuppetState, side: 0 | 1, blinkBoost: number): number {
  return state.lidsShut[side] ? 1 : boostedBlink(state.blinks[side], blinkBoost);
}
```

5. In `stepPuppetState`, add the 5th parameter `blinkBoost = 0.5`. After the brow `ema` lines, compute the blinks (same side letters `a`, `b` as the brows):

```ts
  const rawBlink = (side: 'Left' | 'Right', contour: readonly number[]) =>
    bs && bs[`eyeBlink${side}`] !== undefined ? bs[`eyeBlink${side}`] : apertureBlink(lm, contour);
  const blinks: [number, number] = [
    ema(prev.blinks[0], rawBlink(a, LEFT_EYE_CONTOUR), BLINK_ALPHA),
    ema(prev.blinks[1], rawBlink(b, RIGHT_EYE_CONTOUR), BLINK_ALPHA),
  ];
  const shut = (s: 0 | 1): boolean => {
    const c = boostedBlink(blinks[s], blinkBoost);
    return prev.lidsShut[s] ? c >= BLINK_SNAP_OPEN : c > BLINK_SNAP_CLOSE;
  };
```

and return `blinks, lidsShut: [shut(0), shut(1)]` in the result object. Rename the destructured `[a, b]` source to `BLENDSHAPE_SIDES_SWAPPED`.

6. Add `boostBlink`:

```ts
/** Copy of `lm` with each eye's upper and lower lids drawn toward their meeting
 * line by eyeClosure. Returns `lm` itself when both eyes are open. */
export function boostBlink(lm: Landmark[], state: PuppetState, blinkBoost: number): Landmark[] {
  const closure = [eyeClosure(state, 0, blinkBoost), eyeClosure(state, 1, blinkBoost)];
  if (closure[0] <= 0 && closure[1] <= 0) return lm;
  const out = lm.slice();
  [LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS].forEach((pairs, s) => {
    const k = closure[s];
    if (k <= 0) return;
    for (const [u, l] of pairs) {
      const U = lm[u], L = lm[l];
      if (!U || !L) continue;
      const mx = L.x + (U.x - L.x) * LID_MEET, my = L.y + (U.y - L.y) * LID_MEET, mz = L.z + (U.z - L.z) * LID_MEET;
      out[u] = { ...U, x: U.x + (mx - U.x) * k, y: U.y + (my - U.y) * k, z: U.z + (mz - U.z) * k };
      out[l] = { ...L, x: L.x + (mx - L.x) * k, y: L.y + (my - L.y) * k, z: L.z + (mz - L.z) * k };
    }
  });
  return out;
}
```

7. Note: the `face()` fixture has all eye points at 0.5, so without blink blendshapes `apertureBlink` sees zero width and returns 1 (the `1e-6` guard keeps it finite). Nothing in the older jaw/brow tests asserts blink state, so this is harmless; the blink tests always pass `eyeBlink*` values.

- [ ] **Step 4: Run.** Run: `npx vitest run components/face/puppetState.test.ts; npm run typecheck`. Expected: all PASS, including the existing brow/jaw tests. Typecheck is clean; `FaceDemo.tsx` still compiles because the new argument is optional.

- [ ] **Step 5: Commit.**

```bash
git add components/face/puppetState.ts components/face/puppetState.test.ts
git commit -m "Face: Blink Boost state, snap-shut hysteresis and boostBlink

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `eyes.ts` and `handRig.ts` (pure poses)

**Files:**
- Create: `components/face/eyes.ts`, `components/face/eyes.test.ts`, `components/face/handRig.ts`, `components/face/handRig.test.ts`

**Interfaces:**
- Consumes: `Projection`, `toScene`, `V3` (Task 2).
- Produces:
  - `interface EyePose { center: V3; radius: number; rx: number; ry: number }` and `eyePose(lm: Landmark[], contour: readonly number[], irisIdx: number, p: Projection): EyePose`
  - `EYE_RADIUS_OF_WIDTH = 0.5`, `EYE_SETBACK = 1.05`, `GAZE_MAX = 0.6`
  - `interface Segment { a: V3; b: V3; radius: number }`, `interface Joint { p: V3; radius: number }`, `interface PalmPad { center: V3; u: V3; v: V3; n: V3; su: number; sv: number; sn: number }`
  - `HAND_SEGMENTS: readonly [number, number, number][]` (`[from, to, finger]`, 16 entries)
  - `handRig(lm: Landmark[], p: Projection): { segments: Segment[]; joints: Joint[]; palm: PalmPad }`

- [ ] **Step 1: Write the failing tests.**

`components/face/eyes.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { eyePose, EYE_RADIUS_OF_WIDTH, EYE_SETBACK, GAZE_MAX } from './eyes';

const CONTOUR = [0, 1, 2, 3];
// A 0.1-wide, 0.04-tall eye centered at (0.5, 0.5), z = 0; iris landmark at index 4.
const eye = (irisX = 0.5, irisY = 0.5): Landmark[] => [
  { x: 0.45, y: 0.5, z: 0 }, { x: 0.5, y: 0.48, z: 0 }, { x: 0.55, y: 0.5, z: 0 }, { x: 0.5, y: 0.52, z: 0 },
  { x: irisX, y: irisY, z: 0 },
];

describe('eyePose', () => {
  const p = fitProjection(1000, 1000, 1);

  it('sits behind the lid opening, sized from the eye width', () => {
    const e = eyePose(eye(), CONTOUR, 4, p);
    expect(e.radius).toBeCloseTo(100 * EYE_RADIUS_OF_WIDTH); // width 0.1 * 1000 px
    expect(e.center[0]).toBeCloseTo(500);
    expect(e.center[1]).toBeCloseTo(-500);
    expect(e.center[2]).toBeCloseTo(-e.radius * EYE_SETBACK);
    expect(e.rx).toBeCloseTo(0);
    expect(e.ry).toBeCloseTo(0);
  });

  it('turns toward the iris (stage is mirrored: iris at lower x = to the right on stage)', () => {
    const e = eyePose(eye(0.48, 0.5), CONTOUR, 4, p);
    expect(e.ry).toBeGreaterThan(0);
  });

  it('clamps the gaze so the iris never rolls out of view', () => {
    const e = eyePose(eye(0.2, 0.5), CONTOUR, 4, p);
    expect(Math.abs(Math.sin(e.ry))).toBeLessThanOrEqual(GAZE_MAX + 1e-9);
  });
});
```

`components/face/handRig.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { handRig, HAND_SEGMENTS } from './handRig';

// Flat open hand facing the camera: wrist at the bottom, fingers up (image y down).
const hand = (): Landmark[] => {
  const pts: [number, number][] = [[0.5, 0.8],
    [0.44, 0.76], [0.4, 0.72], [0.37, 0.68], [0.35, 0.64],
    [0.46, 0.64], [0.46, 0.58], [0.46, 0.54], [0.46, 0.5],
    [0.5, 0.63], [0.5, 0.56], [0.5, 0.52], [0.5, 0.48],
    [0.54, 0.64], [0.54, 0.58], [0.54, 0.54], [0.54, 0.51],
    [0.58, 0.66], [0.58, 0.61], [0.58, 0.58], [0.58, 0.55]];
  return pts.map(([x, y]) => ({ x, y, z: 0 }));
};

describe('handRig', () => {
  const p = fitProjection(1000, 1000, 1);

  it('makes 16 finger segments from the landmark pairs', () => {
    const r = handRig(hand(), p);
    expect(r.segments.length).toBe(HAND_SEGMENTS.length);
    expect(HAND_SEGMENTS.length).toBe(16);
    const s = r.segments[HAND_SEGMENTS.findIndex(([a, b]) => a === 9 && b === 10)];
    expect(s.a[0]).toBeCloseTo(p.x(hand()[9]));
    expect(s.b[1]).toBeCloseTo(-p.y(hand()[10]));
  });

  it('makes the thumb thickest and the pinky thinnest, tapering to the tip', () => {
    const r = handRig(hand(), p);
    const seg = (a: number, b: number) => r.segments[HAND_SEGMENTS.findIndex(([x, y]) => x === a && y === b)];
    expect(seg(2, 3).radius).toBeGreaterThan(seg(18, 19).radius);
    expect(seg(9, 10).radius).toBeGreaterThan(seg(11, 12).radius);
  });

  it('orients the palm pad: normal toward the camera for a hand facing it, thickness a third of width', () => {
    const r = handRig(hand(), p);
    expect(Math.abs(r.palm.n[2])).toBeCloseTo(1, 5);
    expect(r.palm.sn * 2).toBeCloseTo((r.palm.sv * 2) / 3, 5);
    expect(r.palm.u[1]).toBeGreaterThan(0.9); // wrist -> middle knuckle points up on screen
  });

  it('has a joint for every landmark used by a segment', () => {
    const r = handRig(hand(), p);
    expect(r.joints.length).toBe(new Set(HAND_SEGMENTS.flatMap(([a, b]) => [a, b])).size);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run components/face/eyes.test.ts components/face/handRig.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 3: Implement.**

`components/face/eyes.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Eyeball pose for the Face Puppet: a ball centered on the lid opening,
 * sized from the corner-to-corner width and set back so the face mesh around
 * the opening sits in front of it (the lids occlude it when they close). It
 * rotates toward the MediaPipe iris landmark, clamped. Scene units.
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection, toScene, V3 } from './projection';

export const EYE_RADIUS_OF_WIDTH = 0.5;
/** Center depth behind the lid-rim average, in radii (front of the ball just behind the rim). */
export const EYE_SETBACK = 1.05;
/** Max sine of the gaze rotation. */
export const GAZE_MAX = 0.6;

export interface EyePose { center: V3; radius: number; rx: number; ry: number }

export function eyePose(lm: Landmark[], contour: readonly number[], irisIdx: number, p: Projection): EyePose {
  let cx = 0, cy = 0, cz = 0, minX = Infinity, maxX = -Infinity;
  for (const i of contour) {
    const [x, y, z] = toScene(lm[i], p);
    cx += x; cy += y; cz += z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  const n = contour.length;
  cx /= n; cy /= n; cz /= n;
  const radius = Math.max(1, (maxX - minX) * EYE_RADIUS_OF_WIDTH);
  let rx = 0, ry = 0;
  if (lm[irisIdx]) {
    const [ix, iy] = toScene(lm[irisIdx], p);
    let ox = (ix - cx) / radius, oy = (iy - cy) / radius;
    const m = Math.hypot(ox, oy);
    if (m > GAZE_MAX) { ox *= GAZE_MAX / m; oy *= GAZE_MAX / m; }
    ry = Math.asin(ox);  // +Z front turned toward +X
    rx = -Math.asin(oy); // +Z front tilted toward +Y
  }
  return { center: [cx, cy, cz - radius * EYE_SETBACK], radius, rx, ry };
}
```

`components/face/handRig.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capsule hand rig for the Face Puppet, in scene units: 16 finger segments
 * (thumb from the wrist, fingers from the knuckles; the palm pad covers the
 * metacarpals), a joint sphere per used landmark (segment + joint spheres =
 * capsules, no stretched caps), and a rounded palm pad frame. Radii per finger,
 * tapering to the tip, scaled by hand size (wrist to middle knuckle).
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection, toScene, V3 } from './projection';

/** [from, to, finger] with finger 0 = thumb .. 4 = pinky. */
export const HAND_SEGMENTS: readonly [number, number, number][] = [
  [0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0],
  [5, 6, 1], [6, 7, 1], [7, 8, 1],
  [9, 10, 2], [10, 11, 2], [11, 12, 2],
  [13, 14, 3], [14, 15, 3], [15, 16, 3],
  [17, 18, 4], [18, 19, 4], [19, 20, 4],
];
/** Base radius per finger as a share of hand size. */
export const FINGER_RADIUS: readonly number[] = [0.13, 0.11, 0.115, 0.105, 0.09];
/** Radius multiplier per segment along a finger (base -> tip). */
export const FINGER_TAPER: readonly number[] = [1, 0.88, 0.78, 0.7];

export interface Segment { a: V3; b: V3; radius: number }
export interface Joint { p: V3; radius: number }
export interface PalmPad { center: V3; u: V3; v: V3; n: V3; su: number; sv: number; sn: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const m = len(a) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function handRig(lm: Landmark[], p: Projection) {
  const P = lm.map((l) => toScene(l, p));
  const size = len(sub(P[9], P[0]));

  const segments: Segment[] = [];
  const jointR = new Map<number, number>();
  const segIndex = [0, 0, 0, 0, 0];
  for (const [a, b, f] of HAND_SEGMENTS) {
    const k = segIndex[f]++;
    const taper = f === 0 ? FINGER_TAPER[k] : FINGER_TAPER[k + 1];
    const radius = size * FINGER_RADIUS[f] * taper;
    segments.push({ a: P[a], b: P[b], radius });
    for (const j of [a, b]) jointR.set(j, Math.max(jointR.get(j) ?? 0, radius));
  }
  const joints: Joint[] = [...jointR].map(([j, radius]) => ({ p: P[j], radius }));

  const knuckles = [5, 9, 13, 17].map((i) => P[i]);
  const center: V3 = [0, 1, 2].map((d) => (P[0][d] + knuckles.reduce((s, q) => s + q[d], 0)) / 5) as V3;
  const u = unit(sub(P[9], P[0]));
  let n = unit(cross(u, sub(P[17], P[5])));
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]]; // face the camera; the pad is symmetric
  const v = unit(cross(n, u));
  const width = len(sub(P[17], P[5]));
  return {
    segments,
    joints,
    palm: { center, u, v, n, su: size * 0.55, sv: width * 0.6, sn: (width * 0.6) / 3 } as PalmPad,
  };
}
```

- [ ] **Step 4: Run.** Run: `npx vitest run components/face/eyes.test.ts components/face/handRig.test.ts`. Expected: PASS. (The palm test checks `sn*2 == sv*2/3`, which holds by construction.)

- [ ] **Step 5: Commit.**

```bash
git add components/face/eyes.ts components/face/eyes.test.ts components/face/handRig.ts components/face/handRig.test.ts
git commit -m "Face: eyeball pose and capsule hand rig (pure, scene units)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `PuppetScene.ts` and the new `drawPuppet`

**Files:**
- Create: `components/face/PuppetScene.ts`
- Rewrite: `components/face/FaceMeshRenderer.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `boostBrows`, `boostJaw`, `teethGap`, `boostBlink`, `PuppetState` (puppetState.ts).
- Produces:
  - `PuppetOptions` gains `blinkBoost: number; creaseAngle: number; meshDetail: MeshDetail`.
  - `drawPuppet(ctx, frame, w, h, opts)` keeps its signature.
  - `disposePuppet(canvas: HTMLCanvasElement): void`
  - `STAGE_BG` is still exported.

No unit test: this file is WebGL. Proof is by screenshots in Task 9. Keep every piece of maths out of it (that all lives in Tasks 3–6).

- [ ] **Step 1: Write `components/face/PuppetScene.ts`:**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Face Puppet's Three.js scene: crease-shaded face (Low/Full), studio
 * light rig, self-lit eyeballs with a fixed glint, self-lit mouth parts and
 * brows, capsule hands drawn in a second pass so they always sit in front.
 * All geometry maths is in the pure modules; this file only moves meshes.
 */
import * as THREE from 'three';
import { Landmark } from '../shared/trackerTypes';
import { Projection, toScene, V3 } from './projection';
import { MeshDetail, FACE_MESHES, createFaceBuffers, updateFaceBuffers, FaceBuffers } from './faceGeometry';
import { buildCreaseGroups, CreaseGroups } from './creaseGroups';
import { eyePose } from './eyes';
import { handRig, HAND_SEGMENTS } from './handRig';
import {
  CANONICAL_VERTS, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LIPS_INNER, LIPS_INNER_UPPER, LIPS_INNER_LOWER,
  LEFT_EYEBROW, RIGHT_EYEBROW,
} from './faceTopology';

const BG = 0x090a0c;
const SKIN_HAND = 0xa3a7ad; // close to the face's SKIN_GRAY after lighting
const CAVITY = 0x0b0c0e;
const TOOTH = 0xe6e4dc;
const TOOTH_SEAM = 0x8e8c85;
const LIP_CLOSED = 0x3a3d44;
const LIP_SEAM = 0x15171b;
const BROW = 0x16181c;
const TOOTH_BAND = 0.08;
const TOOTH_BAND_MAX_HALF_GAP = 0.6;
const MAX_JOINTS = 42; // 2 hands x 21

export interface SceneInput {
  face: Landmark[] | null;       // boosted (brows, jaw, blink)
  eyeSource: Landmark[] | null;  // boosted brows/jaw but NOT blink: eyeballs must not move when lids close
  hands: Landmark[][];
  mouthOpen: boolean;
  teethGap: number;
  creaseAngle: number;
  meshDetail: MeshDetail;
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-0.6, 0.7, 1);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(0.7, -0.3, 1);
  const rim = new THREE.DirectionalLight(0xffffff, 1.6);
  rim.position.set(0.2, 0.8, -1);
  scene.add(key, fill, rim);
}

function eyeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128; // equirect: three's SphereGeometry puts +Z (front) at u = 0.25
  const g = c.getContext('2d')!;
  g.fillStyle = '#F3F4F6'; g.fillRect(0, 0, 256, 128);
  const fx = 64, fy = 64;
  g.beginPath(); g.ellipse(fx, fy, 22, 44, 0, 0, Math.PI * 2); g.fillStyle = '#60A5FA'; g.fill();
  g.beginPath(); g.ellipse(fx, fy, 19, 38, 0, 0, Math.PI * 2); g.fillStyle = '#111827'; g.fill();
  g.beginPath(); g.ellipse(fx, fy, 9, 18, 0, 0, Math.PI * 2); g.fillStyle = '#000000'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A dynamic mesh whose position buffer we rewrite in place each frame. */
function dynamicMesh(maxVerts: number, material: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
  g.setDrawRange(0, 0);
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

function writeTris(mesh: THREE.Mesh, tris: V3[]) {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const a = attr.array as Float32Array;
  const n = Math.min(tris.length, a.length / 3);
  for (let i = 0; i < n; i++) { a[i * 3] = tris[i][0]; a[i * 3 + 1] = tris[i][1]; a[i * 3 + 2] = tris[i][2]; }
  attr.needsUpdate = true;
  mesh.geometry.setDrawRange(0, n);
}

/** Triangle fan of a closed ring around its centroid, pushed by dz. */
function fan(ring: V3[], dz: number): V3[] {
  const c: V3 = [0, 1, 2].map((d) => ring.reduce((s, q) => s + q[d], 0) / ring.length) as V3;
  const out: V3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push([c[0], c[1], c[2] + dz], [a[0], a[1], a[2] + dz], [b[0], b[1], b[2] + dz]);
  }
  return out;
}

/** Quad strip between two equal-length polylines. */
function strip(top: V3[], bottom: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i + 1 < top.length; i++) {
    out.push(top[i], bottom[i], top[i + 1], top[i + 1], bottom[i], bottom[i + 1]);
  }
  return out;
}

/** Ribbon of half-width hw along a polyline (screen plane), pushed by dz. */
function ribbon(pts: V3[], hw: number, dz: number): V3[] {
  const top: V3[] = [], bottom: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m * hw, ny = dx / m * hw;
    top.push([pts[i][0] + nx, pts[i][1] + ny, pts[i][2] + dz]);
    bottom.push([pts[i][0] - nx, pts[i][1] - ny, pts[i][2] + dz]);
  }
  return strip(top, bottom);
}

export class PuppetScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.OrthographicCamera;
  private faceScene = new THREE.Scene();
  private handScene = new THREE.Scene();
  private skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, // vertex colors carry the gray
    roughness: 0.75, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  private faceMesh!: THREE.Mesh;
  private faceBuf!: FaceBuffers;
  private detail: MeshDetail | null = null;
  private crease = { detail: null as MeshDetail | null, angle: -1, groups: null as CreaseGroups | null };
  private eyes: THREE.Mesh[] = [];
  private glints: THREE.Mesh[] = [];
  private cavity = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: CAVITY, side: THREE.DoubleSide }));
  private teeth = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: TOOTH, side: THREE.DoubleSide }));
  private toothSeam = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: TOOTH_SEAM, side: THREE.DoubleSide }));
  private closedLip = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: LIP_CLOSED, side: THREE.DoubleSide }));
  private lipSeam = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: LIP_SEAM, side: THREE.DoubleSide }));
  private brows = dynamicMesh(64 * 3, new THREE.MeshBasicMaterial({ color: BROW, side: THREE.DoubleSide }));
  private bones: THREE.InstancedMesh;
  private jointBalls: THREE.InstancedMesh;
  private palms: THREE.Mesh[] = [];
  private tmp = new THREE.Object3D();

  constructor(w: number, h: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.OrthographicCamera(0, w, 0, -h, -10000, 10000);
    this.setSize(w, h);
    addLights(this.faceScene);
    addLights(this.handScene);

    const tex = eyeTexture();
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ map: tex }));
      const glint = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.eyes.push(eye); this.glints.push(glint);
      this.faceScene.add(eye, glint);
    }
    this.faceScene.add(this.cavity, this.teeth, this.toothSeam, this.closedLip, this.lipSeam, this.brows);

    const handMat = new THREE.MeshStandardMaterial({ color: SKIN_HAND, roughness: 0.75, metalness: 0 });
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), handMat, HAND_SEGMENTS.length * 2);
    this.jointBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), handMat, MAX_JOINTS);
    this.bones.frustumCulled = false;
    this.jointBalls.frustumCulled = false;
    this.handScene.add(this.bones, this.jointBalls);
    for (let i = 0; i < 2; i++) {
      const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), handMat);
      this.palms.push(palm);
      this.handScene.add(palm);
    }
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.right = w;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  private ensureFace(detail: MeshDetail, angle: number) {
    if (this.detail !== detail) {
      if (this.faceMesh) { this.faceScene.remove(this.faceMesh); this.faceMesh.geometry.dispose(); }
      this.faceBuf = createFaceBuffers(detail);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.faceBuf.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(this.faceBuf.normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.faceBuf.colors, 3));
      this.faceMesh = new THREE.Mesh(g, this.skinMat);
      this.faceMesh.frustumCulled = false;
      this.faceScene.add(this.faceMesh);
      this.detail = detail;
    }
    if (this.crease.detail !== detail || this.crease.angle !== angle) {
      this.crease = { detail, angle, groups: buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, angle) };
    }
  }

  render(input: SceneInput, p: Projection) {
    const face = input.face && input.face.length >= 468 ? input.face : null;
    this.faceMesh && (this.faceMesh.visible = !!face);
    for (const o of [...this.eyes, ...this.glints, this.cavity, this.teeth, this.toothSeam, this.closedLip, this.lipSeam, this.brows]) o.visible = !!face;

    if (face) {
      this.ensureFace(input.meshDetail, input.creaseAngle);
      updateFaceBuffers(this.faceBuf, input.meshDetail, face, p, this.crease.groups!);
      const g = this.faceMesh.geometry;
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('normal').needsUpdate = true;
      this.updateEyes(input.eyeSource ?? face, p);
      this.updateMouth(face, p, input.mouthOpen, input.teethGap);
      this.updateBrows(face, p);
    }
    this.updateHands(input.hands, p);

    this.renderer.setClearColor(BG, 1);
    this.renderer.clear();
    this.renderer.render(this.faceScene, this.camera);
    this.renderer.clearDepth(); // hands always in front of the face
    this.renderer.render(this.handScene, this.camera);
  }

  private updateEyes(lm: Landmark[], p: Projection) {
    // MediaPipe iris centers: 468 sits in the 33..133 eye, 473 in the 263..362 eye.
    [[LEFT_EYE_CONTOUR, 468], [RIGHT_EYE_CONTOUR, 473]].forEach(([contour, iris], i) => {
      const e = eyePose(lm, contour as readonly number[], iris as number, p);
      const eye = this.eyes[i];
      eye.position.set(e.center[0], e.center[1], e.center[2]);
      eye.scale.setScalar(e.radius);
      eye.rotation.set(e.rx, e.ry, 0, 'YXZ');
      const glint = this.glints[i];
      glint.position.set(e.center[0] - e.radius * 0.3, e.center[1] + e.radius * 0.3, e.center[2] + e.radius * 1.01);
      glint.scale.setScalar(Math.max(1.5, e.radius * 0.12));
    });
  }

  private updateMouth(lm: Landmark[], p: Projection, open: boolean, gap: number) {
    const S = (i: number) => toScene(lm[i], p);
    const ring = LIPS_INNER.slice(0, -1).map(S); // LIPS_INNER repeats its first index at the end
    const mouthW = Math.hypot(S(308)[0] - S(78)[0], S(308)[1] - S(78)[1]);
    const lipZ = ring.reduce((s, q) => s + q[2], 0) / ring.length;
    const mid = LIPS_INNER_UPPER.map((u, k) => {
      const a = S(u), b = S(LIPS_INNER_LOWER[k]);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as V3;
    });
    const seamLine = [S(78), ...mid, S(308)];
    this.cavity.visible = this.teeth.visible = open;
    this.toothSeam.visible = open && gap < 0.1;
    this.closedLip.visible = this.lipSeam.visible = !open;
    if (!open) {
      writeTris(this.closedLip, fan(ring, 0.5));
      writeTris(this.lipSeam, ribbon(seamLine, 1, 1));
      return;
    }
    writeTris(this.cavity, fan(ring.map((q) => [q[0], q[1], lipZ] as V3), -mouthW * 0.3));
    const half = Math.hypot(S(13)[0] - S(14)[0], S(13)[1] - S(14)[1]) / 2;
    const row = half * (1 - gap) + Math.min(mouthW * TOOTH_BAND, half * TOOTH_BAND_MAX_HALF_GAP) * gap;
    const toothZ = -mouthW * 0.1;
    const upper = [78, ...LIPS_INNER_UPPER, 308].map(S).map((q) => [q[0], q[1], lipZ + toothZ] as V3);
    const lower = [78, ...LIPS_INNER_LOWER, 308].map(S).map((q) => [q[0], q[1], lipZ + toothZ] as V3);
    writeTris(this.teeth, [
      ...strip(upper, upper.map((q) => [q[0], q[1] - row, q[2]] as V3)),
      ...strip(lower, lower.map((q) => [q[0], q[1] + row, q[2]] as V3)),
    ]);
    if (gap < 0.1) writeTris(this.toothSeam, ribbon(seamLine.map((q) => [q[0], q[1], lipZ + toothZ] as V3), 0.75, 0.5));
  }

  private updateBrows(lm: Landmark[], p: Projection) {
    const S = (i: number) => toScene(lm[i], p);
    const tris: V3[] = [];
    for (const brow of [LEFT_EYEBROW, RIGHT_EYEBROW]) {
      const up = brow.slice(0, 5).map(S), low = brow.slice(5).reverse().map(S);
      const w = Math.hypot(up[4][0] - up[0][0], up[4][1] - up[0][1]);
      const lift = (q: V3): V3 => [q[0], q[1], q[2] + w * 0.08];
      tris.push(...strip(up.map(lift), low.map(lift)));
    }
    writeTris(this.brows, tris);
  }

  private updateHands(hands: Landmark[][], p: Projection) {
    let b = 0, j = 0;
    const m = this.tmp;
    this.palms.forEach((pm) => (pm.visible = false));
    hands.filter((h) => h && h.length >= 21).slice(0, 2).forEach((hand, hi) => {
      const rig = handRig(hand, p);
      for (const s of rig.segments) {
        const dir = new THREE.Vector3(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
        const len = dir.length() || 1e-3;
        m.position.set((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        m.scale.set(s.radius, len, s.radius);
        m.updateMatrix();
        this.bones.setMatrixAt(b++, m.matrix);
      }
      for (const jt of rig.joints) {
        m.position.set(jt.p[0], jt.p[1], jt.p[2]);
        m.quaternion.identity();
        m.scale.setScalar(jt.radius);
        m.updateMatrix();
        this.jointBalls.setMatrixAt(j++, m.matrix);
      }
      const pad = rig.palm, palm = this.palms[hi];
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...pad.v).multiplyScalar(pad.sv),
        new THREE.Vector3(...pad.u).multiplyScalar(pad.su),
        new THREE.Vector3(...pad.n).multiplyScalar(pad.sn),
      );
      basis.setPosition(pad.center[0], pad.center[1], pad.center[2]);
      palm.matrixAutoUpdate = false;
      palm.matrix.copy(basis);
      palm.visible = true;
    });
    this.bones.count = b;
    this.jointBalls.count = j;
    this.bones.instanceMatrix.needsUpdate = true;
    this.jointBalls.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
```

Note for the implementer: the per-frame `new THREE.Vector3` / `Matrix4` in `updateHands` is fine at 2 hands × 16 segments; do not micro-optimise it.

- [ ] **Step 2: Rewrite `components/face/FaceMeshRenderer.ts`.** Keep the header comment (update it to say "Three.js scene plus 2D overlays"), `STAGE_BG`, `PuppetFrame`, the gaze-ray maths and `drawMocapDots`. Replace the rest with:

```ts
import { Landmark } from '../shared/trackerTypes';
import { fitProjection, Projection } from './projection';
import { MeshDetail } from './faceGeometry';
import { PuppetScene } from './PuppetScene';
import { PuppetState, boostBrows, boostJaw, boostBlink, teethGap } from './puppetState';
import { LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LEFT_EYEBROW, RIGHT_EYEBROW, MOCAP_POINTS } from './faceTopology';

export const STAGE_BG = '#090A0C';
const ACCENT = '#EE3B2B';

export interface PuppetFrame {
  face: Landmark[] | null;
  hands: Landmark[][];
  state: PuppetState;
}

export interface PuppetOptions {
  showGazeRays: boolean;
  showMocapDots: boolean;
  videoAspect: number;
  /** 0..1 Brow Boost slider (0 = raw landmarks). */
  browBoost: number;
  /** 0..1 Jaw Boost slider: parts the teeth sooner and drops the lower lip/chin. */
  jawBoost: number;
  /** 0..1 Blink Boost slider: deeper blinks, real blinks snap shut. */
  blinkBoost: number;
  /** Crease Angle in degrees, 0..90. */
  creaseAngle: number;
  meshDetail: MeshDetail;
}

const scenes = new WeakMap<HTMLCanvasElement, PuppetScene>();

function sceneFor(canvas: HTMLCanvasElement, w: number, h: number): PuppetScene {
  let s = scenes.get(canvas);
  if (!s) { s = new PuppetScene(w, h); scenes.set(canvas, s); }
  if (s.canvas.width !== w || s.canvas.height !== h) s.setSize(w, h);
  return s;
}

/** Release the WebGL context behind a canvas (call when an export finishes). */
export function disposePuppet(canvas: HTMLCanvasElement) {
  scenes.get(canvas)?.dispose();
  scenes.delete(canvas);
}

/** 2D gaze ray from the eye-contour center through the iris landmark. */
const drawGazeRay = (ctx: CanvasRenderingContext2D, lm: Landmark[], contour: readonly number[], iris: number, p: Projection) => {
  if (!lm[iris]) return;
  let cx = 0, cy = 0;
  for (const i of contour) { cx += p.x(lm[i]); cy += p.y(lm[i]); }
  cx /= contour.length; cy /= contour.length;
  const px = p.x(lm[iris]), py = p.y(lm[iris]);
  const m = Math.hypot(px - cx, py - cy);
  const nx = m > 0.5 ? (px - cx) / m : 0, ny = m > 0.5 ? (py - cy) / m : 0;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + nx * 45, py + ny * 45);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(px + nx * 45, py + ny * 45, 2, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
};

const drawMocapDots = (ctx: CanvasRenderingContext2D, lm: Landmark[], p: Projection) => {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (const idx of [...MOCAP_POINTS, ...LEFT_EYEBROW, ...RIGHT_EYEBROW]) {
    if (!lm[idx]) continue;
    ctx.beginPath();
    ctx.arc(p.x(lm[idx]), p.y(lm[idx]), 2, 0, Math.PI * 2);
    ctx.fill();
  }
};

export function drawPuppet(ctx: CanvasRenderingContext2D, frame: PuppetFrame, w: number, h: number, opts: PuppetOptions) {
  const p = fitProjection(w, h, opts.videoAspect);
  let face: Landmark[] | null = null;
  let eyeSource: Landmark[] | null = null;
  if (frame.face && frame.face.length >= 468) {
    eyeSource = boostJaw(boostBrows(frame.face, frame.state.brows, opts.browBoost, opts.videoAspect), frame.state, opts.jawBoost, opts.videoAspect);
    face = boostBlink(eyeSource, frame.state, opts.blinkBoost);
  }
  let scene: PuppetScene;
  try {
    scene = sceneFor(ctx.canvas, w, h);
  } catch {
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WEBGL UNAVAILABLE: THE PUPPET NEEDS A WEBGL-CAPABLE BROWSER', w / 2, h / 2);
    return;
  }
  scene.render({
    face, eyeSource, hands: frame.hands,
    mouthOpen: frame.state.mouthOpen,
    teethGap: teethGap(frame.state, opts.jawBoost),
    creaseAngle: opts.creaseAngle,
    meshDetail: opts.meshDetail,
  }, p);
  ctx.drawImage(scene.canvas, 0, 0, w, h);
  if (face) {
    if (opts.showGazeRays) {
      drawGazeRay(ctx, face, LEFT_EYE_CONTOUR, 468, p);
      drawGazeRay(ctx, face, RIGHT_EYE_CONTOUR, 473, p);
    }
    if (opts.showMocapDots) drawMocapDots(ctx, face, p);
  }
}
```

(`ctx.canvas` is typed `HTMLCanvasElement | OffscreenCanvas`; cast it `ctx.canvas as HTMLCanvasElement` in `sceneFor(...)`. Both callers pass an `HTMLCanvasElement` 2D context.)

- [ ] **Step 3: Wire the minimum into `FaceDemo.tsx` so it compiles.** Add `blinkBoost: 0.5, creaseAngle: 35, meshDetail: 'low'` as literal values to BOTH `drawPuppet` option objects (the stage loop and the export `draw`). Task 8 replaces these with UI state.

- [ ] **Step 4: Typecheck and test.** Run: `npm run typecheck; npm test`. Expected: clean, all tests pass (`lowPoly`/`handMesh` tests still pass; their files are unused but still present).

- [ ] **Step 5: Smoke-render in the dev server.** Start `puppeteer-lab-dev` from `.claude/launch.json` (preview tool), open Face Puppet, load `tools/fixtures/synthetic-face-take.json` through the hidden file input, and click into the scrub bar. Confirm: a shaded gray head, eyes visible, mouth and brows drawn, no console errors (`read_console_messages`). If the face is invisible, check the winding/camera first (`side: DoubleSide` is on) and then the z range. Report what you see; do not tune lights yet.

- [ ] **Step 6: Commit.**

```bash
git add components/face/PuppetScene.ts components/face/FaceMeshRenderer.ts components/FaceDemo.tsx
git commit -m "Face Puppet renders with Three.js: crease-shaded face, studio lights, eyeballs, 3D mouth/brows, capsule hands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Controls, state wiring, export dispose, remove the 2D modules

**Files:**
- Modify: `components/FaceDemo.tsx`
- Delete (`git rm`): `components/face/lowPoly.ts`, `components/face/lowPoly.test.ts`, `components/face/handMesh.ts`, `components/face/handMesh.test.ts`

**Interfaces:**
- Consumes: `PuppetOptions` (Task 7), `stepPuppetState(..., blinkBoost)` (Task 5), `disposePuppet` (Task 7), `MeshDetail` (Task 4).

- [ ] **Step 1: State.** In `FaceDemo.tsx`, next to `const [jawBoost, setJawBoost] = useState(0.75);`, add:

```tsx
  const [blinkBoost, setBlinkBoost] = useState(0.5);
  const [creaseAngle, setCreaseAngle] = useState(35);
  const [meshDetail, setMeshDetail] = useState<MeshDetail>('low');
```

and `import { MeshDetail } from './face/faceGeometry';` plus `disposePuppet` in the `./face/FaceMeshRenderer` import.

- [ ] **Step 2: Pass options and the blink boost.**
  - In the stage render loop: `stepPuppetState(puppetStateRef.current, currentLandmarks, currentBlendshapesRecord, aspect, blinkBoost)`, and replace the Task 7 literals with `blinkBoost, creaseAngle, meshDetail`. Add `blinkBoost, creaseAngle, meshDetail` to that effect's dependency array.
  - In `runExport`'s `draw`, do the same (`stepPuppetState(state, face, frame.blendshapes, aspect, blinkBoost)` and the three options). Also capture the export canvas: add `let exportCanvas: HTMLCanvasElement | null = null;` before `renderTakeToVideo`, and set `exportCanvas = ctx.canvas as HTMLCanvasElement;` as the first line of `draw`. In the `finally` block of `runExport` (it already clears `exportAbortRef`), add `if (exportCanvas) disposePuppet(exportCanvas);`.

- [ ] **Step 3: Controls.** Insert after the Jaw Boost block, same markup pattern:
  - a **Blink Boost** slider (`min 0, max 1, step 0.05`, labels `RAW` / `EXAGGERATED`, title "How far your blinks close the puppet's lids; real blinks snap shut.")
  - a **Crease Angle** slider (`min 0, max 90, step 5`, value readout `{creaseAngle}°`, labels `FACETED` / `SMOOTH`, title "Edges sharper than this angle stay hard; softer ones are smoothed.")
  - a **Mesh** toggle:

```tsx
             {/* Mesh detail (faceGeometry FACE_MESHES) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between items-center text-[11px] text-gray-300">
                     <span className="text-gray-400">Mesh</span>
                     <div className="flex gap-1">
                         {(['low', 'full'] as const).map((d) => (
                             <button
                                 key={d}
                                 type="button"
                                 onClick={() => setMeshDetail(d)}
                                 className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${meshDetail === d ? 'bg-[#EE3B2B] text-white' : 'bg-[#22242B] text-gray-400'}`}
                             >
                                 {d.toUpperCase()}
                             </button>
                         ))}
                     </div>
                 </div>
             </div>
```

- [ ] **Step 4: Remove the 2D modules.** Run `git rm components/face/lowPoly.ts components/face/lowPoly.test.ts components/face/handMesh.ts components/face/handMesh.test.ts`. Then run `grep -rn "lowPoly\|handMesh" components hooks App.tsx`. Expected: no hits. Fix any remaining import to use `./projection`.

- [ ] **Step 5: Gate.** Run: `npm run typecheck; npm test; npm run smoke`. Expected: clean; tests pass (the lowPoly/handMesh tests are gone, the new ones stay); smoke prints `SMOKE OK`.

- [ ] **Step 6: Commit.**

```bash
git add -A components/FaceDemo.tsx components/face
git commit -m "Face Puppet: Blink Boost, Crease Angle and Mesh controls; dispose export scenes; drop the Canvas-2D modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Synthetic blink phase, visual tuning, screenshot proof, export check (controller-run)

Run by the controller (it needs the in-app browser and judgement), not by a subagent.

**Files:**
- Modify: `tools/make-synthetic-take.mjs`
- Possibly tune constants in: `PuppetScene.ts` (light intensities, `EYE_SETBACK` in `eyes.ts`, brow lift, cavity depth)

- [ ] **Step 1: Blink phase.** In `tools/make-synthetic-take.mjs`, inside the frame loop next to the brow values, add:

```js
  // Half-closed eyes around 1.2 s, a full blink around 2.5 s (drives Blink Boost).
  const blink = t > 1.1 && t < 1.3 ? 0.5 : t > 2.4 && t < 2.6 ? 1 : 0;
```

and add `eyeBlinkLeft: blink, eyeBlinkRight: blink` to the `blendshapes` object. Run `node tools/make-synthetic-take.mjs; node tools/make-synthetic-take.mjs --hands`.

- [ ] **Step 2: Screenshot set** (dev server, synthetic takes, 1400×850 viewport, canvas crops sent through a local image sink as in the previous session):
  - Low vs Full at 35°
  - Crease Angle 0° / 35° / 90°
  - eyes open (0.3 s) / half (1.2 s) / blink shut (2.5 s)
  - the mouth states (closed 1.0 s, teeth together 0.35 s, open 1.65 s)
  - hands (hands take)

Tune the lights, eye set-back, brow lift and cavity depth until the head reads as a lit gray sculpture and no eyeball pokes through during the ±12° yaw. Re-run the gate after any tuning.

- [ ] **Step 3: Export check.** In the dev server with the synthetic hands take loaded, click Export → Video with the tab visible. Confirm a file downloads and its first frame shows the 3D puppet (drag the file into a new tab or check its size is over 100 KB). Confirm no console errors and that the WebGL context count stays bounded after two exports (no "Too many active WebGL contexts" warning).

- [ ] **Step 4: Commit tuning and fixtures script.**

```bash
git add tools/make-synthetic-take.mjs components/face
git commit -m "Face Puppet: blink phase in the synthetic take; light and eye tuning from screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Ship.** Push `main`, build, run the secret gate, inject the badge, deploy to `/var/www/mocap` (same static swap as the previous deploys, per the `deploy-apps-01` skill). Verify HTTPS 200 and that the new FaceDemo chunk contains "Crease Angle". Send the screenshots to Grayson with the live URL. Update HANDOFF item 0 and `deploy-live` memory, and write the `_agent-commons` log.

---

## Spec coverage check

| Spec item | Task |
|---|---|
| Plain Three.js, drawPuppet signature kept, WeakMap per canvas, overlays on top | 7 |
| Ortho camera with the same mapping; z scale | 2, 7 |
| Low/Full meshes, lip flags, holes cut | 1, 4 |
| Crease groups on the neutral face, 0–90 slider default 35 | 3, 4, 8 |
| Matte gray standard material, key/fill/rim/ambient | 7, tuned in 9 |
| Mouth closed fill + seam; cavity, teeth rows by teethGap, bite seam under 0.1 | 7 |
| Brows flat dark, offset toward the camera | 7 |
| Eyeball placement, self-lit texture, fixed glint, gaze clamp | 6, 7 |
| Blink Boost: blendshapes + aperture fallback, EMA 0.7, gain, snap 0.8/0.6, lid meet 0.2, render-time copy | 5, 7 |
| Side-constant rename covering blinks | 5 |
| Capsule fingers tapered per finger, palm pad a third of width, hands in front | 6, 7 |
| Controls: Blink, Crease, Mesh | 8 |
| Performance: one stage scene, export scene disposed, no per-frame face allocation | 4, 7, 8 |
| WebGL failure message | 7 |
| Unit tests, synthetic blink phase, screenshots, real export, gate | 1–6, 9 |
| Ship and deploy | 9 |

**Deviation from spec:** the spec said 20 finger segments (5 × 4 from the wrist). The plan uses 16: the thumb from the wrist (4) and the other fingers from their knuckles (3 each). The palm pad already covers the four finger metacarpals, and capsules there would poke through it.
