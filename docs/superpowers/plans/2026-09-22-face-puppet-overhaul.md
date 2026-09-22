# Face Puppet Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Face Puppet demo into a faceted low-poly head with a stable mouth, low-poly hands, and two new exports (a shareable video with audio, and a zip pack of video + recording JSON + audio).

**Architecture:** Face (and later hands) move onto the shared `useTracker` loop (TDD-001 Phase 3) with a One Euro filter on face landmarks. Rendering stays Canvas 2D: pure modules (`lowPoly.ts`, `handMesh.ts`, `mouthState.ts`) produce shaded triangle lists and states, and `FaceMeshRenderer.ts` draws them into any canvas (stage or offscreen). Video export replays a take into an offscreen canvas, captures it with `captureStream` + `MediaRecorder` using the take's audio as master clock; the pack zips that video with the existing v3 JSON and the audio via `fflate`.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 5 (node environment), `@mediapipe/tasks-vision` 0.10.9, Canvas 2D, MediaRecorder, Web Audio, `fflate` (new runtime dep), `delaunator` (new dev dep, generator script only).

**Spec:** `docs/superpowers/specs/2026-09-22-face-puppet-overhaul-design.md` (approved 2026-09-22). Read it before starting any task.

## Global Constraints

- Every source file starts with the repo's license header: `/**\n * @license\n * SPDX-License-Identifier: Apache-2.0\n */`.
- Gate for every task that touches code: `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke` all green. `npm run smoke` already runs `build`, so `npm run typecheck; npm test; npm run smoke` is the full gate.
- Tests are vitest in the `node` environment (`vitest.config.ts`); only pure modules get unit tests. No DOM, no React Testing Library.
- Commit direct to `main` (project convention). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not change any demo other than Face Puppet (`components/FaceDemo.tsx`), except the additive `RecorderControls` props in Task 12. Air Canvas, Hand Telemetry, Tempo Strike, Motion Recorder must behave exactly as before.
- Palette: stage background `#090A0C`; gray ramp dark `#2A2D33` to light `#D9DCE1`; single accent `#EE3B2B`; mouth cavity `#0B0C0E`.
- Light direction (screen space, y down, z toward camera is negative): `(-0.45, -0.55, -0.7)` normalized.
- MediaPipe landmark z: smaller = closer to the camera. Depth sort draws larger z first.
- Mouth hysteresis: opens above `0.08`, closes below `0.05`.
- Video MIME order: `video/mp4;codecs=avc1,mp4a`, `video/mp4`, `video/webm;codecs=vp9,opus`, `video/webm`. Export width `min(stageWidth, 1280)`, capture at 30 fps.
- Pack name `puppet-take-YYYYMMDD-HHMMSS.zip` containing `puppet.<ext>`, `recording.json`, `audio.<ext>` (audio omitted when the take has none). Media stored (level 0), JSON deflated (level 6).
- Windows host, Git Bash for the agent; any command handed to Grayson must be PowerShell 5.1 syntax (`;` not `&&`).

## Spec deviations (decided while planning, with reasons)

1. **Hands in `FrameData` reuse the existing `landmarks` field** instead of adding `hands?: {side, landmarks}[]`. `FrameData.landmarks` already carries full hands, and `recordingSchema.ts` already round-trips them through v3 (`buildFullHand` / `extractHandsFromV3`, index 0 = right, index 1 = left). The renderer is chirality-agnostic (two-sided shading), so side is not needed to draw. Known limitation, same as Hand Telemetry today: a frame with only the left hand is labelled `right` in the v3 file.
2. **`capture.smoothing` in the v3 envelope is deferred.** It needs plumbing through `SerializeRequest` and the worker for a field nothing reads yet. Recorded as an open question in HANDOFF (Task 16).
3. **`useFaceTracker.ts` is deleted, not turned into an adapter.** Its only consumer is `FaceDemo.tsx`, which moves to `useTracker` directly (Task 5). An adapter with zero consumers is dead code; TDD-001 Phase 4 deletes adapters anyway.
4. **Finger shading is continuous, not strictly two tones** (accepted at the final whole-branch review, 2026-09-22). Each finger segment's tone is `0.45 + 0.35 * |segment direction · 2D light|` on the gray ramp (`components/face/handMesh.ts`), so it varies continuously from 0.45 to 0.80 rather than taking exactly two fixed tones; it reads better as the hand turns and stays on the ramp.
5. **Two extra mouth tones extend the palette** (accepted at the final whole-branch review, 2026-09-22): closed-mouth fill `#3A3D44` and the closed-mouth seam `#15171B`, alongside the specified cavity `#0B0C0E`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `components/shared/oneEuro.ts` (+ test) | create | One Euro filter bank over landmark arrays; slider mapping |
| `components/face/mouthState.ts` (+ test) | create | Scale-invariant mouth open ratio + hysteresis |
| `components/shared/facePolicy.ts` (+ test) | create | Alternate-tick face policy (TDD-001) |
| `components/shared/trackerTypes.ts` | modify | `TrackedFace.rawLandmarks` |
| `components/shared/buildFrame.ts` (+ test) | modify | Face filtering via `faceFilter` option; reset on face loss |
| `hooks/useTracker.ts` | modify | Face and combined face+hands paths |
| `hooks/useFaceTracker.ts` | delete (git rm) | Replaced by `useTracker` |
| `tools/data/canonical_face_model.obj` | create | MediaPipe canonical face (Apache-2.0), topology reference |
| `tools/gen-face-topology.mjs` | create | One-shot generator of `faceTopology.ts` |
| `components/face/faceTopology.ts` (+ test) | generated | Contours, triangle table, lip flags |
| `components/face/lowPoly.ts` (+ test) | create | Projection, Lambert, color ramp, shaded face triangles |
| `components/face/FaceMeshRenderer.ts` | rewrite | `drawPuppet`: background, mesh, eyes, mouth, hands, overlays |
| `tools/make-synthetic-take.mjs` | create | Synthetic face (+hands) take for camera-less screenshots |
| `components/face/exportPack.ts` (+ test) | create | MIME pick, extensions, timestamp, zip builder |
| `components/shared/download.ts` | create | `downloadBlob` helper |
| `hooks/useRecorder.ts` | modify | `buildRecordingBlob`, `getAudio`, `getFrames` seam |
| `components/face/exportVideo.ts` | create | Real-time offscreen render to video |
| `components/RecorderControls.tsx` | modify | Optional `primaryExport`, `extraExports`, `busy` props |
| `components/face/handMesh.ts` (+ test) | create | Low-poly hand triangles |
| `components/shared/recordingSchema.ts` (+ test) | modify | `channelsFor` (face+hands) |
| `components/FaceDemo.tsx` | modify | Wiring for every phase |
| `HANDOFF.md`, `PLANNING.md`, `demos/face-telemetry/PLANNING.md` | modify | Docs (Task 16) |

---

# Phase 1: Face into `useTracker`, One Euro, mouth ratio

### Task 1: One Euro filter bank

**Files:**
- Create: `components/shared/oneEuro.ts`
- Test: `components/shared/oneEuro.test.ts`

**Interfaces:**
- Consumes: `Landmark` from `components/shared/trackerTypes.ts` (`{ x: number; y: number; z: number }`).
- Produces:
  - `interface OneEuroParams { minCutoff: number; beta: number; dCutoff: number }`
  - `const FACE_ONE_EURO_DEFAULTS: OneEuroParams` = `{ minCutoff: 0.5, beta: 40, dCutoff: 1 }`
  - `function faceSmoothingToMinCutoff(amount01: number): number` (0 -> 5 Hz light, 1 -> 0.05 Hz heavy)
  - `interface OneEuroBank { params: OneEuroParams; filter(points: Landmark[], tMs: number): Landmark[]; reset(): void }`
  - `function createOneEuroBank(params?: OneEuroParams): OneEuroBank`

- [ ] **Step 1: Write the failing test** `components/shared/oneEuro.test.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { createOneEuroBank, faceSmoothingToMinCutoff, FACE_ONE_EURO_DEFAULTS } from './oneEuro';

const pt = (x: number) => [{ x, y: 0.5, z: 0 }];
const FRAME_MS = 1000 / 60;

// Deterministic pseudo-noise in [-1, 1] (LCG), so the test never flakes.
const noise = (() => {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 - 1;
  };
})();

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe('createOneEuroBank', () => {
  it('passes the first sample through untouched', () => {
    const bank = createOneEuroBank();
    expect(bank.filter(pt(0.3), 0)[0].x).toBe(0.3);
  });

  it('suppresses jitter on a still point', () => {
    const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS });
    const inputs: number[] = [];
    const outputs: number[] = [];
    for (let i = 0; i < 180; i++) {
      const x = 0.5 + noise() * 0.003;
      const out = bank.filter(pt(x), i * FRAME_MS)[0].x;
      if (i >= 60) { inputs.push(x); outputs.push(out); }
    }
    expect(std(outputs)).toBeLessThan(std(inputs) * 0.5);
  });

  it('tracks a step within 200 ms', () => {
    const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS });
    let t = 0;
    for (let i = 0; i < 30; i++) bank.filter(pt(0), (t += FRAME_MS));
    let out = 0;
    for (let i = 0; i < 12; i++) out = bank.filter(pt(0.3), (t += FRAME_MS))[0].x;
    expect(out).toBeGreaterThan(0.24);
  });

  it('lags more with a lower minCutoff', () => {
    const run = (minCutoff: number) => {
      const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS, minCutoff });
      let out = 0;
      for (let i = 0; i < 60; i++) out = bank.filter(pt(i * 0.001), i * FRAME_MS)[0].x;
      return out;
    };
    expect(run(0.05)).toBeLessThan(run(5));
  });

  it('reads params live, so a slider can retune minCutoff mid-stream', () => {
    const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS });
    bank.params.minCutoff = 0.05;
    expect(bank.params.minCutoff).toBe(0.05);
  });

  it('passes through again after reset', () => {
    const bank = createOneEuroBank();
    bank.filter(pt(0.1), 0);
    bank.filter(pt(0.1), FRAME_MS);
    bank.reset();
    expect(bank.filter(pt(0.9), 2 * FRAME_MS)[0].x).toBe(0.9);
  });

  it('filters x, y and z independently and keeps array length', () => {
    const bank = createOneEuroBank();
    const out = bank.filter([{ x: 0.1, y: 0.2, z: 0.3 }, { x: 0.4, y: 0.5, z: 0.6 }], 0);
    expect(out).toEqual([{ x: 0.1, y: 0.2, z: 0.3 }, { x: 0.4, y: 0.5, z: 0.6 }]);
  });
});

describe('faceSmoothingToMinCutoff', () => {
  it('maps 0 to 5 Hz and 1 to 0.05 Hz, decreasing, clamped', () => {
    expect(faceSmoothingToMinCutoff(0)).toBeCloseTo(5);
    expect(faceSmoothingToMinCutoff(1)).toBeCloseTo(0.05);
    expect(faceSmoothingToMinCutoff(0.5)).toBeLessThan(faceSmoothingToMinCutoff(0.25));
    expect(faceSmoothingToMinCutoff(-1)).toBeCloseTo(5);
    expect(faceSmoothingToMinCutoff(2)).toBeCloseTo(0.05);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/shared/oneEuro.test.ts`
Expected: FAIL, cannot resolve `./oneEuro`.

- [ ] **Step 3: Implement** `components/shared/oneEuro.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One Euro filter (Casiez et al. 2012) over landmark arrays: an adaptive
 * low-pass that smooths heavily when a point is still and opens up (less
 * lag) when it moves fast. Used for face landmarks (Face Puppet); hands keep
 * the slider-driven lerp in smoothing.ts.
 */
import { Landmark } from './trackerTypes';

export interface OneEuroParams {
  minCutoff: number; // Hz, smoothing at rest (lower = smoother, more lag)
  beta: number;      // speed coefficient (higher = less lag when moving)
  dCutoff: number;   // Hz, cutoff for the derivative estimate
}

export const FACE_ONE_EURO_DEFAULTS: OneEuroParams = { minCutoff: 0.5, beta: 40, dCutoff: 1 };

/** Face Smoothing slider (0..1) to minCutoff: 0 -> 5 Hz (light), 1 -> 0.05 Hz (heavy), log scale. */
export function faceSmoothingToMinCutoff(amount01: number): number {
  const a = Math.max(0, Math.min(1, amount01));
  return 5 * Math.pow(0.01, a);
}

export interface OneEuroBank {
  params: OneEuroParams;
  filter(points: Landmark[], tMs: number): Landmark[];
  reset(): void;
}

const smoothingFactor = (cutoffHz: number, dtS: number) => {
  const r = 2 * Math.PI * cutoffHz * dtS;
  return r / (r + 1);
};

export function createOneEuroBank(params: OneEuroParams = { ...FACE_ONE_EURO_DEFAULTS }): OneEuroBank {
  let x: Float64Array | null = null;  // filtered values, 3 per point
  let dx: Float64Array | null = null; // filtered derivatives
  let lastT = 0;

  const bank: OneEuroBank = {
    params,
    reset() {
      x = null;
      dx = null;
    },
    filter(points, tMs) {
      const n = points.length * 3;
      if (!x || !dx || x.length !== n) {
        x = new Float64Array(n);
        dx = new Float64Array(n);
        points.forEach((p, i) => {
          x![i * 3] = p.x;
          x![i * 3 + 1] = p.y;
          x![i * 3 + 2] = p.z;
        });
        lastT = tMs;
        return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      }

      const dtS = Math.max(1e-3, (tMs - lastT) / 1000);
      lastT = tMs;
      const { minCutoff, beta, dCutoff } = bank.params;
      const aD = smoothingFactor(dCutoff, dtS);

      const out: Landmark[] = new Array(points.length);
      for (let i = 0; i < points.length; i++) {
        const raw = [points[i].x, points[i].y, points[i].z];
        const res = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const k = i * 3 + c;
          const d = (raw[c] - x[k]) / dtS;
          dx[k] = dx[k] + aD * (d - dx[k]);
          const a = smoothingFactor(minCutoff + beta * Math.abs(dx[k]), dtS);
          x[k] = x[k] + a * (raw[c] - x[k]);
          res[c] = x[k];
        }
        out[i] = { x: res[0], y: res[1], z: res[2] };
      }
      return out;
    },
  };
  return bank;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/shared/oneEuro.test.ts`
Expected: PASS (8 tests). If "suppresses jitter" fails narrowly, do NOT loosen the 0.5 factor; check the derivative is filtered with `dCutoff` before computing the cutoff.

- [ ] **Step 5: Commit**

```bash
git add components/shared/oneEuro.ts components/shared/oneEuro.test.ts
git commit -m "Add One Euro filter bank for face landmarks (face puppet P1, task 1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Mouth state (ratio + hysteresis)

**Files:**
- Create: `components/face/mouthState.ts`
- Test: `components/face/mouthState.test.ts`

**Interfaces:**
- Consumes: `Landmark` from `components/shared/trackerTypes.ts`.
- Produces:
  - `const MOUTH_OPEN_ABOVE = 0.08`, `const MOUTH_CLOSE_BELOW = 0.05`
  - `function mouthOpenRatio(lm: Landmark[], videoAspect: number): number` (inner-lip gap / mouth-corner width, x scaled by aspect so both axes are in image-height units)
  - `function nextMouthOpen(wasOpen: boolean, ratio: number): boolean`

- [ ] **Step 1: Write the failing test** `components/face/mouthState.test.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { mouthOpenRatio, nextMouthOpen, MOUTH_OPEN_ABOVE, MOUTH_CLOSE_BELOW } from './mouthState';

// 478 landmarks, all at the center, with the four mouth points placed.
const face = (gap: number, width: number, cx = 0.5, cy = 0.6) => {
  const lm = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  lm[61] = { x: cx - width / 2, y: cy, z: 0 };
  lm[291] = { x: cx + width / 2, y: cy, z: 0 };
  lm[13] = { x: cx, y: cy - gap / 2, z: 0 };
  lm[14] = { x: cx, y: cy + gap / 2, z: 0 };
  return lm;
};

describe('mouthOpenRatio', () => {
  it('is gap over width with x scaled by aspect', () => {
    // width 0.1 normalized at aspect 2 = 0.2 height units; gap 0.02 -> 0.1
    expect(mouthOpenRatio(face(0.02, 0.1), 2)).toBeCloseTo(0.1);
  });

  it('is scale invariant (same face at 2x is the same ratio)', () => {
    expect(mouthOpenRatio(face(0.04, 0.2), 4 / 3)).toBeCloseTo(mouthOpenRatio(face(0.02, 0.1), 4 / 3));
  });

  it('returns 0 for a degenerate mouth width', () => {
    expect(mouthOpenRatio(face(0.02, 0), 4 / 3)).toBe(0);
  });
});

describe('nextMouthOpen', () => {
  const mid = (MOUTH_OPEN_ABOVE + MOUTH_CLOSE_BELOW) / 2;
  it('opens only above the upper threshold', () => {
    expect(nextMouthOpen(false, mid)).toBe(false);
    expect(nextMouthOpen(false, MOUTH_OPEN_ABOVE + 0.001)).toBe(true);
  });
  it('closes only below the lower threshold', () => {
    expect(nextMouthOpen(true, mid)).toBe(true);
    expect(nextMouthOpen(true, MOUTH_CLOSE_BELOW - 0.001)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/face/mouthState.test.ts` — Expected: FAIL, cannot resolve `./mouthState`.

- [ ] **Step 3: Implement** `components/face/mouthState.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mouth open/closed for the Face Puppet: a scale-invariant ratio (inner-lip
 * gap over mouth-corner width) with hysteresis, so the state never flickers
 * at the boundary and does not change with distance to the camera. Replaces
 * the old absolute `mouthOpenDist > 4` pixel test.
 */
import { Landmark } from '../shared/trackerTypes';

export const MOUTH_OPEN_ABOVE = 0.08;
export const MOUTH_CLOSE_BELOW = 0.05;

const UPPER_INNER_LIP = 13;
const LOWER_INNER_LIP = 14;
const LEFT_CORNER = 61;
const RIGHT_CORNER = 291;

/** Normalized x is in image-width units and y in image-height units, so x is
 * scaled by the video aspect (width / height) to measure both in height units. */
export function mouthOpenRatio(lm: Landmark[], videoAspect: number): number {
  const d = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * videoAspect, a.y - b.y);
  const width = d(lm[LEFT_CORNER], lm[RIGHT_CORNER]);
  if (width < 1e-6) return 0;
  return d(lm[UPPER_INNER_LIP], lm[LOWER_INNER_LIP]) / width;
}

export function nextMouthOpen(wasOpen: boolean, ratio: number): boolean {
  return wasOpen ? ratio >= MOUTH_CLOSE_BELOW : ratio > MOUTH_OPEN_ABOVE;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run components/face/mouthState.test.ts`, Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/face/mouthState.ts components/face/mouthState.test.ts
git commit -m "Add scale-invariant mouth state with hysteresis (face puppet P1, task 2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Face filtering in `buildFrame` + alternate-tick policy

**Files:**
- Modify: `components/shared/trackerTypes.ts` (`TrackedFace`)
- Modify: `components/shared/buildFrame.ts` (`BuildFrameOptions`, `buildTrackedFace`, `buildFrame`)
- Create: `components/shared/facePolicy.ts`
- Test: `components/shared/buildFrame.test.ts` (append), `components/shared/facePolicy.test.ts`

**Interfaces:**
- Consumes: `OneEuroBank`, `createOneEuroBank` (Task 1).
- Produces:
  - `TrackedFace` gains `rawLandmarks: Landmark[]` (478, exactly as MediaPipe returned). `landmarks` becomes the filtered set when a bank is passed.
  - `BuildFrameOptions` gains `faceFilter?: OneEuroBank`.
  - `facePolicy.ts`: `function updateAvgDt(avgMs: number, dtMs: number): number` (EMA, 0.9/0.1, first sample passes through); `function nextFaceAlternating(alternating: boolean, avgDtMs: number, bothEnabled: boolean): boolean` (turn on above 1000/30 ms, turn off below 1000/45 ms, always false when not both).

- [ ] **Step 1: Write failing tests**

Append to `components/shared/buildFrame.test.ts` (add `import { createOneEuroBank } from './oneEuro';` and `RawFaceResult` to the existing `./buildFrame` import at the top). If the file already declares any of `face478`, `faceResult`, `opts` at module scope, rename the new ones (e.g. `faceOpts`) rather than touching existing tests:

```ts
const face478 = (x: number) => Array.from({ length: 478 }, (_, i) => ({ x, y: 0.5 + i * 1e-4, z: 0 }));
const faceResult = (x: number): RawFaceResult => ({
  faceLandmarks: [face478(x)],
  faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.4 }] }],
});
const opts = { confidence: 0.5, smoothingAlpha: 1 };

describe('buildFrame face', () => {
  it('face is null when no face result is passed', () => {
    expect(buildFrame(null, null, null, 0, opts).face).toBeNull();
  });

  it('without a filter, landmarks equal raw landmarks', () => {
    const f = buildFrame(null, null, faceResult(0.3), 0, opts);
    expect(f.face!.landmarks[0].x).toBe(0.3);
    expect(f.face!.rawLandmarks[0].x).toBe(0.3);
    expect(f.face!.blendshapes.jawOpen).toBe(0.4);
  });

  it('with a filter, landmarks are filtered and rawLandmarks stay raw', () => {
    const faceFilter = createOneEuroBank();
    const a = buildFrame(null, null, faceResult(0.3), 0, { ...opts, faceFilter });
    const b = buildFrame(a, null, faceResult(0.6), 16, { ...opts, faceFilter });
    expect(b.face!.rawLandmarks[0].x).toBe(0.6);
    expect(b.face!.landmarks[0].x).toBeGreaterThan(0.3);
    expect(b.face!.landmarks[0].x).toBeLessThan(0.6);
  });

  it('a lost face resets the filter so re-entry does not swoop', () => {
    const faceFilter = createOneEuroBank();
    const a = buildFrame(null, null, faceResult(0.3), 0, { ...opts, faceFilter });
    const lost = buildFrame(a, null, { faceLandmarks: [] }, 16, { ...opts, faceFilter });
    expect(lost.face).toBeNull();
    const back = buildFrame(lost, null, faceResult(0.8), 32, { ...opts, faceFilter });
    expect(back.face!.landmarks[0].x).toBe(0.8);
  });
});
```

Create `components/shared/facePolicy.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { updateAvgDt, nextFaceAlternating } from './facePolicy';

describe('updateAvgDt', () => {
  it('passes the first sample through, then EMA 0.9/0.1', () => {
    expect(updateAvgDt(0, 20)).toBe(20);
    expect(updateAvgDt(20, 30)).toBeCloseTo(21);
  });
});

describe('nextFaceAlternating', () => {
  it('never alternates unless both landmarkers run', () => {
    expect(nextFaceAlternating(false, 100, false)).toBe(false);
    expect(nextFaceAlternating(true, 100, false)).toBe(false);
  });
  it('turns on under 30 fps and off only above 45 fps (hysteresis)', () => {
    expect(nextFaceAlternating(false, 34, true)).toBe(true);
    expect(nextFaceAlternating(false, 30, true)).toBe(false);
    expect(nextFaceAlternating(true, 25, true)).toBe(true);
    expect(nextFaceAlternating(true, 21, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/shared/buildFrame.test.ts components/shared/facePolicy.test.ts`. Expected: FAIL (`rawLandmarks` undefined / `faceFilter` unknown / `./facePolicy` missing).

- [ ] **Step 3: Implement**

`components/shared/trackerTypes.ts`, replace the `TrackedFace` interface:

```ts
export interface TrackedFace {
  landmarks: Landmark[];                 // 478, FILTERED when useTracker passes a One Euro bank (what demos draw)
  rawLandmarks: Landmark[];              // 478, exactly as MediaPipe returned them
  blendshapes: Record<string, number>;   // ARKit-style scores by name
  transform: number[] | null;            // 16 floats, column-major, from facialTransformationMatrixes
}
```

`components/shared/buildFrame.ts`: add `import { OneEuroBank } from './oneEuro';`, extend the options, replace `buildTrackedFace`, and update its call site:

```ts
export interface BuildFrameOptions {
  confidence: number;
  smoothingAlpha: number;
  /** Stateful One Euro bank for face landmarks, owned by useTracker. Absent = raw. */
  faceFilter?: OneEuroBank;
}
```

```ts
function buildTrackedFace(faceResult: RawFaceResult, now: number, filter?: OneEuroBank): TrackedFace | null {
  if (!faceResult.faceLandmarks || faceResult.faceLandmarks.length === 0) {
    // Face lost: reset so the next appearance starts from its own position.
    filter?.reset();
    return null;
  }

  const blendshapes: Record<string, number> = {};
  for (const cat of faceResult.faceBlendshapes?.[0]?.categories ?? []) {
    blendshapes[cat.categoryName] = cat.score;
  }

  const rawMatrix = faceResult.facialTransformationMatrixes?.[0]?.data ?? null;
  const transform = rawMatrix ? Array.from(rawMatrix) : null;

  const rawLandmarks = faceResult.faceLandmarks[0];
  const landmarks = filter ? filter.filter(rawLandmarks, now) : rawLandmarks;
  return { landmarks, rawLandmarks, blendshapes, transform };
}
```

In `buildFrame`, change `const face = faceResult ? buildTrackedFace(faceResult) : null;` to:

```ts
  // faceResult === null means "face not requested or skipped this tick" and
  // must NOT reset the filter; only an empty result (face lost) does.
  const face = faceResult ? buildTrackedFace(faceResult, now, options.faceFilter) : null;
```

Create `components/shared/facePolicy.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD-001 cost policy: when hands and face landmarkers both run and the loop
 * drops under ~30 fps, run the face landmarker on alternate ticks and reuse
 * the previous face. Hysteresis (on under 30 fps, off above 45 fps) so the
 * faster alternating loop does not immediately flip the policy back.
 */
const ON_ABOVE_MS = 1000 / 30;
const OFF_BELOW_MS = 1000 / 45;

export function updateAvgDt(avgMs: number, dtMs: number): number {
  return avgMs === 0 ? dtMs : avgMs * 0.9 + dtMs * 0.1;
}

export function nextFaceAlternating(alternating: boolean, avgDtMs: number, bothEnabled: boolean): boolean {
  if (!bothEnabled) return false;
  return alternating ? avgDtMs >= OFF_BELOW_MS : avgDtMs > ON_ABOVE_MS;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run`. Expected: all tests PASS. Then `npm run typecheck`: if any other file builds a `TrackedFace` literal, add `rawLandmarks` there (none expected; `grep -rn "TrackedFace" --include=*.ts --include=*.tsx . | grep -v node_modules`).

- [ ] **Step 5: Commit**

```bash
git add components/shared/trackerTypes.ts components/shared/buildFrame.ts components/shared/buildFrame.test.ts components/shared/facePolicy.ts components/shared/facePolicy.test.ts
git commit -m "Filter face landmarks in buildFrame; add alternate-tick face policy (face puppet P1, task 3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `useTracker` face and combined paths

**Files:**
- Modify: `hooks/useTracker.ts` (full rewrite below)

**Interfaces:**
- Consumes: `buildFrame` + `BuildFrameOptions.faceFilter` (Task 3), `createOneEuroBank`, `faceSmoothingToMinCutoff` (Task 1), `updateAvgDt`, `nextFaceAlternating` (Task 3), `FACE_MODEL_PATH` (`hooks/mediapipeAssets.ts`).
- Produces: `useTracker(videoRef, { hands?, face?, smoothing?, confidence?, faceSmoothing? })` returning `{ frameRef, isReady, error, setSmoothing, setConfidence, setFaceSmoothing }`. `faceSmoothing` is the 0..1 UI amount (default 0.5). Hands-only behavior is unchanged (the `useMediaPipe` adapter keeps working with no edits).

No unit test (hook with camera + WASM; the vitest env is node). Pure logic it relies on is already tested in Tasks 1 and 3.

- [ ] **Step 1: Replace `hooks/useTracker.ts`** with:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * and face tracking (TDD-001 Phases 2-3). Face landmarks run through a One
 * Euro bank owned here; hands keep the slider-driven lerp.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH, FACE_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { createOneEuroBank, faceSmoothingToMinCutoff } from '../components/shared/oneEuro';
import { updateAvgDt, nextFaceAlternating } from '../components/shared/facePolicy';
import { TrackedFrame } from '../components/shared/trackerTypes';

export interface UseTrackerOptions {
  hands?: boolean;         // default true
  face?: boolean;          // default false
  smoothing?: number;      // 0..1 UI amount for hands, same scale as SmoothingControl
  confidence?: number;     // handedness gate, default 0.5
  faceSmoothing?: number;  // 0..1 UI amount for the face One Euro filter, default 0.5
}

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true, face = false } = options;
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });
  const faceFilterRef = useRef(createOneEuroBank());

  useEffect(() => {
    if (options.smoothing !== undefined) {
      settingsRef.current.smoothingAlpha = smoothingToLerp(options.smoothing);
    }
  }, [options.smoothing]);

  useEffect(() => {
    if (options.confidence !== undefined) {
      settingsRef.current.confidence = options.confidence;
    }
  }, [options.confidence]);

  useEffect(() => {
    faceFilterRef.current.params.minCutoff = faceSmoothingToMinCutoff(options.faceSmoothing ?? 0.5);
  }, [options.faceSmoothing]);

  const setSmoothing = useCallback((amount01: number) => {
    settingsRef.current.smoothingAlpha = smoothingToLerp(Math.max(0, Math.min(1, amount01)));
  }, []);

  const setConfidence = useCallback((threshold: number) => {
    settingsRef.current.confidence = threshold;
  }, []);

  const setFaceSmoothing = useCallback((amount01: number) => {
    faceFilterRef.current.params.minCutoff = faceSmoothingToMinCutoff(amount01);
  }, []);

  const frameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!hands && !face) return;
    let isActive = true;

    const closeAll = () => {
      handLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      faceLandmarkerRef.current = null;
    };

    const setup = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
        if (!isActive) return;

        if (hands) {
          handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }
        if (face && isActive) {
          faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: 'GPU' },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }

        if (!isActive) {
          closeAll();
          return;
        }
        startCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        setError(`Failed to load ${face && !hands ? 'face' : 'hand'} tracking: ${err.message}`);
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            if (isActive) {
              setIsReady(true);
              tick();
            }
          };
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        console.error('Camera Error:', err);
        setError('Could not access camera.');
      }
    };

    let tickIndex = 0;
    let lastNow = 0;
    let avgDt = 0;
    let alternating = false;

    const tick = () => {
      if (!videoRef.current || !isActive) return;
      const handLm = handLandmarkerRef.current;
      const faceLm = faceLandmarkerRef.current;

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const now = performance.now();
        if (lastNow) avgDt = updateAvgDt(avgDt, now - lastNow);
        lastNow = now;
        alternating = nextFaceAlternating(alternating, avgDt, !!handLm && !!faceLm);
        const runFace = !!faceLm && (!alternating || tickIndex % 2 === 0);
        tickIndex++;

        try {
          const handResult = handLm ? handLm.detectForVideo(video, now) : null;
          const faceResult = runFace ? faceLm!.detectForVideo(video, now) : null;
          const prev = frameRef.current;
          const next = buildFrame(prev, handResult, faceResult, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
            faceFilter: faceFilterRef.current,
          });
          if (faceLm && !runFace && prev) next.face = prev.face; // alternate tick: reuse
          frameRef.current = next;
        } catch (e) {
          console.warn('Detection failed this frame', e);
        }
      }

      requestRef.current = requestAnimationFrame(tick);
    };

    setup();

    return () => {
      isActive = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      closeAll();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoRef, hands, face]);

  return { frameRef, isReady, error, setSmoothing, setConfidence, setFaceSmoothing };
}
```

Note on the types: `detectForVideo` results are MediaPipe's `HandLandmarkerResult` / `FaceLandmarkerResult`; the existing code already passes the hand result straight into `buildFrame`. If TypeScript rejects the face result against `RawFaceResult` (e.g. `Classifications` vs the inline category shape), fix it with a narrow cast at the call (`faceResult as unknown as RawFaceResult`) and a comment, not by loosening `RawFaceResult`.

- [ ] **Step 2: Gate** — `npm run typecheck; npm test; npm run smoke`. Expected: all green. Grep that the hands-only adapter still compiles unchanged: `git diff --stat hooks/useMediaPipe.ts` shows nothing.

- [ ] **Step 3: Commit**

```bash
git add hooks/useTracker.ts
git commit -m "useTracker: face and combined face+hands paths with One Euro + alternate-tick policy (TDD-001 P3; face puppet P1, task 4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: FaceDemo onto `useTracker`, Face Smoothing slider, ratio mouth

**Files:**
- Modify: `components/FaceDemo.tsx`
- Modify: `components/face/FaceMeshRenderer.ts` (one option, one line)
- Delete: `hooks/useFaceTracker.ts` (`git rm`)

**Interfaces:**
- Consumes: `useTracker(..., { hands: false, face: true, faceSmoothing })` (Task 4), `mouthOpenRatio`, `nextMouthOpen` (Task 2).
- Produces: `FacePuppetOptions.mouthOpen?: boolean` in `FaceMeshRenderer.ts` (temporary; Task 8 replaces the renderer). FaceDemo keeps `videoAspectRef` (live `videoWidth / videoHeight`, default `4 / 3`) and `mouthOpenRef`, which Tasks 8, 12, 15 reuse.

- [ ] **Step 1: Renderer, accept the mouth state.** In `components/face/FaceMeshRenderer.ts` add `mouthOpen?: boolean;` to `FacePuppetOptions`, and replace `if (mouthOpenDist > 4) {` with:

```ts
  if (options.mouthOpen ?? mouthOpenDist > 4) {
```

- [ ] **Step 2: FaceDemo, swap the tracker.** In `components/FaceDemo.tsx`:

Replace the import `import { useFaceTracker } from '../hooks/useFaceTracker';` with:

```ts
import { useTracker } from '../hooks/useTracker';
import { mouthOpenRatio, nextMouthOpen } from './face/mouthState';
```

Replace `const { isCameraReady, faceResultRef, error } = useFaceTracker(videoRef);` with:

```ts
  const [faceSmoothing, setFaceSmoothing] = useState(0.5);
  const { frameRef, isReady: isCameraReady, error } = useTracker(videoRef, { hands: false, face: true, faceSmoothing });
  const mouthOpenRef = useRef(false);
  const videoAspectRef = useRef(4 / 3);
```

Replace the whole live branch (`else if (isCameraReady && video && video.readyState >= 2) { ... }` up to, not including, the PiP block) data read with:

```ts
              else if (isCameraReady && video && video.readyState >= 2) {
                  if (video.videoWidth > 0) videoAspectRef.current = video.videoWidth / video.videoHeight;
                  const face = frameRef.current?.face;
                  if (face) {
                      currentLandmarks = face.landmarks;
                      currentBlendshapesRecord = face.blendshapes;

                      // RECORDING LOGIC (filtered landmarks, see recordingSchema capture notes)
                      if (recorder.isRecording) {
                          recorder.captureFrame({
                              faceLandmarks: currentLandmarks,
                              blendshapes: currentBlendshapesRecord
                          });
                      }
                  }
```

(keep the existing PiP block and closing brace after it unchanged).

Before `// Render Stylized Puppet Character`, add:

```ts
              if (currentLandmarks) {
                  mouthOpenRef.current = nextMouthOpen(
                      mouthOpenRef.current,
                      mouthOpenRatio(currentLandmarks, videoAspectRef.current)
                  );
              }
```

and pass `mouthOpen: mouthOpenRef.current` into the `drawFacePuppet` options object.

- [ ] **Step 3: Face Smoothing slider.** In the sidebar, directly after the description box (`Real-time facial blendshapes driving...` div), insert:

```tsx
             {/* Face Smoothing (One Euro minCutoff) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between text-[11px] text-gray-300 mb-1.5">
                     <span className="text-gray-400">Face Smoothing</span>
                     <span className="text-white font-bold tabular-nums">{Math.round(faceSmoothing * 100)}%</span>
                 </div>
                 <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.05}
                     value={faceSmoothing}
                     onChange={(e) => setFaceSmoothing(parseFloat(e.target.value))}
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]"
                     title="Left: responsive, a little jitter. Right: calm, a little lag."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>LIGHT</span><span>HEAVY</span>
                 </div>
             </div>
```

- [ ] **Step 4: Delete the old hook.** `git rm hooks/useFaceTracker.ts`, then `grep -rn "useFaceTracker\|faceResultRef" --include=*.ts --include=*.tsx . | grep -v node_modules` must print nothing.

- [ ] **Step 5: Gate** — `npm run typecheck; npm test; npm run smoke`. All green.

- [ ] **Step 6: Commit**

```bash
git add components/FaceDemo.tsx components/face/FaceMeshRenderer.ts
git commit -m "Face Puppet on useTracker: One Euro face smoothing slider, ratio+hysteresis mouth, drop useFaceTracker (face puppet P1, task 5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Controller verification after Task 5 (not a subagent step): open the preview, open Face Puppet, confirm it mounts and the Face Smoothing slider renders (camera will not init in the preview; that is expected).

---

# Phase 2: Low-poly restyle

### Task 6: Face topology generator + generated table

**Files:**
- Create: `tools/data/canonical_face_model.obj` (download), `tools/data/README.md`
- Create: `tools/gen-face-topology.mjs`
- Generate: `components/face/faceTopology.ts`
- Test: `components/face/faceTopology.test.ts`
- Modify: `package.json` / `package-lock.json` (`delaunator` dev dependency)

**Interfaces:**
- Produces (all `readonly number[]` of MediaPipe landmark indices unless noted), exported from `components/face/faceTopology.ts`:
  - `FACE_OVAL` (closed loop, first index repeated at end), `LIPS_OUTER` (closed), `LIPS_INNER` (closed, `[78, ...LIPS_INNER_UPPER, 308, ...LIPS_INNER_LOWER reversed, 78]`), `LIPS_INNER_UPPER` (`[191,80,81,82,13,312,311,310,415]`), `LIPS_INNER_LOWER` (`[95,88,178,87,14,317,402,318,324]`, paired index-for-index with UPPER), `LEFT_EYE_CONTOUR` (`[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33]`), `RIGHT_EYE_CONTOUR` (`[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466,263]`), `LEFT_EYEBROW`, `RIGHT_EYEBROW`, `MOCAP_POINTS`
  - `FACE_TRIS`: flat triangle list, 3 indices per triangle
  - `FACE_TRI_IS_LIP`: `readonly (0 | 1)[]`, one per triangle (1 when all three vertices are lip-ring vertices)

- [ ] **Step 1: Fetch the reference model and add the dev dep**

```bash
mkdir -p tools/data
curl -sL -o tools/data/canonical_face_model.obj https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
grep -c "^v " tools/data/canonical_face_model.obj   # expect 468
npm i -D delaunator@5
```

Create `tools/data/README.md`:

```markdown
# tools/data

- `canonical_face_model.obj`: MediaPipe's canonical face model (468 vertices, vertex order = face landmark index), from `google-ai-edge/mediapipe` `mediapipe/modules/face_geometry/data/`, Apache-2.0. Input to `tools/gen-face-topology.mjs`. Not shipped in the app bundle.
```

- [ ] **Step 2: Write the generator** `tools/gen-face-topology.mjs`

```js
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-shot generator for components/face/faceTopology.ts: picks a ~210-point
 * subset of the 468 face landmarks, Delaunay-triangulates it on the
 * canonical face (frontal, neutral), and cuts holes for the eyes and the
 * mouth. The output is a FIXED table: never triangulate at runtime (the
 * topology would pop between frames).
 *
 * Run: node tools/gen-face-topology.mjs [path/to/reference.obj]
 */
import fs from 'node:fs';
import path from 'node:path';
import Delaunator from 'delaunator';

const objPath = process.argv[2] ?? 'tools/data/canonical_face_model.obj';
const V = fs.readFileSync(objPath, 'utf8').split('\n')
  .filter((l) => l.startsWith('v '))
  .map((l) => l.trim().split(/\s+/).slice(1, 4).map(Number));
if (V.length !== 468) throw new Error(`expected 468 vertices, got ${V.length}`);

// Canonical is y-up; flip to image-like y-down for the 2D triangulation.
const P = (i) => [V[i][0], -V[i][1]];

const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LIPS_OUTER = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const LIPS_INNER_UPPER = [191,80,81,82,13,312,311,310,415];
const LIPS_INNER_LOWER = [95,88,178,87,14,317,402,318,324];
const LIPS_INNER = [78, ...LIPS_INNER_UPPER, 308, ...[...LIPS_INNER_LOWER].reverse()];
const L_EYE_LOWER = [7,163,144,145,153,154,155], L_EYE_UPPER = [173,157,158,159,160,161,246];
const R_EYE_LOWER = [249,390,373,374,380,381,382], R_EYE_UPPER = [398,384,385,386,387,388,466];
const LEFT_EYE = [33, ...L_EYE_LOWER, 133, ...L_EYE_UPPER];
const RIGHT_EYE = [263, ...R_EYE_LOWER, 362, ...R_EYE_UPPER];
const LEFT_EYEBROW = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_EYEBROW = [300,293,334,296,336,285,295,282,283,276];
const NOSE = [168,6,197,195,5,4,1,19,94,2,98,327,129,358,64,294,48,278,115,344,220,440];
const FILL = [117,123,147,213,187,50,205,36,142,126,111,118,101,346,352,376,433,411,280,425,266,371,355,340,347,330,
  9,151,108,337,69,299,104,333,71,301,139,368,175,199,200,18,32,262,208,428,135,364,169,394,57,287,43,273,214,434,192,416,210,430];
const MOCAP_POINTS = [117,123,147,213,187,120,346,352,376,433,411,349,9,151,10,108,337,152,175,199,200];

const SUBSET = [...new Set([...FACE_OVAL, ...LIPS_OUTER, ...LIPS_INNER, ...LEFT_EYE, ...RIGHT_EYE,
  ...LEFT_EYEBROW, ...RIGHT_EYEBROW, ...NOSE, ...FILL])];

const inPoly = ([px, py], poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = P(poly[i]);
    const [bx, by] = P(poly[j]);
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) c = !c;
  }
  return c;
};
// A triangle "spans" a hole when it touches both lids / both lips.
const spans = (t, a, b) => t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));

const d = new Delaunator(SUBSET.flatMap(P));
const tris = [];
const removed = { outside: 0, mouth: 0, eyes: 0 };
for (let k = 0; k < d.triangles.length; k += 3) {
  const t = [0, 1, 2].map((j) => SUBSET[d.triangles[k + j]]);
  const c = [0, 1].map((a) => t.reduce((s, i) => s + P(i)[a], 0) / 3);
  if (!inPoly(c, FACE_OVAL)) { removed.outside++; continue; }
  if (spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER) || inPoly(c, LIPS_INNER)) { removed.mouth++; continue; }
  if (spans(t, L_EYE_UPPER, L_EYE_LOWER) || spans(t, R_EYE_UPPER, R_EYE_LOWER) || inPoly(c, LEFT_EYE) || inPoly(c, RIGHT_EYE)) { removed.eyes++; continue; }
  tris.push(t);
}

const LIP_SET = new Set([...LIPS_OUTER, ...LIPS_INNER]);
const isLip = tris.map((t) => (t.every((i) => LIP_SET.has(i)) ? 1 : 0));

const arr = (a) => `[${a.join(', ')}]`;
const out = `/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED by tools/gen-face-topology.mjs from ${path.basename(objPath)}. Do not edit by hand;
 * edit the generator and re-run it. ${SUBSET.length} vertices, ${tris.length} triangles
 * (removed: ${removed.outside} outside the oval, ${removed.mouth} mouth hole, ${removed.eyes} eye holes).
 */

export const FACE_OVAL: readonly number[] = ${arr([...FACE_OVAL, FACE_OVAL[0]])};
export const LIPS_OUTER: readonly number[] = ${arr([...LIPS_OUTER, LIPS_OUTER[0]])};
export const LIPS_INNER_UPPER: readonly number[] = ${arr(LIPS_INNER_UPPER)};
export const LIPS_INNER_LOWER: readonly number[] = ${arr(LIPS_INNER_LOWER)};
export const LIPS_INNER: readonly number[] = ${arr([...LIPS_INNER, LIPS_INNER[0]])};
export const LEFT_EYE_CONTOUR: readonly number[] = ${arr([...LEFT_EYE, LEFT_EYE[0]])};
export const RIGHT_EYE_CONTOUR: readonly number[] = ${arr([...RIGHT_EYE, RIGHT_EYE[0]])};
export const LEFT_EYEBROW: readonly number[] = ${arr(LEFT_EYEBROW)};
export const RIGHT_EYEBROW: readonly number[] = ${arr(RIGHT_EYEBROW)};
export const MOCAP_POINTS: readonly number[] = ${arr(MOCAP_POINTS)};

/** Flat triangle list: landmark indices, 3 per triangle. */
export const FACE_TRIS: readonly number[] = ${arr(tris.flat())};

/** 1 when all three vertices sit on a lip ring (drawn one ramp step darker). */
export const FACE_TRI_IS_LIP: readonly (0 | 1)[] = ${arr(isLip)};
`;
fs.writeFileSync('components/face/faceTopology.ts', out);
console.log(`faceTopology.ts: ${SUBSET.length} verts, ${tris.length} tris`, removed);
```

- [ ] **Step 3: Generate** — `node tools/gen-face-topology.mjs`. Expected output close to `210 verts, 336 tris { outside: 0, mouth: 18, eyes: 28 }` (the planning prototype produced exactly this on the canonical model).

- [ ] **Step 4: Write the test** `components/face/faceTopology.test.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  FACE_TRIS, FACE_TRI_IS_LIP, LIPS_INNER_UPPER, LIPS_INNER_LOWER,
  LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LIPS_INNER,
} from './faceTopology';

const tris: number[][] = [];
for (let i = 0; i < FACE_TRIS.length; i += 3) tris.push([FACE_TRIS[i], FACE_TRIS[i + 1], FACE_TRIS[i + 2]]);
const spans = (t: number[], a: readonly number[], b: readonly number[]) =>
  t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));

describe('faceTopology', () => {
  it('is a whole number of triangles with one lip flag each', () => {
    expect(FACE_TRIS.length % 3).toBe(0);
    expect(FACE_TRI_IS_LIP.length).toBe(tris.length);
  });

  it('is low-poly: between 250 and 450 triangles', () => {
    expect(tris.length).toBeGreaterThan(250);
    expect(tris.length).toBeLessThan(450);
  });

  it('only uses face-mesh landmark indices (0..467)', () => {
    expect(FACE_TRIS.every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
  });

  it('never bridges the mouth hole', () => {
    expect(tris.some((t) => spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER))).toBe(false);
  });

  it('never bridges an eye hole', () => {
    const lidsL = [LEFT_EYE_CONTOUR.slice(1, 8), LEFT_EYE_CONTOUR.slice(9, 16)];
    const lidsR = [RIGHT_EYE_CONTOUR.slice(1, 8), RIGHT_EYE_CONTOUR.slice(9, 16)];
    expect(tris.some((t) => spans(t, lidsL[0], lidsL[1]) || spans(t, lidsR[0], lidsR[1]))).toBe(false);
  });

  it('has lip triangles, and the inner-lip ring is closed', () => {
    expect(FACE_TRI_IS_LIP.filter((f) => f === 1).length).toBeGreaterThan(10);
    expect(LIPS_INNER[0]).toBe(LIPS_INNER[LIPS_INNER.length - 1]);
    expect(LIPS_INNER_UPPER.length).toBe(LIPS_INNER_LOWER.length);
  });
});
```

- [ ] **Step 5: Run** — `npx vitest run components/face/faceTopology.test.ts`, Expected PASS (6 tests). Then the full gate `npm run typecheck; npm test; npm run smoke`.

- [ ] **Step 6: Commit**

```bash
git add tools/data tools/gen-face-topology.mjs components/face/faceTopology.ts components/face/faceTopology.test.ts package.json package-lock.json
git commit -m "Generate fixed low-poly face topology from MediaPipe canonical face (face puppet P2, task 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `lowPoly.ts` (projection, shading, face triangles)

**Files:**
- Create: `components/face/lowPoly.ts`
- Test: `components/face/lowPoly.test.ts`

**Interfaces:**
- Consumes: `FACE_TRIS`, `FACE_TRI_IS_LIP` (Task 6), `Landmark`.
- Produces:
  - `interface Projection { x(lm: Landmark): number; y(lm: Landmark): number; z(lm: Landmark): number; drawW: number; drawH: number; offsetX: number; offsetY: number }`
  - `function fitProjection(w: number, h: number, videoAspect: number): Projection` (contain-fit, centered, mirrored X; `z = lm.z * drawW`)
  - `const LIGHT_DIR: readonly [number, number, number]`
  - `function lambert(nx: number, ny: number, nz: number): number` (two-sided; returns `0.2 + 0.8 * max(0, n . LIGHT_DIR)` after flipping n toward the viewer; 0.2 for a zero normal)
  - `function shadeColor(t: number): string` (`rgb(r, g, b)` on the gray ramp, t clamped to 0..1)
  - `const LIP_DARKEN = 0.15`
  - `interface ShadedTri { ax: number; ay: number; bx: number; by: number; cx: number; cy: number; depth: number; color: string }`
  - `function triIntensity(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number`
  - `function buildFaceTriangles(lm: Landmark[], proj: Projection): ShadedTri[]` (sorted back to front: larger depth first)

- [ ] **Step 1: Write the failing test** `components/face/lowPoly.test.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { fitProjection, lambert, shadeColor, buildFaceTriangles, triIntensity } from './lowPoly';
import { FACE_TRIS } from './faceTopology';

describe('fitProjection', () => {
  it('contain-fits a 4:3 camera into a wide stage, centered and mirrored', () => {
    const p = fitProjection(800, 400, 4 / 3);
    expect(p.drawH).toBe(400);
    expect(p.drawW).toBeCloseTo(533.333, 2);
    expect(p.offsetX).toBeCloseTo(133.333, 2);
    expect(p.x({ x: 0, y: 0, z: 0 })).toBeCloseTo(133.333 + 533.333, 2); // x=0 lands on the right (mirror)
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
    expect(fitProjection(800, 600, 4 / 3).z({ x: 0, y: 0, z: 0.1 })).toBeCloseTo(80);
  });
});

describe('lambert', () => {
  it('is two-sided and stays in 0.2..1', () => {
    expect(lambert(0, 0, -1)).toBeCloseTo(lambert(0, 0, 1));
    for (const n of [[0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0]]) {
      const v = lambert(n[0], n[1], n[2]);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is brighter facing the (upper-left) light than facing away from it', () => {
    const towardLight = lambert(-0.5, -0.5, -0.7);
    const facingCamera = lambert(0, 0, -1);
    const awayFromLight = lambert(0.7, 0.3, -0.6);
    expect(towardLight).toBeGreaterThan(facingCamera);
    expect(facingCamera).toBeGreaterThan(awayFromLight);
  });

  it('returns the ambient floor for a zero normal', () => {
    expect(triIntensity([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBe(0.2);
  });
});

describe('shadeColor', () => {
  it('maps the ramp ends and clamps', () => {
    expect(shadeColor(0)).toBe('rgb(42, 45, 51)');
    expect(shadeColor(1)).toBe('rgb(217, 220, 225)');
    expect(shadeColor(-5)).toBe(shadeColor(0));
    expect(shadeColor(5)).toBe(shadeColor(1));
  });
});

describe('buildFaceTriangles', () => {
  // Deterministic scatter so no triangle is degenerate.
  const flat = Array.from({ length: 478 }, (_, i) => ({
    x: 0.3 + ((i * 7919) % 400) / 1000,
    y: 0.2 + ((i * 104729) % 500) / 1000,
    z: 0,
  }));

  it('emits one triangle per topology triangle', () => {
    expect(buildFaceTriangles(flat, fitProjection(640, 480, 4 / 3)).length).toBe(FACE_TRIS.length / 3);
  });

  it('on a flat face, shades skin one tone and lips one darker tone', () => {
    const colors = new Set(buildFaceTriangles(flat, fitProjection(640, 480, 4 / 3)).map((t) => t.color));
    expect(colors.size).toBe(2);
  });

  it('sorts back to front (depth non-increasing)', () => {
    const tilted = flat.map((p) => ({ ...p, z: p.x - 0.5 }));
    const tris = buildFaceTriangles(tilted, fitProjection(640, 480, 4 / 3));
    for (let i = 1; i < tris.length; i++) expect(tris[i].depth).toBeLessThanOrEqual(tris[i - 1].depth);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/face/lowPoly.test.ts`, Expected FAIL (module missing).

- [ ] **Step 3: Implement** `components/face/lowPoly.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure low-poly maths for the Face Puppet: camera-to-stage projection
 * (contain-fit, mirrored), flat Lambert shading on one gray ramp, and the
 * sorted, shaded face triangle list. No canvas calls; FaceMeshRenderer draws
 * what this returns.
 */
import { Landmark } from '../shared/trackerTypes';
import { FACE_TRIS, FACE_TRI_IS_LIP } from './faceTopology';

export interface Projection {
  x(lm: Landmark): number;
  y(lm: Landmark): number;
  z(lm: Landmark): number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
}

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

const norm = (x: number, y: number, z: number): [number, number, number] => {
  const m = Math.hypot(x, y, z);
  return [x / m, y / m, z / m];
};

/** Toward the light, in stage space: left, up, toward the camera (-z). */
export const LIGHT_DIR: readonly [number, number, number] = norm(-0.45, -0.55, -0.7);
const AMBIENT = 0.2;

/** Two-sided Lambert: the normal is flipped to face the camera (-z) first, so
 * triangle winding (which the X mirror flips) never matters. */
export function lambert(nx: number, ny: number, nz: number): number {
  const m = Math.hypot(nx, ny, nz);
  if (m < 1e-9) return AMBIENT;
  let [x, y, z] = [nx / m, ny / m, nz / m];
  if (z > 0) [x, y, z] = [-x, -y, -z];
  const d = x * LIGHT_DIR[0] + y * LIGHT_DIR[1] + z * LIGHT_DIR[2];
  return AMBIENT + (1 - AMBIENT) * Math.max(0, d);
}

const RAMP_DARK = [0x2a, 0x2d, 0x33];
const RAMP_LIGHT = [0xd9, 0xdc, 0xe1];

export function shadeColor(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const c = RAMP_DARK.map((d, i) => Math.round(d + (RAMP_LIGHT[i] - d) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export const LIP_DARKEN = 0.15;

export interface ShadedTri {
  ax: number; ay: number;
  bx: number; by: number;
  cx: number; cy: number;
  depth: number;  // average z in stage units; larger = farther
  color: string;
}

type P3 = [number, number, number];

export function triIntensity(a: P3, b: P3, c: P3): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return lambert(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
}

export function buildFaceTriangles(lm: Landmark[], proj: Projection): ShadedTri[] {
  const pt = (i: number): P3 => [proj.x(lm[i]), proj.y(lm[i]), proj.z(lm[i])];
  const out: ShadedTri[] = [];
  for (let k = 0, t = 0; k < FACE_TRIS.length; k += 3, t++) {
    const a = pt(FACE_TRIS[k]);
    const b = pt(FACE_TRIS[k + 1]);
    const c = pt(FACE_TRIS[k + 2]);
    const intensity = triIntensity(a, b, c) - (FACE_TRI_IS_LIP[t] ? LIP_DARKEN : 0);
    out.push({
      ax: a[0], ay: a[1], bx: b[0], by: b[1], cx: c[0], cy: c[1],
      depth: (a[2] + b[2] + c[2]) / 3,
      color: shadeColor(intensity),
    });
  }
  return out.sort((p, q) => q.depth - p.depth);
}
```

- [ ] **Step 4: Run** — `npx vitest run components/face/lowPoly.test.ts`, Expected PASS (10 tests). If "lips one darker tone" gives 3 colors, a lip triangle's intensity clamped differently; check `LIP_DARKEN` is subtracted before `shadeColor`, not after rounding.

- [ ] **Step 5: Commit**

```bash
git add components/face/lowPoly.ts components/face/lowPoly.test.ts
git commit -m "Add low-poly projection, Lambert ramp shading, sorted face triangles (face puppet P2, task 7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Renderer rewrite (`drawPuppet`) + FaceDemo restyle

**Files:**
- Rewrite: `components/face/FaceMeshRenderer.ts`
- Modify: `components/FaceDemo.tsx`

**Interfaces:**
- Consumes: `fitProjection`, `buildFaceTriangles`, `Projection` (Task 7); contours from `faceTopology.ts` (Task 6).
- Produces:
  - `interface PuppetFrame { face: Landmark[] | null; mouthOpen: boolean }` (Task 15 adds `hands`)
  - `interface PuppetOptions { showGazeRays: boolean; showMocapDots: boolean; videoAspect: number }`
  - `const STAGE_BG = '#090A0C'`
  - `function drawPuppet(ctx: CanvasRenderingContext2D, frame: PuppetFrame, w: number, h: number, opts: PuppetOptions): void`
  - `drawFacePuppet` and `FacePuppetOptions` are removed.

- [ ] **Step 1: Replace `components/face/FaceMeshRenderer.ts`** with:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet drawing layer: background, faceted low-poly head, stylized
 * eyes (behavior unchanged from the original renderer), mouth, overlays.
 * Pure geometry lives in lowPoly.ts / handMesh.ts; this file only draws, so
 * the same call renders the stage and the offscreen video-export canvas.
 */
import { Landmark } from '../shared/trackerTypes';
import { fitProjection, buildFaceTriangles, Projection, ShadedTri } from './lowPoly';
import {
  LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LIPS_INNER, LIPS_INNER_UPPER, LIPS_INNER_LOWER,
  LEFT_EYEBROW, RIGHT_EYEBROW, MOCAP_POINTS,
} from './faceTopology';

export const STAGE_BG = '#090A0C';
const ACCENT = '#EE3B2B';
const CAVITY = '#0B0C0E';
const LIP_CLOSED_FILL = '#3A3D44';
const LIP_SEAM = '#15171B';

export interface PuppetFrame {
  face: Landmark[] | null;
  mouthOpen: boolean;
}

export interface PuppetOptions {
  showGazeRays: boolean;
  showMocapDots: boolean;
  videoAspect: number;
}

export function fillTriangles(ctx: CanvasRenderingContext2D, tris: ShadedTri[]) {
  ctx.lineWidth = 0.75;
  ctx.lineJoin = 'round';
  for (const t of tris) {
    ctx.beginPath();
    ctx.moveTo(t.ax, t.ay);
    ctx.lineTo(t.bx, t.by);
    ctx.lineTo(t.cx, t.cy);
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color; // same-color stroke hides anti-alias seams
    ctx.fill();
    ctx.stroke();
  }
}

const tracePath = (ctx: CanvasRenderingContext2D, lm: Landmark[], idx: readonly number[], p: Projection) => {
  ctx.beginPath();
  ctx.moveTo(p.x(lm[idx[0]]), p.y(lm[idx[0]]));
  for (let i = 1; i < idx.length; i++) ctx.lineTo(p.x(lm[idx[i]]), p.y(lm[idx[i]]));
};

const drawMouth = (ctx: CanvasRenderingContext2D, lm: Landmark[], p: Projection, open: boolean) => {
  tracePath(ctx, lm, LIPS_INNER, p);
  ctx.closePath();
  ctx.fillStyle = open ? CAVITY : LIP_CLOSED_FILL;
  ctx.fill();
  if (open) return;

  // Closed: one seam through the midpoints of paired upper/lower inner-lip points.
  const mid = (i: number) => ({
    x: (p.x(lm[LIPS_INNER_UPPER[i]]) + p.x(lm[LIPS_INNER_LOWER[i]])) / 2,
    y: (p.y(lm[LIPS_INNER_UPPER[i]]) + p.y(lm[LIPS_INNER_LOWER[i]])) / 2,
  });
  ctx.beginPath();
  ctx.moveTo(p.x(lm[78]), p.y(lm[78]));
  for (let i = 0; i < LIPS_INNER_UPPER.length; i++) {
    const m = mid(i);
    ctx.lineTo(m.x, m.y);
  }
  ctx.lineTo(p.x(lm[308]), p.y(lm[308]));
  ctx.strokeStyle = LIP_SEAM;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
};

/** The original stylized eye, unchanged apart from taking the projection. */
const renderStylizedEye = (
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  contourIndices: readonly number[],
  irisIndex: number,
  p: Projection,
  showGazeRays: boolean
) => {
  const getX = p.x;
  const getY = p.y;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let avgX = 0, avgY = 0;
  for (const idx of contourIndices) {
    const px = getX(landmarks[idx]);
    const py = getY(landmarks[idx]);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    avgX += px;
    avgY += py;
  }
  avgX /= contourIndices.length;
  avgY /= contourIndices.length;

  const eyeWidth = maxX - minX;
  const eyeHeight = maxY - minY;
  const blinkRatio = eyeHeight / Math.max(eyeWidth, 1);

  tracePath(ctx, landmarks, contourIndices, p);
  ctx.closePath();

  if (blinkRatio < 0.15) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    return;
  }

  ctx.fillStyle = '#F3F4F6';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#4B5563';
  ctx.stroke();

  let pupilX = avgX;
  let pupilY = avgY;
  if (landmarks[irisIndex]) {
    pupilX = getX(landmarks[irisIndex]);
    pupilY = getY(landmarks[irisIndex]);
  }
  pupilX = Math.max(minX + eyeWidth * 0.2, Math.min(maxX - eyeWidth * 0.2, pupilX));
  pupilY = Math.max(minY + eyeHeight * 0.2, Math.min(maxY - eyeHeight * 0.2, pupilY));

  const irisRadius = Math.min(eyeHeight * 0.45, eyeWidth * 0.26);

  ctx.beginPath();
  ctx.arc(pupilX, pupilY, Math.max(4, irisRadius), 0, Math.PI * 2);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#60A5FA';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pupilX, pupilY, Math.max(2, irisRadius * 0.5), 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pupilX - irisRadius * 0.35, pupilY - irisRadius * 0.35, Math.max(1.5, irisRadius * 0.25), 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  if (showGazeRays) {
    const gazeDx = pupilX - avgX;
    const gazeDy = pupilY - avgY;
    const rayLen = 45;
    const gazeMagnitude = Math.hypot(gazeDx, gazeDy);
    const nx = gazeMagnitude > 0.5 ? gazeDx / gazeMagnitude : 0;
    const ny = gazeMagnitude > 0.5 ? gazeDy / gazeMagnitude : 0;

    ctx.beginPath();
    ctx.moveTo(pupilX, pupilY);
    ctx.lineTo(pupilX + nx * rayLen, pupilY + ny * rayLen);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(pupilX + nx * rayLen, pupilY + ny * rayLen, 2, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }
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

export function drawPuppet(
  ctx: CanvasRenderingContext2D,
  frame: PuppetFrame,
  w: number,
  h: number,
  opts: PuppetOptions
) {
  ctx.save();
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, w, h);

  const p = fitProjection(w, h, opts.videoAspect);
  const face = frame.face;
  if (face && face.length >= 468) {
    fillTriangles(ctx, buildFaceTriangles(face, p));
    drawMouth(ctx, face, p, frame.mouthOpen);
    // MediaPipe iris centers: 468 sits in the 33..133 eye, 473 in the 263..362 eye.
    renderStylizedEye(ctx, face, LEFT_EYE_CONTOUR, 468, p, opts.showGazeRays);
    renderStylizedEye(ctx, face, RIGHT_EYE_CONTOUR, 473, p, opts.showGazeRays);
    if (opts.showMocapDots) drawMocapDots(ctx, face, p);
  }

  ctx.restore();
}
```

- [ ] **Step 2: FaceDemo wiring.** In `components/FaceDemo.tsx`:
  - Import: replace `import { drawFacePuppet } from './face/FaceMeshRenderer';` with `import { drawPuppet } from './face/FaceMeshRenderer';`.
  - Defaults: `useState<boolean>(true)` becomes `useState<boolean>(false)` for both `showGazeRays` and `showMocapDots` (PiP stays `true`).
  - Delete the `// Clear to technical dark carbon` fill (two lines); `drawPuppet` fills the background.
  - Replace the whole `if (currentLandmarks) { drawFacePuppet(...) } else { ...placeholder... }` block with:

```tsx
              drawPuppet(ctx, { face: currentLandmarks ?? null, mouthOpen: mouthOpenRef.current }, w, h, {
                  showGazeRays,
                  showMocapDots,
                  videoAspect: videoAspectRef.current,
              });
              if (!currentLandmarks) {
                  ctx.fillStyle = '#4B5563';
                  ctx.font = '12px monospace';
                  ctx.textAlign = 'center';
                  ctx.fillText('WAITING FOR A FACE...', w / 2, h / 2);
              }
```

  - `currentLandmarks` is typed `any[] | undefined` today; change its declaration to `let currentLandmarks: Landmark[] | undefined;` and add `import { Landmark } from './shared/trackerTypes';`.

- [ ] **Step 3: Gate** — `npm run typecheck; npm test; npm run smoke`. Green. `grep -rn "drawFacePuppet" --include=*.ts --include=*.tsx . | grep -v node_modules` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add components/face/FaceMeshRenderer.ts components/FaceDemo.tsx
git commit -m "Face Puppet renders a faceted low-poly head: contain-fit framing, closed-mouth seam, overlays off by default, grid/HUD removed (face puppet P2, task 8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Synthetic take generator (camera-less screenshot fixture)

**Files:**
- Create: `tools/make-synthetic-take.mjs`
- Modify: `.gitignore` (ignore `tools/fixtures/`)

**Interfaces:**
- Consumes: `tools/data/canonical_face_model.obj` (Task 6).
- Produces: `node tools/make-synthetic-take.mjs [--hands]` writes `tools/fixtures/synthetic-face-take.json` (or `synthetic-face-hands-take.json` with `--hands`), a v2 `"2.0"` FACE file (`{ version: '2.0', type: 'FACE', duration, frames: [{ timestamp, faceLandmarks, blendshapes, landmarks? }] }`) that `useRecorder.loadData` accepts through `migrateV2Full`. 3 s at 20 fps: jaw opens and closes, head yaws +/-12 degrees. With `--hands`: two open hands wave beside the face.

- [ ] **Step 1: Write `tools/make-synthetic-take.mjs`**

```js
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Builds a synthetic Face Puppet take from MediaPipe's canonical face so the
 * renderer can be screenshot-verified in a browser with no camera (Import ->
 * Play). Output is a v2 "2.0" FACE file (FrameData verbatim), which
 * useRecorder.loadData migrates. Not a substitute for a real take.
 *
 * Run: node tools/make-synthetic-take.mjs [--hands]
 */
import fs from 'node:fs';

const withHands = process.argv.includes('--hands');
const V = fs.readFileSync('tools/data/canonical_face_model.obj', 'utf8').split('\n')
  .filter((l) => l.startsWith('v '))
  .map((l) => l.trim().split(/\s+/).slice(1, 4).map(Number));

const FPS = 20, SECONDS = 3, KX = 0.022, KY = KX * (4 / 3);
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// Open hand in hand units (wrist at origin, y up), 21 MediaPipe hand points.
const HAND = [[0,0],[-0.35,0.25],[-0.6,0.5],[-0.8,0.7],[-0.95,0.9],
  [-0.25,0.9],[-0.3,1.3],[-0.33,1.55],[-0.35,1.75],
  [0,0.95],[0,1.4],[0,1.7],[0,1.9],
  [0.22,0.9],[0.26,1.3],[0.28,1.55],[0.3,1.72],
  [0.4,0.8],[0.5,1.1],[0.56,1.3],[0.6,1.45]];
const hand = (cx, cy, size, tilt) => HAND.map(([x, y], i) => {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { x: r4(cx + (x * c - y * s) * size), y: r4(cy - (x * s + y * c) * size * (4 / 3)), z: r4(-0.02 * (i % 4)) };
});

const frames = [];
for (let f = 0; f < FPS * SECONDS; f++) {
  const t = f / FPS;
  const open = Math.max(0, Math.sin(t * Math.PI * 1.4));  // jaw 0..1
  const yaw = (12 * Math.PI / 180) * Math.sin((t / SECONDS) * Math.PI * 2);
  const pts = V.map(([x, y, z]) => {
    const w = Math.max(0, Math.min(1, (-4.2 - y) / 0.8)); // below the mouth line
    const y2 = y - open * 1.2 * w;
    const x2 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z2 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return { x: r4(0.5 + x2 * KX), y: r4(0.45 - y2 * KY), z: r4(-z2 * KX) };
  });
  const center = (ring) => ({
    x: r4(ring.reduce((s, i) => s + pts[i].x, 0) / ring.length),
    y: r4(ring.reduce((s, i) => s + pts[i].y, 0) / ring.length),
    z: 0,
  });
  for (let i = 468; i < 473; i++) pts[i] = center(LEFT_EYE);
  for (let i = 473; i < 478; i++) pts[i] = center(RIGHT_EYE);

  const frame = { timestamp: Math.round(t * 1000), faceLandmarks: pts, blendshapes: { jawOpen: r4(open) } };
  if (withHands) {
    const wave = Math.sin(t * Math.PI * 2) * 0.35;
    frame.landmarks = [hand(0.2, 0.95, 0.09, wave), hand(0.8, 0.95, 0.09, -wave)];
  }
  frames.push(frame);
}

fs.mkdirSync('tools/fixtures', { recursive: true });
const name = withHands ? 'synthetic-face-hands-take.json' : 'synthetic-face-take.json';
fs.writeFileSync(`tools/fixtures/${name}`, JSON.stringify({ version: '2.0', type: 'FACE', duration: SECONDS, frames }));
console.log(`tools/fixtures/${name}: ${frames.length} frames`);
```

- [ ] **Step 2: Ignore the output.** Append to `.gitignore`:

```
# Synthetic takes for camera-less screenshots (regenerate: node tools/make-synthetic-take.mjs [--hands])
tools/fixtures/
```

- [ ] **Step 3: Run** — `node tools/make-synthetic-take.mjs` then `node tools/make-synthetic-take.mjs --hands`. Expected: `60 frames` each, files under `tools/fixtures/`, `git status` shows only the script and `.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add tools/make-synthetic-take.mjs .gitignore
git commit -m "Add synthetic face take generator for camera-less screenshot proof (face puppet P2, task 9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Controller verification after Task 9 (not a subagent step): `npm run dev` via `preview_start`, open Face Puppet, Load JSON with `tools/fixtures/synthetic-face-take.json` (or Grayson's real take if one is in the repo root), Play, screenshot the stage mid-take with the mouth open and closed. Confirm playback renders even though MediaPipe init errors in the preview. Send the screenshot to Grayson.

---

# Phase 3: Video + Pack export

### Task 10: Export helpers (`exportPack.ts`) + `fflate`

**Files:**
- Create: `components/face/exportPack.ts`
- Test: `components/face/exportPack.test.ts`
- Modify: `package.json` / `package-lock.json` (`fflate` runtime dep)

**Interfaces:**
- Produces:
  - `const VIDEO_MIME_CANDIDATES: readonly string[]` (Global Constraints order)
  - `function pickVideoMime(isSupported: (mime: string) => boolean): string | null`
  - `function extensionForMime(mime: string): string` (`video/mp4*` -> `mp4`, `video/webm*` -> `webm`, `audio/webm*` -> `webm`, `audio/mp4*` -> `m4a`, `audio/ogg*` -> `ogg`, else `bin`)
  - `function takeStamp(d: Date): string` (`YYYYMMDD-HHMMSS`, local time)
  - `interface PackInput { video: { blob: Blob; mimeType: string }; recordingJson: Blob; audio: { blob: Blob; mimeType: string } | null }`
  - `async function buildPackZip(input: PackInput): Promise<Uint8Array>`

- [ ] **Step 1: Add the dependency** — `npm i fflate@0.8`

- [ ] **Step 2: Write the failing test** `components/face/exportPack.test.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { pickVideoMime, extensionForMime, takeStamp, buildPackZip, VIDEO_MIME_CANDIDATES } from './exportPack';

describe('pickVideoMime', () => {
  it('prefers mp4 with codecs, then mp4, then webm', () => {
    expect(pickVideoMime(() => true)).toBe('video/mp4;codecs=avc1,mp4a');
    expect(pickVideoMime((m) => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickVideoMime((m) => m === 'video/webm')).toBe('video/webm');
    expect(VIDEO_MIME_CANDIDATES[0]).toBe('video/mp4;codecs=avc1,mp4a');
  });
  it('returns null when nothing is supported', () => {
    expect(pickVideoMime(() => false)).toBeNull();
  });
});

describe('extensionForMime', () => {
  it('maps video and audio types', () => {
    expect(extensionForMime('video/mp4;codecs=avc1,mp4a')).toBe('mp4');
    expect(extensionForMime('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('application/x-unknown')).toBe('bin');
  });
});

describe('takeStamp', () => {
  it('formats local time as YYYYMMDD-HHMMSS', () => {
    expect(takeStamp(new Date(2026, 8, 22, 7, 5, 9))).toBe('20260922-070509');
  });
});

describe('buildPackZip', () => {
  const video = { blob: new Blob([new Uint8Array([1, 2, 3])]), mimeType: 'video/webm;codecs=vp9,opus' };
  const recordingJson = new Blob(['{"schema":"puppeteer-lab/recording"}']);

  it('contains video, recording.json and audio', async () => {
    const audio = { blob: new Blob([new Uint8Array([9, 9])]), mimeType: 'audio/webm;codecs=opus' };
    const files = unzipSync(await buildPackZip({ video, recordingJson, audio }));
    expect(Object.keys(files).sort()).toEqual(['audio.webm', 'puppet.webm', 'recording.json']);
    expect(Array.from(files['puppet.webm'])).toEqual([1, 2, 3]);
    expect(strFromU8(files['recording.json'])).toContain('puppeteer-lab/recording');
  });

  it('omits audio when the take has none', async () => {
    const files = unzipSync(await buildPackZip({ video, recordingJson, audio: null }));
    expect(Object.keys(files).sort()).toEqual(['puppet.webm', 'recording.json']);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run components/face/exportPack.test.ts`, Expected FAIL (module missing).

- [ ] **Step 4: Implement** `components/face/exportPack.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for the Face Puppet exports: which video type MediaRecorder
 * should use (MP4 first so clips play on phones), file extensions, the take
 * timestamp, and the pack zip (media stored, JSON deflated).
 */
import { zipSync, Zippable } from 'fflate';

export const VIDEO_MIME_CANDIDATES: readonly string[] = [
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

export function pickVideoMime(isSupported: (mime: string) => boolean): string | null {
  return VIDEO_MIME_CANDIDATES.find((m) => isSupported(m)) ?? null;
}

export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith('video/mp4')) return 'mp4';
  if (m.startsWith('video/webm') || m.startsWith('audio/webm')) return 'webm';
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('audio/ogg')) return 'ogg';
  return 'bin';
}

export function takeStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface PackInput {
  video: { blob: Blob; mimeType: string };
  recordingJson: Blob;
  audio: { blob: Blob; mimeType: string } | null;
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

export async function buildPackZip(input: PackInput): Promise<Uint8Array> {
  const files: Zippable = {
    [`puppet.${extensionForMime(input.video.mimeType)}`]: [await bytes(input.video.blob), { level: 0 }],
    'recording.json': [await bytes(input.recordingJson), { level: 6 }],
  };
  if (input.audio) {
    files[`audio.${extensionForMime(input.audio.mimeType)}`] = [await bytes(input.audio.blob), { level: 0 }];
  }
  return zipSync(files);
}
```

- [ ] **Step 5: Run** — `npx vitest run components/face/exportPack.test.ts`, Expected PASS (7 tests). Full gate green.

- [ ] **Step 6: Commit**

```bash
git add components/face/exportPack.ts components/face/exportPack.test.ts package.json package-lock.json
git commit -m "Add export helpers: video MIME pick, extensions, take stamp, fflate pack zip (face puppet P3, task 10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `useRecorder` export seam + `downloadBlob`

**Files:**
- Create: `components/shared/download.ts`
- Modify: `hooks/useRecorder.ts`

**Interfaces:**
- Consumes: `parseDataUrl` (already imported in `useRecorder.ts`; returns `{ mimeType, base64 } | null`).
- Produces:
  - `download.ts`: `function downloadBlob(blob: Blob, filename: string): void`
  - `useRecorder` return gains:
    - `buildRecordingBlob(kind: 'full' | 'kinematics'): Promise<Blob>` (the worker-then-fallback serialize, no download)
    - `getAudio(): { blob: Blob; mimeType: string } | null` (live blob, or decoded from the imported take's data URL)
    - `getFrames(): FrameData[]` (the live buffer, read-only by convention)
  - `exportData` behavior unchanged for callers, except the audio download now uses the real MIME type and extension instead of a hardcoded `.webm`.

- [ ] **Step 1: Create `components/shared/download.ts`**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Save a Blob through a temporary <a download>. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Refactor `hooks/useRecorder.ts`.** Add imports:

```ts
import { downloadBlob } from '../components/shared/download';
import { extensionForMime } from '../components/face/exportPack';
```

Insert these three callbacks directly above `const exportData = useCallback(...)`:

```ts
    const getFrames = useCallback((): FrameData[] => bufferRef.current, []);

    /** The take's audio as a Blob: the live recording, or decoded from an imported file's data URL. */
    const getAudio = useCallback((): { blob: Blob; mimeType: string } | null => {
        if (audioBlobRef.current) {
            return { blob: audioBlobRef.current, mimeType: audioBlobRef.current.type || 'audio/webm' };
        }
        const parsed = audioBase64Ref.current ? parseDataUrl(audioBase64Ref.current) : null;
        if (!parsed) return null;
        const bin = atob(parsed.base64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return { blob: new Blob([buf], { type: parsed.mimeType }), mimeType: parsed.mimeType };
    }, []);

    /** 'full' / 'kinematics' v3 JSON as a Blob (worker first, chunked main-thread fallback). */
    const buildRecordingBlob = useCallback(async (kind: 'full' | 'kinematics'): Promise<Blob> => {
        const audio = kind === 'full' && audioBase64Ref.current ? (parseDataUrl(audioBase64Ref.current) ?? undefined) : undefined;
        const request: SerializeRequest = { frames: bufferRef.current, type, kind, durationMs: lastTimestamp(), audio };
        try {
            return await runSerializeWorker(request);
        } catch (err) {
            console.warn('Worker export unavailable, falling back to chunked main-thread serialize:', err);
            const json = await serializeV3Chunked(request.frames, request.type, request.kind, {
                durationMs: request.durationMs,
                video: request.video,
                audio: request.audio,
            });
            return new Blob([json], { type: 'application/json' });
        }
    }, [type]);
```

Replace the body of `exportData` (keep its signature and the "No recording to export." guard and `dateStr`) so the audio branch and the JSON branch become:

```ts
        if (format === 'audio') {
            const audio = getAudio();
            if (!audio) {
                alert("No audio track recorded in this session.");
                return;
            }
            downloadBlob(audio.blob, `${type.toLowerCase()}_audio_${dateStr}.${extensionForMime(audio.mimeType)}`);
            return;
        }

        const blob = await buildRecordingBlob(format);
        downloadBlob(blob, `${type.toLowerCase()}_${format === 'kinematics' ? 'kinematics' : 'recording'}_${dateStr}.json`);
    }, [type, getAudio, buildRecordingBlob]);
```

Keep the long explanatory comment above the JSON path (move it onto `buildRecordingBlob`). Add `getFrames`, `getAudio`, `buildRecordingBlob` to the returned object.

Note: `audioBase64Ref` is only filled by a `FileReader` after recording stops, so `buildRecordingBlob('full')` called immediately after Stop could miss audio; that race exists today and is unchanged. `getAudio` does not have it (it prefers the live blob).

- [ ] **Step 3: Gate** — `npm run typecheck; npm test; npm run smoke`. Green. Behavior check by reading: `grep -n "createElement('a')" hooks/useRecorder.ts` prints nothing (both downloads go through `downloadBlob`).

- [ ] **Step 4: Commit**

```bash
git add components/shared/download.ts hooks/useRecorder.ts
git commit -m "useRecorder: expose buildRecordingBlob/getAudio/getFrames for video+pack export; audio download keeps its real type (face puppet P3, task 11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Real-time video render + export UI

**Files:**
- Create: `components/face/exportVideo.ts`
- Modify: `components/RecorderControls.tsx`
- Modify: `components/FaceDemo.tsx`

**Interfaces:**
- Consumes: `pickVideoMime`, `extensionForMime`, `takeStamp`, `buildPackZip` (Task 10); `downloadBlob`, `recorder.buildRecordingBlob`, `recorder.getAudio`, `recorder.getFrames` (Task 11); `findFrameIndex` (`hooks/useRecorder.ts`, existing export); `drawPuppet` (Task 8); `nextMouthOpen`, `mouthOpenRatio` (Task 2).
- Produces:
  - `exportVideo.ts`: `interface RenderTakeOptions { frames: FrameData[]; durationMs: number; audio: { blob: Blob; mimeType: string } | null; width: number; height: number; draw: (ctx: CanvasRenderingContext2D, frame: FrameData, w: number, h: number) => void; onProgress?: (ms: number) => void; signal: AbortSignal }`, `async function renderTakeToVideo(o: RenderTakeOptions): Promise<{ blob: Blob; mimeType: string }>` (throws `DOMException('Export cancelled', 'AbortError')` when aborted).
  - `RecorderControls` new optional props: `primaryExport?: { label: string; onSelect: () => void }`, `extraExports?: { id: string; label: string; hint: string; onSelect: () => void }[]`, `busy?: boolean`. Absent props = exactly today's UI.

No unit test for `renderTakeToVideo` (needs DOM canvas, MediaRecorder, Web Audio). Its pure parts (MIME, frame lookup) are tested. Verified by the controller in the preview (WebM) and by Grayson in Chrome (MP4).

- [ ] **Step 1: Create `components/face/exportVideo.ts`**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Replays a take into an offscreen canvas in real time and records it with
 * MediaRecorder: canvas.captureStream(30) for video plus the take's audio
 * routed through Web Audio into the same stream (not to the speakers). The
 * audio element is the master clock, so lips and voice stay in sync. Takes
 * as long as the take; rAF pauses in a hidden tab, which stalls (not fails)
 * the export.
 */
import { FrameData } from '../../types';
import { findFrameIndex } from '../../hooks/useRecorder';
import { pickVideoMime } from './exportPack';

export interface RenderTakeOptions {
  frames: FrameData[];
  durationMs: number;
  audio: { blob: Blob; mimeType: string } | null;
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, frame: FrameData, w: number, h: number) => void;
  onProgress?: (ms: number) => void;
  signal: AbortSignal;
}

export async function renderTakeToVideo(o: RenderTakeOptions): Promise<{ blob: Blob; mimeType: string }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (no MediaRecorder).');
  const mimeType = pickVideoMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mimeType) throw new Error('This browser cannot record video (no supported MP4/WebM type).');

  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas for export.');
  o.draw(ctx, o.frames[0], o.width, o.height);

  const stream = canvas.captureStream(30);

  let audioEl: HTMLAudioElement | null = null;
  let audioCtx: AudioContext | null = null;
  let audioUrl: string | null = null;
  if (o.audio) {
    audioUrl = URL.createObjectURL(o.audio.blob);
    audioEl = new Audio(audioUrl);
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(audioEl);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest); // deliberately NOT to audioCtx.destination: silent export
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('MediaRecorder failed during export.'));
  });

  recorder.start(250);
  const t0 = performance.now();
  if (audioEl && audioCtx) {
    try {
      await audioCtx.resume();
      await audioEl.play();
    } catch (err) {
      console.warn('Export audio could not start; exporting silent video on the wall clock:', err);
      audioEl = null;
    }
  }

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (o.signal.aborted) return resolve();
      const clock = audioEl ? audioEl.currentTime * 1000 : performance.now() - t0;
      o.draw(ctx, o.frames[findFrameIndex(o.frames, clock)], o.width, o.height);
      o.onProgress?.(Math.min(clock, o.durationMs));
      if (clock >= o.durationMs || audioEl?.ended) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });

  recorder.stop();
  audioEl?.pause();
  stream.getTracks().forEach((t) => t.stop());
  await audioCtx?.close();
  if (audioUrl) URL.revokeObjectURL(audioUrl);

  const blob = await stopped;
  if (o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return { blob, mimeType };
}
```

- [ ] **Step 2: `RecorderControls.tsx` props.** Extend `RecorderControlsProps`:

```ts
    /** Replaces the primary Export button (default: Full JSON). */
    primaryExport?: { label: string; onSelect: () => void };
    /** Extra entries listed first in the export menu. */
    extraExports?: { id: string; label: string; hint: string; onSelect: () => void }[];
    /** Disables every control (e.g. while a video export renders). */
    busy?: boolean;
```

Destructure `primaryExport, extraExports, busy = false`. Then:
  - Record button: `disabled={isPlaying || busy}`. Stop-recording button unchanged.
  - Play/Pause: `disabled={!hasData || isRecording || busy}`. Stop-playback button: add `disabled={busy}`.
  - Scrubber: `disabled={!hasData || isRecording || busy}`.
  - Primary export button: `onClick={() => (primaryExport ? primaryExport.onSelect() : onExport('full'))}`, `disabled={!hasData || busy}`, label `{primaryExport?.label ?? 'Export'}`. Chevron: `disabled={!hasData || busy}`. Load JSON: `disabled={busy}` plus `disabled:opacity-30`.
  - In the popover, before the "Full Session (.json)" button, render:

```tsx
                        {extraExports?.map((x) => (
                            <button
                                key={x.id}
                                onClick={() => { x.onSelect(); setShowExportMenu(false); }}
                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/10 text-left text-gray-200"
                            >
                                <Film size={13} className="text-[#EE3B2B]" />
                                <div>
                                    <div className="font-semibold text-white">{x.label}</div>
                                    <div className="text-[9px] text-gray-400">{x.hint}</div>
                                </div>
                            </button>
                        ))}
```

  and add `Film` to the `lucide-react` import. Also change the audio entry label from `Audio Track (.webm)` to `Audio Track`.

- [ ] **Step 3: FaceDemo export wiring.** In `components/FaceDemo.tsx` add imports:

```ts
import { renderTakeToVideo } from './face/exportVideo';
import { buildPackZip, extensionForMime, takeStamp } from './face/exportPack';
import { downloadBlob } from './shared/download';
import { FrameData } from '../types';
```

Add state/refs after the existing refs:

```ts
  const [exportState, setExportState] = useState<{ kind: 'video' | 'pack'; ms: number } | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportFrameRef = useRef<FrameData | null>(null);
```

Add the export runner (a plain function inside the component, above `return`):

```ts
  const runExport = async (kind: 'video' | 'pack') => {
      const stage = canvasRef.current;
      if (!recorder.hasData || !stage || exportAbortRef.current) return;
      recorder.stopPlayback();

      const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
      const width = even(Math.min(stage.width, 1280));
      const height = even((width * stage.height) / stage.width);
      const ctrl = new AbortController();
      exportAbortRef.current = ctrl;
      setExportState({ kind, ms: 0 });

      let mouthOpen = false;
      let lastProgress = 0;
      try {
          const audio = recorder.getAudio();
          const video = await renderTakeToVideo({
              frames: recorder.getFrames(),
              durationMs: recorder.durationMs,
              audio,
              width,
              height,
              signal: ctrl.signal,
              draw: (ctx, frame, w, h) => {
                  exportFrameRef.current = frame;
                  const face = frame.faceLandmarks ?? null;
                  if (face) mouthOpen = nextMouthOpen(mouthOpen, mouthOpenRatio(face, videoAspectRef.current));
                  drawPuppet(ctx, { face, mouthOpen }, w, h, { showGazeRays, showMocapDots, videoAspect: videoAspectRef.current });
              },
              onProgress: (ms) => {
                  const now = performance.now();
                  if (now - lastProgress >= 100) { lastProgress = now; setExportState({ kind, ms }); }
              },
          });

          const stamp = takeStamp(new Date());
          if (kind === 'video') {
              downloadBlob(video.blob, `puppet-take-${stamp}.${extensionForMime(video.mimeType)}`);
          } else {
              const recordingJson = await recorder.buildRecordingBlob('full');
              const zip = await buildPackZip({ video, recordingJson, audio });
              downloadBlob(new Blob([zip], { type: 'application/zip' }), `puppet-take-${stamp}.zip`);
          }
      } catch (err: any) {
          if (err?.name !== 'AbortError') alert(`Export failed: ${err?.message ?? err}`);
      } finally {
          exportAbortRef.current = null;
          exportFrameRef.current = null;
          setExportState(null);
      }
  };
```

In the render loop, add a first branch so the stage mirrors the frame being exported (insert before `// If Playing, read from buffer` and turn that `if` into `else if`):

```ts
              if (exportFrameRef.current) {
                  currentLandmarks = exportFrameRef.current.faceLandmarks;
                  currentBlendshapesRecord = exportFrameRef.current.blendshapes || {};
              }
```

Pass the new props to `RecorderControls`:

```tsx
                  busy={exportState !== null}
                  primaryExport={{ label: 'Video', onSelect: () => runExport('video') }}
                  extraExports={[
                      { id: 'video', label: 'Video', hint: 'Puppet + your voice, as it plays', onSelect: () => runExport('video') },
                      { id: 'pack', label: 'Pack (.zip)', hint: 'Video + recording.json + audio', onSelect: () => runExport('pack') },
                  ]}
```

Add the progress strip inside the main canvas container (after the PiP block):

```tsx
          {exportState && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-3 bg-[#111317]/95 border border-white/15 rounded-lg px-3 py-2 font-mono text-[11px] text-gray-200 shadow-2xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EE3B2B] animate-pulse" />
                  <span>
                      RENDERING {exportState.kind === 'pack' ? 'PACK' : 'VIDEO'}{' '}
                      <span className="tabular-nums text-white">{(exportState.ms / 1000).toFixed(1)}s / {(recorder.durationMs / 1000).toFixed(1)}s</span>
                  </span>
                  <span className="text-gray-500">real time, keep this tab in front</span>
                  <button
                      onClick={() => exportAbortRef.current?.abort()}
                      className="px-2 py-0.5 rounded border border-white/20 hover:bg-white/10 text-white"
                  >
                      Cancel
                  </button>
              </div>
          )}
```

- [ ] **Step 4: Gate** — `npm run typecheck; npm test; npm run smoke`. Green. Confirm other demos untouched: `git diff --stat HEAD -- components/MotionRecorder.tsx components/telemetry components/aircanvas components/RhythmGame.tsx` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add components/face/exportVideo.ts components/RecorderControls.tsx components/FaceDemo.tsx
git commit -m "Face Puppet exports a video with audio and a zip pack; real-time render with progress + cancel (face puppet P3, task 12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Controller verification after Task 12: in the preview, Load JSON the synthetic take, Export -> Video, let it finish, confirm a `.webm` (or `.mp4`) downloads and plays; Export -> Pack, confirm the zip has `puppet.*` and `recording.json` (no audio in a synthetic take). Send Grayson the clip plus a screenshot of the progress strip.

---

# Phase 4: Hands

### Task 13: `handMesh.ts`

**Files:**
- Create: `components/face/handMesh.ts`
- Test: `components/face/handMesh.test.ts`

**Interfaces:**
- Consumes: `Projection`, `ShadedTri`, `triIntensity`, `shadeColor`, `LIGHT_DIR` (Task 7); `Landmark`.
- Produces:
  - `const HAND_PALM_TRIS: readonly [number, number, number][]` = `[[0,1,5],[0,5,9],[0,9,13],[0,13,17]]`
  - `const HAND_FINGERS: readonly number[][]` = `[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]]`
  - `const FINGER_TAPER: readonly number[]` = `[1.0, 0.9, 0.82, 0.77]` (joint half-width multipliers, knuckle to tip; knuckle / tip = 1.3)
  - `const FINGER_HALF_WIDTH_OF_PALM = 0.07`
  - `function buildHandTriangles(lm: Landmark[], proj: Projection): ShadedTri[]` (4 palm + 15 bones x 2 = 34 triangles; palm first, then fingers)

- [ ] **Step 1: Write the failing test** `components/face/handMesh.test.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildHandTriangles, FINGER_TAPER } from './handMesh';
import { fitProjection } from './lowPoly';

// Open hand: wrist at (cx, cy), fingers pointing up, `s` = size in normalized units.
const hand = (cx: number, cy: number, s: number) => {
  const pts: [number, number][] = [[0,0],[-0.35,0.25],[-0.6,0.5],[-0.8,0.7],[-0.95,0.9],
    [-0.25,0.9],[-0.3,1.3],[-0.33,1.55],[-0.35,1.75],[0,0.95],[0,1.4],[0,1.7],[0,1.9],
    [0.22,0.9],[0.26,1.3],[0.28,1.55],[0.3,1.72],[0.4,0.8],[0.5,1.1],[0.56,1.3],[0.6,1.45]];
  return pts.map(([x, y], i) => ({ x: cx + x * s, y: cy - y * s, z: -0.01 * (i % 4) }));
};
const proj = fitProjection(800, 600, 4 / 3);

// Triangle 4 is the first finger bone's first triangle: (a+p*wa, b+p*wb, b-p*wb).
// Its a-side width is the distance between vertex A of tri 4 and vertex C of tri 5 (a-p*wa).
const knuckleWidth = (lm: ReturnType<typeof hand>) => {
  const t = buildHandTriangles(lm, proj);
  return Math.hypot(t[4].ax - t[5].cx, t[4].ay - t[5].cy);
};

describe('buildHandTriangles', () => {
  it('emits 4 palm + 30 finger triangles', () => {
    expect(buildHandTriangles(hand(0.5, 0.8, 0.1), proj).length).toBe(34);
  });

  it('scales finger width with palm size', () => {
    expect(knuckleWidth(hand(0.5, 0.8, 0.2))).toBeCloseTo(knuckleWidth(hand(0.5, 0.8, 0.1)) * 2, 1);
  });

  it('tapers about 1.3x from knuckle to tip', () => {
    expect(FINGER_TAPER[0] / FINGER_TAPER[FINGER_TAPER.length - 1]).toBeCloseTo(1.3, 1);
  });

  it('uses gray-ramp colors only', () => {
    for (const t of buildHandTriangles(hand(0.5, 0.8, 0.1), proj)) expect(t.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/face/handMesh.test.ts`, Expected FAIL (module missing).

- [ ] **Step 3: Implement** `components/face/handMesh.ts`

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Low-poly hand for the Face Puppet, same look as the head: a flat-shaded
 * palm fan plus one tapered quad (two triangles) per finger bone, two tones
 * from the bone's angle to the light. Chirality-agnostic (two-sided), so a
 * hand's side label never matters for drawing.
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection, ShadedTri, triIntensity, shadeColor, LIGHT_DIR } from './lowPoly';

export const HAND_PALM_TRIS: readonly [number, number, number][] = [[0, 1, 5], [0, 5, 9], [0, 9, 13], [0, 13, 17]];
export const HAND_FINGERS: readonly number[][] = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
export const FINGER_TAPER: readonly number[] = [1.0, 0.9, 0.82, 0.77];
export const FINGER_HALF_WIDTH_OF_PALM = 0.07;

const LIGHT_2D = (() => {
  const m = Math.hypot(LIGHT_DIR[0], LIGHT_DIR[1]);
  return [LIGHT_DIR[0] / m, LIGHT_DIR[1] / m];
})();

type P3 = [number, number, number];

export function buildHandTriangles(lm: Landmark[], proj: Projection): ShadedTri[] {
  const pt = (i: number): P3 => [proj.x(lm[i]), proj.y(lm[i]), proj.z(lm[i])];
  const tri = (a: P3, b: P3, c: P3, color: string): ShadedTri => ({
    ax: a[0], ay: a[1], bx: b[0], by: b[1], cx: c[0], cy: c[1],
    depth: (a[2] + b[2] + c[2]) / 3,
    color,
  });

  const out: ShadedTri[] = [];
  for (const [i, j, k] of HAND_PALM_TRIS) {
    const a = pt(i), b = pt(j), c = pt(k);
    out.push(tri(a, b, c, shadeColor(triIntensity(a, b, c))));
  }

  const wrist = pt(0);
  const mid = pt(9);
  const halfBase = Math.hypot(mid[0] - wrist[0], mid[1] - wrist[1]) * FINGER_HALF_WIDTH_OF_PALM;

  for (const finger of HAND_FINGERS) {
    for (let s = 0; s < finger.length - 1; s++) {
      const a = pt(finger[s]);
      const b = pt(finger[s + 1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / len;
      const dy = (b[1] - a[1]) / len;
      const px = -dy, py = dx; // perpendicular
      const wa = halfBase * FINGER_TAPER[s];
      const wb = halfBase * FINGER_TAPER[s + 1];
      const aL: P3 = [a[0] + px * wa, a[1] + py * wa, a[2]];
      const aR: P3 = [a[0] - px * wa, a[1] - py * wa, a[2]];
      const bL: P3 = [b[0] + px * wb, b[1] + py * wb, b[2]];
      const bR: P3 = [b[0] - px * wb, b[1] - py * wb, b[2]];
      const color = shadeColor(0.45 + 0.35 * Math.abs(dx * LIGHT_2D[0] + dy * LIGHT_2D[1]));
      out.push(tri(aL, bL, bR, color));
      out.push(tri(aL, bR, aR, color));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run** — `npx vitest run components/face/handMesh.test.ts`, Expected PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/face/handMesh.ts components/face/handMesh.test.ts
git commit -m "Add low-poly hand mesh: palm fan + tapered finger quads (face puppet P4, task 13)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Recording channels for face + hands

**Files:**
- Modify: `components/shared/recordingSchema.ts`
- Test: `components/shared/recordingSchema.test.ts` (append)

**Interfaces:**
- Produces: `function channelsFor(frames: FrameData[], type: TrackingType): RecordingV3Channel[]` (`HAND` -> `['hands']`; `FACE` -> `['face', 'hands']` when any frame has a non-empty `landmarks`, else `['face']`). Used at all three sites that currently write `type === 'FACE' ? ['face'] : ['hands']` (`buildEnvelope`, `buildKinematics`, `serializeV3Chunked`).

- [ ] **Step 1: Write failing tests** (append to `components/shared/recordingSchema.test.ts`; add `channelsFor` to its import from `./recordingSchema`, and import `buildEnvelope`, `serializeV3`, `migrateV2`, `detectTrackingType` if not already imported):

```ts
describe('channelsFor', () => {
  const faceFrame = { timestamp: 0, faceLandmarks: [{ x: 0.5, y: 0.5, z: 0 }], blendshapes: {} };
  const hand21 = Array.from({ length: 21 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.5, z: 0 }));

  it('HAND takes stay hands', () => {
    expect(channelsFor([{ timestamp: 0 }], 'HAND')).toEqual(['hands']);
  });
  it('FACE takes without hands stay face-only', () => {
    expect(channelsFor([faceFrame], 'FACE')).toEqual(['face']);
  });
  it('FACE takes with hands in any frame carry both', () => {
    expect(channelsFor([faceFrame, { ...faceFrame, timestamp: 33, landmarks: [hand21] }], 'FACE')).toEqual(['face', 'hands']);
  });
  it('a face+hands take round-trips through v3 with its hand', () => {
    const frames = [{ ...faceFrame, landmarks: [hand21] }];
    const json = JSON.parse(serializeV3(buildEnvelope(frames, 'FACE', { durationMs: 0 })));
    expect(json.channels).toEqual(['face', 'hands']);
    expect(detectTrackingType(json)).toBe('FACE');
    const back = migrateV2(json);
    expect(back[0].landmarks).toHaveLength(1);
    expect(back[0].landmarks![0]).toHaveLength(21);
    expect(back[0].faceLandmarks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/shared/recordingSchema.test.ts`, Expected FAIL (`channelsFor` not exported).

- [ ] **Step 3: Implement.** In `components/shared/recordingSchema.ts` add `RecordingV3Channel` to the `../../types` import and:

```ts
/** Which channels a take carries. A Face Puppet take gains 'hands' once any
 * frame recorded a hand (FrameData.landmarks), so importers know to look. */
export function channelsFor(frames: FrameData[], type: TrackingType): RecordingV3Channel[] {
    if (type !== 'FACE') return ['hands'];
    return frames.some((f) => f.landmarks && f.landmarks.length > 0) ? ['face', 'hands'] : ['face'];
}
```

Replace `channels: type === 'FACE' ? ['face'] : ['hands'],` in `buildEnvelope` and `buildKinematics` with `channels: channelsFor(frames, type),`. In `serializeV3Chunked` replace `const channels = type === 'FACE' ? (['face'] as const) : (['hands'] as const);` with `const channels = channelsFor(frames, type);` (the two `[...channels]` spreads can stay).

- [ ] **Step 4: Run** — `npx vitest run`, all PASS. Full gate green.

- [ ] **Step 5: Commit**

```bash
git add components/shared/recordingSchema.ts components/shared/recordingSchema.test.ts
git commit -m "v3 channels carry 'hands' for Face Puppet takes with hands (face puppet P4, task 14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Hands in the Face Puppet (track, record, draw, export)

**Files:**
- Modify: `components/face/FaceMeshRenderer.ts`
- Modify: `components/FaceDemo.tsx`

**Interfaces:**
- Consumes: `buildHandTriangles` (Task 13), `fillTriangles` (Task 8, exported), `useTracker({ hands: true, face: true })` (Task 4), `channelsFor` (Task 14, automatic via export).
- Produces: `PuppetFrame` gains `hands: Landmark[][]`. Every `drawPuppet` call site passes it.

- [ ] **Step 1: Renderer.** In `components/face/FaceMeshRenderer.ts`:
  - `import { buildHandTriangles } from './handMesh';`
  - `PuppetFrame` becomes `{ face: Landmark[] | null; hands: Landmark[][]; mouthOpen: boolean }`.
  - In `drawPuppet`, after the face block and before `ctx.restore()`:

```ts
  // Hands always in front of the face (you gesture in front of yourself).
  for (const hand of frame.hands) {
    if (hand && hand.length >= 21) fillTriangles(ctx, buildHandTriangles(hand, p));
  }
```

- [ ] **Step 2: FaceDemo.**
  - Tracker: `useTracker(videoRef, { hands: true, face: true, faceSmoothing })`.
  - Declare `let currentHands: Landmark[][] = [];` next to `currentLandmarks`.
  - Export-frame branch: `currentHands = exportFrameRef.current.landmarks ?? [];`
  - Playback branch: `currentHands = frame.landmarks ?? [];` (inside `if (frame)`).
  - Live branch: read hands whether or not a face is present, and record them (right first, matching `recordingSchema`'s index 0 = right convention):

```ts
                  const tracked = frameRef.current;
                  currentHands = tracked ? [tracked.right, tracked.left].filter((h) => h !== null).map((h) => h!.landmarks) : [];
                  const face = tracked?.face;
                  if (face) {
                      currentLandmarks = face.landmarks;
                      currentBlendshapesRecord = face.blendshapes;
                      if (recorder.isRecording) {
                          recorder.captureFrame({
                              faceLandmarks: currentLandmarks,
                              blendshapes: currentBlendshapesRecord,
                              landmarks: currentHands,
                          });
                      }
                  }
```

  - Stage `drawPuppet` call: `{ face: currentLandmarks ?? null, hands: currentHands, mouthOpen: mouthOpenRef.current }`.
  - Export `draw` callback: `drawPuppet(ctx, { face, hands: frame.landmarks ?? [], mouthOpen }, w, h, {...})`.
  - Sidebar description text becomes: `Low-poly puppet driven by 478 face landmarks, 52 blendshapes, and both hands.`

- [ ] **Step 3: Gate** — `npm run typecheck; npm test; npm run smoke`. Green.

- [ ] **Step 4: Commit**

```bash
git add components/face/FaceMeshRenderer.ts components/FaceDemo.tsx
git commit -m "Face Puppet tracks, records, draws and exports both hands in one face+hands loop (TDD-001 P3; face puppet P4, task 15)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Controller verification after Task 15: Load JSON `tools/fixtures/synthetic-face-hands-take.json` in the preview, Play, screenshot face + both hands; export a Video and confirm hands are in the clip. Send both to Grayson.

---

### Task 16: Docs

**Files:**
- Modify: `HANDOFF.md`, `PLANNING.md`, `demos/face-telemetry/PLANNING.md`, `docs/tdd/TDD-001-tracker-core.md` (phase table row 3 status only)

- [ ] **Step 1: `demos/face-telemetry/PLANNING.md`**, replace the "Operational Tools" bullets with the current truth: low-poly faceted head (fixed ~210-vertex topology from the canonical face, flat Lambert on one gray ramp), One Euro face smoothing with a slider, ratio + hysteresis mouth with a closed seam, low-poly hands, recorder with scrubber, exports: Video (MP4 or WebM with audio), Pack (.zip), Full JSON, Kinematics, Audio. Keep the "Planned" section; mark "Cybernetic Mimic Mask" as partly realized by this pass (faceted mesh, no WebGL).

- [ ] **Step 2: `PLANNING.md`**: add a Done line for 2026-09-22 (Face Puppet overhaul, with the commit range), and note TDD-001 Phase 3 landed for Face Puppet (face into `useTracker`, combined face+hands loop); "enabling `hands` and `face` together in Hand Telemetry (dev-only toggle)" from the TDD gate was not built, Face Puppet is the combined-loop consumer instead.

- [ ] **Step 3: `docs/tdd/TDD-001-tracker-core.md`**: in the phase table, append to row 3's gate cell: `Landed 2026-09-22 via Face Puppet (face-only adapter dropped: no consumers left). Host check pending.`

- [ ] **Step 4: `HANDOFF.md`**: add host-verification items under "Next concrete step":
  1. Face Puppet mouth: no flicker at the open/close boundary; closed shows a seam, not a sliver. Retune `MOUTH_OPEN_ABOVE` / `MOUTH_CLOSE_BELOW` (`components/face/mouthState.ts`) if needed.
  2. Face Smoothing slider: LIGHT jitters a little, HEAVY lags a little, default feels calm.
  3. Face + hands loop holds 30 fps or better (DevTools Performance or an fps readout); alternate-tick face policy engages only when it has to.
  4. Export -> Video in Chrome gives an MP4 that plays on a phone with audio in sync.
  5. Export -> Pack unzips to `puppet.mp4`, `recording.json`, `audio.*`; `recording.json` loads back via Load JSON and plays.
  Add open questions: `capture.smoothing` deferred (spec deviation 2); a left-only hand is labelled `right` in v3 files (deviation 1, inherited from Hand Telemetry's convention).

- [ ] **Step 5: Commit**

```bash
git add HANDOFF.md PLANNING.md demos/face-telemetry/PLANNING.md docs/tdd/TDD-001-tracker-core.md
git commit -m "Docs: Face Puppet overhaul landed; host-verification checklist (face puppet, task 16)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
