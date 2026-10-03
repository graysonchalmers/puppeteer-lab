# Face Puppet Looks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Face Puppet's shading and light swappable "looks", render four candidates (clay, faceted, toon, neon) on a comparison sheet, and after Grayson picks one, ship it as the default and delete the others.

**Architecture:** A pure data module `components/face/looks.ts` describes each look. `PuppetScene.applyLook` rebuilds the light rig, swaps skin/hand materials, sets background and hand color, and forces a face-buffer rebuild whose vertex colors come from the look (gray, tint, baked cavity darkening). A throwaway Playwright script `scripts/looks-sheet.mjs` renders every look through the share viewer (`/t/<id>?look=&mesh=`) and builds a contact sheet. The `default` look carries today's literals, so the default rendering is unchanged (proved by a baseline-image diff).

**Tech Stack:** TypeScript, Three.js 0.167.1, Vitest 5 (`environment: 'node'`, no WebGL in unit tests), Playwright (Chromium) for the browser gate.

**Spec:** `docs/superpowers/specs/2026-10-03-face-puppet-looks-design.md`

## Global Constraints
- Shading, light and material only; topology (`FACE_TRIS` 298 tris, `FACE_TRIS_FULL` 840 tris) is untouched.
- The `default` look must render pixel-equivalent to today (sheet baseline diff under 0.2% of pixels).
- Eyes, teeth, brows, lips (closed lip, seam) and the mouth cavity stay `MeshBasicMaterial`, fixed color, unaffected by looks.
- Hands take the look's skin kind, color and lights.
- No per-frame allocation is added to the face geometry update path (the outline hull reuses one preallocated `Float32Array`).
- Look changes happen at most once per session in product (via `?look=`), never per frame; `applyLook` is a no-op when the look id is unchanged.
- The `?look=` and `?mesh=` query params are read only by `TakeViewer`, are harness-only, and unknown values fall back to the default look / `low`.
- Tasks run sequentially on local `main` (repo convention is direct-to-main); no worktrees. Do not push; Grayson decides.
- Run the node-hog reaper before gates: `. C:\Projects-local\_agent-commons\tools\Stop-NodeHogs.ps1; Invoke-NodeHogReaper -Force`. `components/shared/recordingSchema.test.ts` "under 100ms" is a known load-sensitive flake; rerun it alone.
- Shell for Grayson is PowerShell 5.1: no `&&`; use `;`. Subagent shell tools may use either.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
1. `?look=__proto__`, `?look=constructor`, empty or uppercase ids must fall back to the default look, not crash or pick a prototype property. (Task 1 test.)
2. A frame with no face (the fixture's dropout, 1800..2550 ms) under every look must not throw: the look is applied before any face mesh exists and the outline/face meshes must hide with no face. (Task 4 and Task 5 sheet check at `T_NOFACE`.)
3. Switching mesh detail (`low` to `full`) under a non-default look must keep the look's tint and cavity darkening, since buffers are rebuilt per detail. (Task 2 test, sheet `full` cases.)
4. `creaseAngle: 0` (faceted) must build crease groups without error and give each triangle its own normal. (Task 2 test.)
5. Repeated look application must not leak GPU materials/textures: old skin materials, toon gradient and outline geometry are disposed on swap. (Task 5 code review point; sheet script runs with no page errors.)

## File Structure
- Create `components/face/looks.ts`: `Look` type, `LOOKS` (default + 4 candidates), `lookById`, `shadeOf`.
- Create `components/face/looks.test.ts`.
- Create `components/face/cavity.ts`: static cavity vertex set and `cornerCavity(detail)`.
- Create `components/face/cavity.test.ts`.
- Modify `components/face/faceGeometry.ts`: `FaceShade`, `DEFAULT_SHADE`, `createFaceBuffers(detail, shade?)`.
- Modify `components/face/faceGeometry.test.ts`: shade tests.
- Modify `components/face/creaseGroups.test.ts`: angle 0 test.
- Modify `components/face/PuppetScene.ts`: `applyLook`, rig fill, materials, outline hull, background.
- Modify `components/face/FaceMeshRenderer.ts`: `PuppetOptions.look`, `SceneInput.look` pass-through.
- Modify `components/TakeViewer.tsx`: read `?look=` and `?mesh=` once.
- Modify `scripts/lib/viewer-harness.mjs`: `openViewer(..., query = '')`.
- Create `scripts/looks-sheet.mjs`; modify `package.json` (`looks-sheet` script).

---

### Task 1: `looks.ts` data module and tests

**Files:**
- Create: `components/face/looks.ts`
- Test: `components/face/looks.test.ts`

**Interfaces:**
- Consumes: `FaceShade` and `DEFAULT_SHADE` from `faceGeometry.ts` come in Task 2; in this task `shadeOf` is not yet defined (added in Task 2). Define only the items below.
- Produces:
  ```ts
  export type LookId = 'default' | 'clay' | 'faceted' | 'toon' | 'neon';
  export interface LightSpec { color: number; intensity: number; pos: [number, number, number] }
  export interface Look {
    id: LookId;
    background: number;
    skinGray: number; lipGray: number;
    creaseAngle: number | null;
    skin: 'standard' | 'toon';
    toonBands: number;
    roughness: number;
    cavity: number;
    tint: { skin: number; lip: number };
    ambient: { color: number; intensity: number };
    lights: LightSpec[];
    hemisphere?: { sky: number; ground: number; intensity: number };
    outline?: { color: number; width: number };
    handColor: number;
  }
  export const LOOKS: Record<LookId, Look>;
  export const DEFAULT_LOOK_ID: LookId; // 'default'
  export function lookById(id: string | null | undefined): Look;
  ```

- [ ] **Step 1: Write the failing test** `components/face/looks.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { LOOKS, DEFAULT_LOOK_ID, lookById, LookId } from './looks';
import { SKIN_GRAY, LIP_GRAY } from './faceGeometry';

const IDS = Object.keys(LOOKS) as LookId[];
const isColor = (c: number) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

describe('looks', () => {
  it('has the default look plus the four candidates, keyed by their own id', () => {
    expect(IDS.sort()).toEqual(['clay', 'default', 'faceted', 'neon', 'toon']);
    for (const id of IDS) expect(LOOKS[id].id).toBe(id);
    expect(DEFAULT_LOOK_ID).toBe('default');
  });

  it('the default look equals the pre-looks constants exactly', () => {
    const d = LOOKS.default;
    expect(d.background).toBe(0x090a0c);
    expect(d.skinGray).toBe(SKIN_GRAY);
    expect(d.lipGray).toBe(LIP_GRAY);
    expect(d.creaseAngle).toBeNull();
    expect(d.skin).toBe('standard');
    expect(d.roughness).toBe(0.75);
    expect(d.cavity).toBe(0);
    expect(d.tint).toEqual({ skin: 0xffffff, lip: 0xffffff });
    expect(d.ambient).toEqual({ color: 0xffffff, intensity: 0.15 });
    expect(d.lights).toEqual([
      { color: 0xffffff, intensity: 3.2, pos: [-0.8, 0.6, 0.7] },
      { color: 0xffffff, intensity: 0.7, pos: [0.8, -0.2, 0.8] },
      { color: 0xffffff, intensity: 2.5, pos: [0.3, 0.8, -1] },
    ]);
    expect(d.hemisphere).toBeUndefined();
    expect(d.outline).toBeUndefined();
    expect(d.handColor).toBe(0xa3a7ad);
  });

  it('every look has in-range values', () => {
    for (const id of IDS) {
      const l = LOOKS[id];
      for (const c of [l.background, l.tint.skin, l.tint.lip, l.ambient.color, l.handColor, ...l.lights.map((x) => x.color)]) expect(isColor(c)).toBe(true);
      for (const g of [l.skinGray, l.lipGray]) { expect(g).toBeGreaterThan(0); expect(g).toBeLessThanOrEqual(1); }
      expect(l.cavity).toBeGreaterThanOrEqual(0);
      expect(l.cavity).toBeLessThanOrEqual(1);
      expect(l.roughness).toBeGreaterThanOrEqual(0);
      expect(l.roughness).toBeLessThanOrEqual(1);
      expect(l.ambient.intensity).toBeGreaterThanOrEqual(0);
      expect(l.lights.length).toBeGreaterThan(0);
      for (const x of l.lights) { expect(x.intensity).toBeGreaterThanOrEqual(0); expect(x.intensity).toBeLessThanOrEqual(10); expect(x.pos).toHaveLength(3); }
      if (l.creaseAngle !== null) { expect(l.creaseAngle).toBeGreaterThanOrEqual(0); expect(l.creaseAngle).toBeLessThanOrEqual(90); }
      if (l.skin === 'toon') expect(l.toonBands).toBeGreaterThanOrEqual(2);
      if (l.outline) { expect(isColor(l.outline.color)).toBe(true); expect(l.outline.width).toBeGreaterThan(0); }
    }
  });

  it('lookById resolves known ids and falls back to default for anything else', () => {
    expect(lookById('clay')).toBe(LOOKS.clay);
    for (const bad of [null, undefined, '', 'CLAY', 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(lookById(bad)).toBe(LOOKS.default);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `npx vitest run components/face/looks.test.ts`
Expected: FAIL, cannot resolve `./looks`.

- [ ] **Step 3: Write `components/face/looks.ts`**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet looks: the shading, light and material of the head and hands, as pure data (no three.js import).
 * `default` is the pre-looks rendering, value for value. The other four are candidates under design review; the
 * chosen one replaces `default` and the rest are deleted. Colors are 0xRRGGBB; light positions are in the rig's
 * camera-locked frame (+x right, +y up, +z toward the viewer).
 */
import { SKIN_GRAY, LIP_GRAY } from './faceGeometry';

export type LookId = 'default' | 'clay' | 'faceted' | 'toon' | 'neon';

export interface LightSpec { color: number; intensity: number; pos: [number, number, number] }

export interface Look {
  id: LookId;
  background: number;
  /** Base vertex gray for skin and lips (0..1), multiplied by `tint`. */
  skinGray: number;
  lipGray: number;
  /** Crease angle in degrees; null = use the UI slider value. */
  creaseAngle: number | null;
  skin: 'standard' | 'toon';
  /** Number of lighting bands when `skin` is 'toon'. */
  toonBands: number;
  roughness: number;
  /** 0..1 strength of the baked darkening in eye sockets, nostrils and under the lip. */
  cavity: number;
  tint: { skin: number; lip: number };
  ambient: { color: number; intensity: number };
  lights: LightSpec[];
  hemisphere?: { sky: number; ground: number; intensity: number };
  /** Inverted-hull outline; `width` is in scene units (stage pixels). */
  outline?: { color: number; width: number };
  handColor: number;
}

const WHITE = 0xffffff;

export const LOOKS: Record<LookId, Look> = {
  default: {
    id: 'default', background: 0x090a0c, skinGray: SKIN_GRAY, lipGray: LIP_GRAY, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.75, cavity: 0, tint: { skin: WHITE, lip: WHITE },
    ambient: { color: WHITE, intensity: 0.15 },
    lights: [
      { color: WHITE, intensity: 3.2, pos: [-0.8, 0.6, 0.7] },
      { color: WHITE, intensity: 0.7, pos: [0.8, -0.2, 0.8] },
      { color: WHITE, intensity: 2.5, pos: [0.3, 0.8, -1] },
    ],
    handColor: 0xa3a7ad,
  },
  // Starting values; tuned on the comparison sheet (scripts/looks-sheet.mjs).
  clay: {
    id: 'clay', background: 0x0d0b0a, skinGray: 0.7, lipGray: 0.52, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.9, cavity: 0.55, tint: { skin: 0xffe3d0, lip: 0xf2c4b4 },
    ambient: { color: 0xfff1e6, intensity: 0.28 },
    lights: [
      { color: 0xfff0e0, intensity: 2.6, pos: [-0.9, 0.7, 0.8] },
      { color: 0xdfe8ff, intensity: 0.6, pos: [0.9, -0.1, 0.7] },
      { color: 0xbcd4ff, intensity: 1.6, pos: [0.4, 0.9, -1] },
    ],
    handColor: 0xc9a791,
  },
  faceted: {
    id: 'faceted', background: 0x08090b, skinGray: 0.66, lipGray: 0.48, creaseAngle: 0,
    skin: 'standard', toonBands: 3, roughness: 0.5, cavity: 0, tint: { skin: WHITE, lip: WHITE },
    ambient: { color: WHITE, intensity: 0.05 },
    lights: [
      { color: WHITE, intensity: 4.2, pos: [-0.9, 0.8, 0.5] },
      { color: WHITE, intensity: 1.5, pos: [0.6, 0.4, -1] },
    ],
    hemisphere: { sky: 0xeaf2ff, ground: 0x2a2420, intensity: 0.6 },
    handColor: 0xa9b0ba,
  },
  toon: {
    id: 'toon', background: 0x14161b, skinGray: 0.78, lipGray: 0.5, creaseAngle: 60,
    skin: 'toon', toonBands: 3, roughness: 0.8, cavity: 0.2, tint: { skin: 0xffd9c0, lip: 0xe89aa0 },
    ambient: { color: WHITE, intensity: 0.35 },
    lights: [{ color: WHITE, intensity: 2.4, pos: [-0.7, 0.7, 0.8] }],
    outline: { color: 0x050505, width: 3 },
    handColor: 0xe4c3ad,
  },
  neon: {
    id: 'neon', background: 0x050508, skinGray: 0.3, lipGray: 0.22, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.4, cavity: 0.8, tint: { skin: 0xb8c4ff, lip: 0xff9ad0 },
    ambient: { color: 0x202040, intensity: 0.12 },
    lights: [
      { color: 0x00e5ff, intensity: 3.6, pos: [-1, 0.4, 0.6] },
      { color: 0xff2bd6, intensity: 3.2, pos: [1, 0.2, 0.5] },
      { color: WHITE, intensity: 1.2, pos: [0, 0.9, -1] },
    ],
    handColor: 0x7a86c8,
  },
};

export const DEFAULT_LOOK_ID: LookId = 'default';

/** Own-property lookup so ids like `__proto__` or `constructor` fall back instead of resolving. */
export function lookById(id: string | null | undefined): Look {
  return id != null && Object.hasOwn(LOOKS, id) ? LOOKS[id as LookId] : LOOKS[DEFAULT_LOOK_ID];
}
```

- [ ] **Step 4: Run to verify it passes**
Run: `npx vitest run components/face/looks.test.ts`
Expected: PASS (4 tests). If `Object.hasOwn` is rejected by `tsc` lib target, use `Object.prototype.hasOwnProperty.call(LOOKS, id)` and rerun `npx tsc --noEmit`.

- [ ] **Step 5: Typecheck and commit**
Run: `npx tsc --noEmit` (expect clean).
```
git add components/face/looks.ts components/face/looks.test.ts
git commit -m "feat(face): looks data module with default plus four candidate looks"
```

---

### Task 2: Face shade (tint, gray, baked cavity) in the geometry buffers

**Files:**
- Create: `components/face/cavity.ts`, `components/face/cavity.test.ts`
- Modify: `components/face/faceGeometry.ts` (add `FaceShade`, `DEFAULT_SHADE`; `createFaceBuffers(detail, shade = DEFAULT_SHADE)`)
- Modify: `components/face/looks.ts` (add `shadeOf`)
- Test: `components/face/faceGeometry.test.ts`, `components/face/creaseGroups.test.ts`

**Interfaces:**
- Consumes: `Look` (Task 1); `FACE_MESHES`, `MeshDetail`, `SKIN_GRAY`, `LIP_GRAY` (existing); `LEFT_EYE_CONTOUR`, `RIGHT_EYE_CONTOUR` from `faceTopology.ts`.
- Produces:
  ```ts
  // faceGeometry.ts
  export interface FaceShade { skinGray: number; lipGray: number; skinTint: number; lipTint: number; cavity: number }
  export const DEFAULT_SHADE: FaceShade; // {SKIN_GRAY, LIP_GRAY, 0xffffff, 0xffffff, 0}
  export function createFaceBuffers(detail: MeshDetail, shade?: FaceShade): FaceBuffers;
  // cavity.ts
  export const CAVITY_VERTS: ReadonlySet<number>;
  export function cornerCavity(detail: MeshDetail): Float32Array; // per corner, 1 = in a cavity set, else 0; length nTris*3
  // looks.ts
  export function shadeOf(look: Look): FaceShade;
  ```
  Color rule: corner RGB = gray * tintRGB/255 * (1 - cavity * cornerCavity).

- [ ] **Step 1: Write failing tests**

`components/face/cavity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CAVITY_VERTS, cornerCavity } from './cavity';
import { FACE_MESHES } from './faceGeometry';
import { LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from './faceTopology';

describe('cavity', () => {
  it('includes both eye-socket contours', () => {
    for (const i of [...LEFT_EYE_CONTOUR, ...RIGHT_EYE_CONTOUR]) expect(CAVITY_VERTS.has(i)).toBe(true);
  });
  it('marks exactly the corners whose landmark is in the set, for both meshes', () => {
    for (const d of ['low', 'full'] as const) {
      const { tris } = FACE_MESHES[d];
      const w = cornerCavity(d);
      expect(w.length).toBe(tris.length);
      let marked = 0;
      for (let c = 0; c < tris.length; c++) {
        expect(w[c]).toBe(CAVITY_VERTS.has(tris[c]) ? 1 : 0);
        marked += w[c];
      }
      expect(marked).toBeGreaterThan(0);
      expect(marked).toBeLessThan(tris.length);
    }
  });
  it('returns the same cached array on repeat calls', () => {
    expect(cornerCavity('low')).toBe(cornerCavity('low'));
  });
});
```

Append to `components/face/faceGeometry.test.ts` (add imports `DEFAULT_SHADE`, `createFaceBuffers`, `FACE_MESHES`, `SKIN_GRAY`, `LIP_GRAY` as needed; reuse existing imports in that file):
```ts
import { cornerCavity } from './cavity';

describe('createFaceBuffers shade', () => {
  it('the default shade reproduces the pre-looks gray and lip gray exactly', () => {
    for (const d of ['low', 'full'] as const) {
      const { isLip } = FACE_MESHES[d];
      const buf = createFaceBuffers(d);
      for (let t = 0; t < isLip.length; t++) {
        const g = isLip[t] ? LIP_GRAY : SKIN_GRAY;
        for (let k = 0; k < 9; k++) expect(buf.colors[t * 9 + k]).toBeCloseTo(g, 6);
      }
    }
  });
  it('tint multiplies per channel and lips use the lip tint', () => {
    const shade = { ...DEFAULT_SHADE, skinGray: 1, lipGray: 1, skinTint: 0xff8000, lipTint: 0x0000ff };
    const { isLip } = FACE_MESHES.low;
    const buf = createFaceBuffers('low', shade);
    const t = isLip.indexOf(0), l = isLip.indexOf(1);
    expect([buf.colors[t * 9], buf.colors[t * 9 + 1], buf.colors[t * 9 + 2]].map((x) => +x.toFixed(3))).toEqual([1, 0.502, 0]);
    expect([buf.colors[l * 9], buf.colors[l * 9 + 1], buf.colors[l * 9 + 2]].map((x) => +x.toFixed(3))).toEqual([0, 0, 1]);
  });
  it('cavity darkens only cavity corners, in both meshes (look survives a detail switch)', () => {
    const shade = { ...DEFAULT_SHADE, cavity: 0.5 };
    for (const d of ['low', 'full'] as const) {
      const w = cornerCavity(d);
      const plain = createFaceBuffers(d);
      const dark = createFaceBuffers(d, shade);
      let hit = 0;
      for (let c = 0; c < w.length; c++) {
        for (let k = 0; k < 3; k++) {
          const a = plain.colors[c * 3 + k], b = dark.colors[c * 3 + k];
          if (w[c]) { expect(b).toBeCloseTo(a * 0.5, 6); hit++; } else expect(b).toBeCloseTo(a, 6);
        }
      }
      expect(hit).toBeGreaterThan(0);
    }
  });
});
```

Append to `components/face/creaseGroups.test.ts` (reuse its imports; add `FACE_TRIS`, `CANONICAL_VERTS` if absent):
```ts
it('crease angle 0 builds groups where every corner only sees its own triangle', () => {
  const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 0);
  const corners = FACE_TRIS.length;
  expect(g.offsets.length).toBe(corners + 1);
  for (let c = 0; c < corners; c++) expect(g.offsets[c + 1] - g.offsets[c]).toBe(1);
});
```
Add to `components/face/looks.test.ts` (with `import { shadeOf } from './looks'; import { DEFAULT_SHADE } from './faceGeometry';`):
```ts
it('shadeOf(default) equals DEFAULT_SHADE and maps tint/cavity for other looks', () => {
  expect(shadeOf(LOOKS.default)).toEqual(DEFAULT_SHADE);
  expect(shadeOf(LOOKS.neon)).toEqual({ skinGray: 0.3, lipGray: 0.22, skinTint: 0xb8c4ff, lipTint: 0xff9ad0, cavity: 0.8 });
});
```

- [ ] **Step 2: Run to verify they fail**
Run: `npx vitest run components/face/cavity.test.ts components/face/faceGeometry.test.ts components/face/creaseGroups.test.ts components/face/looks.test.ts`
Expected: FAIL (missing `./cavity`, `DEFAULT_SHADE`, `shadeOf`). If the crease-angle-0 test fails with a real defect in `buildCreaseGroups` (a corner seeing more than its own triangle at angle 0 on coincident-normal flat regions), read `creaseGroups.ts`: at angle 0 a coplanar neighbor may legitimately join the group. If so, change the assertion to "every corner's group has at least 1 triangle and offsets are monotonic" and note why in the commit body; do not alter `creaseGroups.ts`.

- [ ] **Step 3: Implement**

`components/face/cavity.ts`:
```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Static cavity set for the baked darkening some looks apply: landmarks in the eye sockets, the nostril / nose-wing
 * creases and under the lower lip. Indices are MediaPipe canonical-face landmarks; only those present in a mesh's
 * triangles take effect. Starting values: the comparison sheet shows immediately whether a region is wrong.
 */
import type { MeshDetail } from './faceGeometry'; // type-only: faceGeometry imports this module, so no runtime cycle
import { FACE_TRIS, FACE_TRIS_FULL, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from './faceTopology';

const NOSTRILS = [49, 279, 129, 358, 98, 327, 64, 294, 48, 278, 219, 439, 59, 289, 2, 97, 326];
const UNDER_LIP = [17, 84, 314, 18, 83, 313, 200, 421, 199];

export const CAVITY_VERTS: ReadonlySet<number> = new Set([...LEFT_EYE_CONTOUR, ...RIGHT_EYE_CONTOUR, ...NOSTRILS, ...UNDER_LIP]);

const cache = new Map<MeshDetail, Float32Array>();

/** Per-corner 1 if the corner's landmark is in the cavity set, else 0 (corner order = the mesh's triangle list). */
export function cornerCavity(detail: MeshDetail): Float32Array {
  let w = cache.get(detail);
  if (!w) {
    const tris = detail === 'low' ? FACE_TRIS : FACE_TRIS_FULL;
    w = new Float32Array(tris.length);
    for (let c = 0; c < tris.length; c++) w[c] = CAVITY_VERTS.has(tris[c]) ? 1 : 0;
    cache.set(detail, w);
  }
  return w;
}
```

`components/face/faceGeometry.ts`: add `import { cornerCavity } from './cavity';` (cavity.ts imports only the type `MeshDetail` from faceGeometry, so there is no runtime cycle). Then replace `createFaceBuffers`:
```ts
export interface FaceShade { skinGray: number; lipGray: number; skinTint: number; lipTint: number; cavity: number }
export const DEFAULT_SHADE: FaceShade = { skinGray: SKIN_GRAY, lipGray: LIP_GRAY, skinTint: 0xffffff, lipTint: 0xffffff, cavity: 0 };

export function createFaceBuffers(detail: MeshDetail, shade: FaceShade = DEFAULT_SHADE): FaceBuffers {
  const { tris, isLip } = FACE_MESHES[detail];
  const nTris = tris.length / 3;
  const colors = new Float32Array(nTris * 9);
  const cav = shade.cavity > 0 ? cornerCavity(detail) : null;
  const rgb = (tint: number): [number, number, number] => [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255].map((v) => v / 255) as [number, number, number];
  const skin = rgb(shade.skinTint), lip = rgb(shade.lipTint);
  for (let t = 0; t < nTris; t++) {
    const gray = isLip[t] ? shade.lipGray : shade.skinGray;
    const tint = isLip[t] ? lip : skin;
    for (let k = 0; k < 3; k++) {
      const dim = cav ? 1 - shade.cavity * cav[t * 3 + k] : 1;
      for (let ch = 0; ch < 3; ch++) colors[t * 9 + k * 3 + ch] = gray * tint[ch] * dim;
    }
  }
  return {
    positions: new Float32Array(nTris * 9),
    normals: new Float32Array(nTris * 9),
    colors,
    faceNormals: new Float32Array(nTris * 3),
  };
}
```
(Replace the old body; keep `FaceBuffers` interface and `updateFaceBuffers` unchanged.)

`components/face/looks.ts`: add `import { SKIN_GRAY, LIP_GRAY, FaceShade } from './faceGeometry';` (replace the existing import) and
```ts
export function shadeOf(l: Look): FaceShade {
  return { skinGray: l.skinGray, lipGray: l.lipGray, skinTint: l.tint.skin, lipTint: l.tint.lip, cavity: l.cavity };
}
```

- [ ] **Step 4: Run to verify they pass, typecheck**
Run: `npx vitest run components/face; npx tsc --noEmit`
Expected: all `components/face` tests PASS, typecheck clean.

- [ ] **Step 5: Commit**
```
git add components/face
git commit -m "feat(face): face shade (gray, tint, baked cavity) in geometry buffers"
```

---

### Task 3: Sheet script, `?mesh=` harness param, and the default baseline

**Files:**
- Modify: `scripts/lib/viewer-harness.mjs` (`openViewer(page, base, take, query = '')`)
- Modify: `components/TakeViewer.tsx` (read `?mesh=` once; `?look=` arrives in Task 4)
- Create: `scripts/looks-sheet.mjs`
- Modify: `package.json` (`"looks-sheet": "npm run build && node scripts/looks-sheet.mjs"`)

**Interfaces:**
- Consumes: harness `ensureFixture, makeCheck, startPreview, openViewer, seek`; test ids `take-canvas`, `orbit-toggle`.
- Produces: CLI `node scripts/looks-sheet.mjs [--baseline]`. `--baseline` renders only the `default` look and writes `.proof/looks-baseline/<mesh>-<view>.png` (4 files: `low-front`, `low-orbit`, `full-front`, `full-orbit`). Normal run renders all looks, writes `.proof/<date>-looks/<look>-<mesh>-<view>.png` plus `sheet.png`, and asserts. Env `LOOKS_SHEET_PORT` (default 4178), `PROOF_DIR`.

- [ ] **Step 1: Harness and TakeViewer**

In `scripts/lib/viewer-harness.mjs` change `openViewer` to take a trailing `query = ''` and navigate with `` `${base}/t/${TAKE_ID}${query}` `` (callers pass e.g. `'?look=clay&mesh=full'`). Nothing else changes; existing callers omit it.

In `components/TakeViewer.tsx`, in the draw effect (above the `const draw = () => {` line, inside the `useEffect(..., [take])` body), add:
```ts
    // Harness-only (scripts/looks-sheet.mjs): ?mesh=full renders the dense mesh. Unknown values mean the default.
    const meshDetail: MeshDetail = new URLSearchParams(window.location.search).get('mesh') === 'full' ? 'full' : 'low';
```
and replace `meshDetail: 'low'` in the `drawPuppet` options with `meshDetail`. Add `MeshDetail` to the file's imports (`import type { MeshDetail } from './face/faceGeometry';` or merge with an existing faceGeometry import if present).

- [ ] **Step 2: Write `scripts/looks-sheet.mjs`**

```js
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
    check('default: the full mesh differs from the low mesh', dm > 0.005, `${(dm * 100).toFixed(2)}%`);

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
```

Add to `package.json` scripts: `"looks-sheet": "npm run build && node scripts/looks-sheet.mjs",`.

- [ ] **Step 3: Typecheck and unit gate**
Run: `npx tsc --noEmit; npx vitest run` (reaper first). Expected: clean, all tests pass.

- [ ] **Step 4: Capture the pre-looks baseline, then verify it**
Run (PowerShell): `npm run build; node scripts/looks-sheet.mjs --baseline`
Expected: 4 `not blank` PASS lines plus `no page errors` PASS, `.proof/looks-baseline/{low,full}-{front,orbit}.png` exist. Open one and confirm it shows the gray puppet with hands (Read the PNG). If `full-*` equals `low-*` visually, the `?mesh=` wiring is wrong: fix before moving on.
Note: `PuppetScene` does not use looks yet and `?look=` is ignored, so this baseline is what the default look must reproduce. Do not regenerate the baseline after Task 4 begins.

- [ ] **Step 5: Commit** (the baseline PNGs are under gitignored `.proof/`, not committed)
```
git add scripts components/TakeViewer.tsx package.json
git commit -m "feat(face): looks-sheet script and ?mesh= harness param; baseline captured pre-looks"
```

---

### Task 4: Wire looks into `PuppetScene` (standard skin, lights, background, hands, cavity, crease)

**Files:**
- Modify: `components/face/PuppetScene.ts`
- Modify: `components/face/FaceMeshRenderer.ts`
- Modify: `components/TakeViewer.tsx`

**Interfaces:**
- Consumes: `Look`, `LOOKS`, `lookById`, `shadeOf` (Tasks 1-2); `createFaceBuffers(detail, shade)`.
- Produces: `SceneInput.look?: Look`; `PuppetOptions.look?: Look`; `PuppetScene.applyLook(look)` (private, id-gated). Skin kind `'toon'` and outline are accepted but rendered as standard until Task 5 (so `toon` already differs via tint, crease, lights).

- [ ] **Step 1: `PuppetScene.ts` changes**

1. Imports: add `import { Look, LOOKS, shadeOf, LookId } from './looks';`. Remove the `BG` constant and `SKIN_HAND` constant (now `look.background`, `look.handColor`).
2. Replace `addLights` with a rig filler:
```ts
function fillRig(rig: THREE.Group, look: Look) {
  rig.clear();
  rig.add(new THREE.AmbientLight(look.ambient.color, look.ambient.intensity));
  if (look.hemisphere) rig.add(new THREE.HemisphereLight(look.hemisphere.sky, look.hemisphere.ground, look.hemisphere.intensity));
  for (const l of look.lights) {
    const d = new THREE.DirectionalLight(l.color, l.intensity);
    d.position.set(...l.pos);
    rig.add(d);
  }
}
```
and a helper `function newRig(scene: THREE.Scene): THREE.Group { const rig = new THREE.Group(); scene.add(rig); return rig; }`. Keep the explanatory comment about the camera-locked rig.
3. Fields: replace `faceLights!`/`handLights!` initialization lines in the constructor with `this.faceLights = newRig(this.faceScene); this.handLights = newRig(this.handScene);`. Make `handMat` a field: `private handMat = new THREE.MeshStandardMaterial({ color: LOOKS.default.handColor, roughness: 0.75, metalness: 0 });` and delete the local `const handMat` in the constructor (the `InstancedMesh` and palm constructions keep using `this.handMat`). Add `private look: Look = LOOKS.default; private lookId: LookId | null = null;`. At the end of the constructor call `this.applyLook(LOOKS.default);`.
4. Add:
```ts
  /** Id-gated: a no-op unless the look changed. Rebuilds both light rigs, restyles skin and hands, and forces the face
   * buffers to be rebuilt (their vertex colors come from the look) on the next face frame. */
  private applyLook(look: Look) {
    if (this.lookId === look.id) return;
    this.lookId = look.id;
    this.look = look;
    fillRig(this.faceLights, look);
    fillRig(this.handLights, look);
    this.skinMat.roughness = look.roughness;
    this.handMat.color.setHex(look.handColor);
    this.handMat.roughness = look.roughness;
    this.detail = null; // ensureFace rebuilds the buffers with this look's shade
  }
```
5. In `ensureFace`, replace `createFaceBuffers(detail)` with `createFaceBuffers(detail, shadeOf(this.look))`.
6. In `render`, at the top: `this.applyLook(input.look ?? LOOKS.default);`; use `const angle = this.look.creaseAngle ?? input.creaseAngle;` in `this.ensureFace(input.meshDetail, angle)`; replace `setClearColor(BG, 1)` with `setClearColor(this.look.background, 1)`.
7. `SceneInput` gets `look?: Look;` with a doc line "Shading/light look; undefined = the default look."

- [ ] **Step 2: `FaceMeshRenderer.ts`**
Add `import { Look } from './looks';`, `PuppetOptions.look?: Look;` (doc: "Look to render with; undefined = the default look."), and pass `look: opts.look,` in the `scene.render({...})` input.

- [ ] **Step 3: `TakeViewer.tsx`**
Next to the `meshDetail` line from Task 3 add:
```ts
    const look = lookById(new URLSearchParams(window.location.search).get('look')); // harness-only, see looks-sheet.mjs
```
import `lookById` from `./face/looks`, and pass `look,` in the `drawPuppet` options.

- [ ] **Step 4: Typecheck, unit tests, sheet**
Run: `npx tsc --noEmit; npx vitest run` then `npm run looks-sheet` (builds first; needs network like other browser gates).
Expected: typecheck clean; tests pass; sheet PASS on: no page errors, all renders non-blank, all five looks pairwise distinct, full differs from low, and `default matches the pre-looks baseline` for all 4 cases (<0.2%). If a baseline check fails, diff the default path against the old constants (light intensities, roughness, hand color, background) before touching the baseline.
Read `.proof/<date>-looks/sheet.png` and confirm each look is visibly its own thing and the face is not black.

- [ ] **Step 5: Commit**
```
git add components
git commit -m "feat(face): PuppetScene applies looks (lights, tint, cavity, crease, background, hands)"
```

---

### Task 5: Toon skin material and the outline hull

**Files:**
- Modify: `components/face/PuppetScene.ts`

**Interfaces:**
- Consumes: `Look.skin`, `Look.toonBands`, `Look.outline` (Task 1); `applyLook` and fields from Task 4.
- Produces: skin and hand materials follow `look.skin`; `look.outline` draws a back-face hull; old materials/textures/geometry are disposed on swap.

- [ ] **Step 1: Implement**

1. Add a module helper:
```ts
function toonGradient(bands: number): THREE.DataTexture {
  const data = new Uint8Array(bands);
  for (let i = 0; i < bands; i++) data[i] = Math.round(255 * (0.25 + 0.75 * (i / (bands - 1))));
  const t = new THREE.DataTexture(data, bands, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
```
2. Make `skinMat` and `handMat` plain `THREE.Material`-typed fields (`private skinMat: THREE.MeshStandardMaterial | THREE.MeshToonMaterial`, same for `handMat`) and add `private gradient: THREE.DataTexture | null = null;`, `private outlineMesh: THREE.Mesh | null = null;`, `private outlinePos: Float32Array | null = null;`.
3. In `applyLook`, replace the roughness/handColor lines with a call to a new method `restyle(look)`:
```ts
  private restyle(look: Look) {
    this.skinMat.dispose(); this.handMat.dispose(); this.gradient?.dispose(); this.gradient = null;
    if (look.skin === 'toon') {
      this.gradient = toonGradient(look.toonBands);
      this.skinMat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: this.gradient, side: THREE.DoubleSide });
      this.handMat = new THREE.MeshToonMaterial({ color: look.handColor, gradientMap: this.gradient });
    } else {
      this.skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: look.roughness, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
      this.handMat = new THREE.MeshStandardMaterial({ color: look.handColor, roughness: look.roughness, metalness: 0 });
    }
    if (this.faceMesh) this.faceMesh.material = this.skinMat;
    this.bones.material = this.handMat;
    this.jointBalls.material = this.handMat;
    for (const p of this.palms) p.material = this.handMat;
    if (this.outlineMesh) { this.faceScene.remove(this.outlineMesh); this.outlineMesh.geometry.dispose(); (this.outlineMesh.material as THREE.Material).dispose(); this.outlineMesh = null; this.outlinePos = null; }
  }
```
   The constructor's initial `skinMat`/`handMat` definitions become a standard material built from `LOOKS.default` (keep, then `applyLook(LOOKS.default)` at the end of the constructor calls `restyle` and replaces them; dispose of the first pair is therefore harmless). `ensureFace` already assigns `this.skinMat` to the new mesh, so it picks up the current material. The outline is created in `ensureFace` after the face mesh (it depends on the buffers) and removed in `restyle`:
```ts
      if (this.look.outline) {
        this.outlinePos = new Float32Array(this.faceBuf.positions.length);
        const og = new THREE.BufferGeometry();
        og.setAttribute('position', new THREE.BufferAttribute(this.outlinePos, 3));
        this.outlineMesh = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: this.look.outline.color, side: THREE.BackSide }));
        this.outlineMesh.frustumCulled = false;
        this.faceScene.add(this.outlineMesh);
      }
```
   placed inside the `if (this.detail !== detail)` block after the face mesh is added, and in the same block remove any previous outline before creating (when the detail changes the old outline geometry has the wrong length): at the top of that block, `if (this.outlineMesh) { this.faceScene.remove(this.outlineMesh); this.outlineMesh.geometry.dispose(); (this.outlineMesh.material as THREE.Material).dispose(); this.outlineMesh = null; this.outlinePos = null; }`.
4. Each face frame, after `updateFaceBuffers(...)` and before the `needsUpdate` lines:
```ts
      if (this.outlineMesh && this.outlinePos && this.look.outline) {
        const w = this.look.outline.width, P = this.faceBuf.positions, N = this.faceBuf.normals, O = this.outlinePos;
        for (let i = 0; i < P.length; i++) O[i] = P[i] + N[i] * w;
        this.outlineMesh.geometry.getAttribute('position').needsUpdate = true;
      }
```
   Face-less frames: where `this.faceMesh && (this.faceMesh.visible = !!face)` set, also `if (this.outlineMesh) this.outlineMesh.visible = !!face;`. Note the outline pushes along normals pointing at the viewer (normals are oriented toward +z by `updateFaceBuffers`), so with `BackSide` the hull shows as a rim behind the face edge; judge on the sheet.

- [ ] **Step 2: Typecheck and sheet**
Run: `npx tsc --noEmit; npx vitest run; npm run looks-sheet`
Expected: clean; all PASS including default-matches-baseline (restyle must keep default identical: standard material, roughness 0.75, hand color `0xa3a7ad`); no page errors. Read `sheet.png`: the toon row shows banded shading with a dark outline and banded hands; fix visible cracks by lowering `outline.width` or flag the look in the Task 6 report.

- [ ] **Step 3: Commit**
```
git add components/face/PuppetScene.ts
git commit -m "feat(face): toon skin material and inverted-hull outline for looks"
```

---

### Task 6: Tune the four candidates on the sheet, then hand the sheet to Grayson

**Files:**
- Modify: `components/face/looks.ts` (candidate values only), `components/face/cavity.ts` (indices only if a region is wrong)
- Modify: `components/face/looks.test.ts` only if a range bound is exceeded legitimately (do not weaken the default-look equality test).

**Interfaces:**
- Consumes: everything above; the `visual-review-loop` approach (render, critique, change, re-render matched before/after).
- Produces: a final `.proof/<date>-looks/sheet.png` and per-look PNGs; a short written rationale per look; nothing pushed.

- [ ] **Step 1: Render and critique.** `npm run looks-sheet`, Read `sheet.png` and the per-look PNGs. For each non-default look, check: the head reads as a face (eye sockets, nose, mouth readable), eyes/teeth/brows/lips stay readable, hands match the look, nothing is crushed to black or blown out, the phone-size thumbnail is still legible, orbit view is not dark, the full mesh is not noisy. List the specific defects per look.
- [ ] **Step 2: Adjust values** in `looks.ts` (and `cavity.ts` index sets if cavity darkens the wrong region, for example nostrils landing on the cheek). Keep each look distinct from the others (the sheet asserts pairwise difference above 2%). Re-render, compare matched before/after, repeat up to 4 cycles or until no material defect remains.
- [ ] **Step 3: Gate.** Run (after the reaper): `npx tsc --noEmit; npm test; npm run looks-sheet`. Expected: typecheck clean, all tests pass (known flake: rerun `components/shared/recordingSchema.test.ts` alone), sheet all PASS including default-matches-baseline.
- [ ] **Step 4: Commit.**
```
git add components/face
git commit -m "feat(face): tune clay, faceted, toon and neon looks on the comparison sheet"
```
- [ ] **Step 5: Report.** Send `sheet.png` to Grayson (`SendUserFile`, render inline) with one line per look on what it is for and any known weakness. STOP here. Do not delete any look or change the default until Grayson picks.

---

### Task 7: Ship the winner (run only after Grayson picks)

**Files:**
- Modify: `components/face/looks.ts`, `components/face/looks.test.ts`, `components/face/PuppetScene.ts`, `components/face/FaceMeshRenderer.ts`, `components/TakeViewer.tsx`, `components/face/cavity.ts`
- Delete via move to `C:\Projects-local\_to_delete\` (never `rm`): `scripts/looks-sheet.mjs` unless Grayson wants it kept
- Modify: `package.json`, `HANDOFF.md`; Create: `handoff-log/2026-10-03-face-puppet-looks.md`

**Interfaces:**
- Consumes: Grayson's pick (one of `clay | faceted | toon | neon`, or `default` to keep today's).
- Produces: the winner's values as the `default` look; the other candidate looks and the harness plumbing removed; gates green; live export frame checked.

- [ ] **Step 1: Promote.** Copy the winner's field values into `LOOKS.default` (keep `id: 'default'`); delete the other three candidates and their `LookId` members; delete `lookById` / `?look=` / `?mesh=` reads from `TakeViewer.tsx`, `PuppetOptions.look`, `SceneInput.look` and the id-gating in `PuppetScene` if only one look remains (leave the lights/material code driven by the single look constants; remove dead branches the winner does not use, for example toon and outline code when a non-toon look wins, and `cavity.ts` plus `shadeOf` when the winner has `cavity: 0`). Update `looks.test.ts`: the "default equals pre-looks constants" test becomes "default equals the shipped values" (pin the new numbers), delete tests for removed code.
- [ ] **Step 2: Remove the sheet.** Move `scripts/looks-sheet.mjs` to `C:\Projects-local\_to_delete\` and drop the `looks-sheet` package script, unless Grayson says keep it (then keep it with only the `default` look and no `?look=`). Keep the `openViewer(..., query)` param (harmless).
- [ ] **Step 3: Gate.** After the reaper: `npx tsc --noEmit; npm test; npm run smoke; npm run phone-check; npm run share-check; npm run cleanup-check; npm run orbit-check; npm run facedemo-check`. Expected: all green (counts in HANDOFF: 427 tests then, plus the new looks/cavity/shade tests; `phone-check` 97/97, `share-check` 28/28, `cleanup-check` 7/7, `orbit-check` 11/11, `facedemo-check` 27/27). Orbit/facedemo/cleanup gates compare against themselves, not an old baseline, so a changed default look should not fail them; if a pixel gate fails on color alone, investigate before touching thresholds.
- [ ] **Step 4: Export check.** Import the synthetic take in the dev server (`npm run dev`), run one real video export in Face Puppet, extract one frame (or screenshot the export preview) and confirm the new look is in the exported video. Use the screenshot-proof rule: a still of the shipped look in Face Puppet and the viewer sent via `SendUserFile`.
- [ ] **Step 5: Docs and commit.** Update `HANDOFF.md` (current state: shipped look name, gates, nothing deployed or pushed unless done), write `handoff-log/2026-10-03-face-puppet-looks.md` (what was tried, the sheet, the pick and why), write the `_agent-commons\log\` entry, then:
```
git add -A
git commit -m "feat(face): ship the <winner> look as the default; remove the other candidates"
```
Do not push or deploy without Grayson's go (deploy is a separate static redeploy via the go-live skill).

---

## Self-Review
- **Spec coverage:** `looks.ts` module (T1); cavity, tint, gray (T2); `applyLook` lights/material/background/hands, crease override, id-gated, default-equals-today (T4, baseline diff T3-T4); toon + outline + hemisphere (hemisphere in T4 `fillRig`, toon/outline T5); candidate looks and tuning (T1, T6); sheet script with `?look=`, low/full, front/orbit, phone-size thumbnail, non-blank and pairwise-distinct assertions (T3); after-pick promote/delete/handoff/export check/gates (T7); risks: outline cracks (T5/T6 judgment), material disposal (T5 `restyle`), cavity indices (T6), hidden `?look=` (T4, removed T7). Deviation from the spec: the harness also reads `?mesh=` (needed because `TakeViewer` hard-codes `low`); it is harness-only and removed with `?look=` in T7.
- **Placeholder scan:** none; all code steps show code. Cavity index sets and look values are explicit starting values by design, tuned in T6.
- **Type consistency:** `Look`, `LookId`, `LOOKS`, `lookById`, `shadeOf`, `FaceShade`, `DEFAULT_SHADE`, `createFaceBuffers(detail, shade?)`, `cornerCavity`, `CAVITY_VERTS`, `SceneInput.look`, `PuppetOptions.look`, `applyLook`, `restyle` are used with the same names in every task.
