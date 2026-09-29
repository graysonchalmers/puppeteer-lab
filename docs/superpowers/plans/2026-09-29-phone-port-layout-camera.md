# Phone Port (Layout + Camera) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Face Puppet usable on a phone (iPhone Safari first, Android Chrome second): reachable layout, front and rear camera, tracker that survives a failing GPU delegate, and a debug readout so real-phone performance can be measured.

**Architecture:** One phone layout behind the existing `md:` (768px) breakpoint plus a `useIsPhone()` hook for the few places that need JS: full-screen stage, fixed bottom bar (transport + camera flip + Controls), and the existing sidebar restyled as a slide-up drawer (same DOM, CSS-only difference, desktop untouched). Rear-camera frames are normalized once at `useTracker` output by a pure `mirrorFrame()` (flip x, swap hand sides and blendshape sides, conjugate the head matrix), so the puppet, recorder, exports and Blender importer see identical semantics to a front-camera take: no schema change.

**Tech Stack:** React 18, TypeScript, Vite 6, Tailwind via CDN (runtime JIT, arbitrary values work), MediaPipe tasks-vision 0.10.9, Three.js, vitest (node env, `**/*.test.ts` only), Playwright (new devDependency, local gate only).

**Spec:** the decisions in this session's grill (below) plus `docs/PHONE_PORT.md` items 1 and 2.

| # | Decision |
|---|---|
| 1 | Face Puppet only is verified; shared code (`useTracker`, `App.tsx`) is fixed for all demos |
| 2 | Rear camera included (flip button, `facingMode` option, `ideal` never `exact`) |
| 3 | Rear frames normalized at tracker output; no schema bump, no downstream edits, PiP gets a conditional mirror |
| 4 | Full-screen stage (`dvh`) + fixed bottom bar + slide-up Controls drawer; targets >= 44px; desktop untouched |
| 5 | Playwright gate (Chromium touch + WebKit at 390x844, fake camera, plus desktop 1440x900) -> deploy to mocap -> Grayson tests on an iPhone |
| 6 | Desktop defaults kept on phone for now; GPU->CPU fallback with a visible notice; `?debug` fps readout so Grayson reports real numbers before any hands-off/LOW-mesh default is chosen |

Out of scope: recording/export/download on iOS (PHONE_PORT item 3), Tailwind self-hosting (item 4), phone-optimized other demos, landscape-phone layout (>= 768px wide falls into the desktop layout; it must not be broken, it need not be pretty).

## Global Constraints

- Desktop layout at >= 768px stays as it is today. Every phone-only style sits behind `md:` overrides or `isPhone`.
- No recording-schema change; `RecordingV3*` types and `components/shared/recordingSchema.ts` are not edited.
- No new runtime dependency. `playwright` is a devDependency only; it is not added to CI.
- Touch targets on a phone are >= 44px in their smaller dimension (Apple HIG).
- `getUserMedia` uses `facingMode: { ideal: ... }`, never `exact`.
- vitest runs in `environment: 'node'` and only picks up `**/*.test.ts`: unit tests are pure logic only (no DOM, no React).
- Gate = `npm run typecheck`, `npm test`, `npm run smoke`, then `node scripts/phone-check.mjs`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never read or print `.env*`. Runnable steps handed to Grayson are PowerShell 5.1: sequence with `;`, never `&&`.
- Work in this worktree only: `C:\Projects-local\Tool-PuppeteerLab\.claude\worktrees\puppeteer-lab-mobile-ecc9b4`.

## Review Focus

Failure modes the spec implies but the happy path never shows. Each has a test in the owning task.

1. **One-camera device asked for the rear camera** (`ideal: 'environment'` silently returns the front camera): the mirror decision must follow what the track reports, not what was requested. Test: `resolveFacing` (Task 2).
2. **Camera failure reasons**: permission denied, no camera, camera busy, and an insecure (non-https) page where `navigator.mediaDevices` is undefined all need a readable message and a working Retry. Test: `describeCameraError` (Task 2) and the WebKit no-camera run (Task 6/7).
3. **GPU delegate throws on creation** (reported on iOS): fall back to CPU rather than dead-ending on "Failed to load". Test: `createWithDelegateFallback` (Task 2).
4. **Mirror correctness beyond x**: a mirrored frame must swap Left/Right blendshapes, hand sides and `left`/`right` pointers, negate world x and velocity x, and conjugate the head matrix; mirroring twice must return the original. Tests: `mirrorFrame.test.ts` (Task 1).
5. **Scroll under `touch-action: none`**: `index.html` sets it on html/body/#root; the drawer must still scroll by touch. Test: CDP touch-scroll check in `phone-check.mjs` (Task 3, passes after Task 4).

---

### Task 1: `mirrorFrame` (pure)

**Files:**
- Create: `components/shared/mirrorFrame.ts`
- Test: `components/shared/mirrorFrame.test.ts`

**Interfaces:**
- Consumes: `TrackedFrame`, `TrackedHand`, `TrackedFace`, `Landmark`, `Vec3` from `components/shared/trackerTypes.ts`; `mapHandToWorld(x, y, depthOffset)` from `components/shared/mapHandToWorld.ts` (test only).
- Produces: `swapSide(name: string): string`, `mirrorBlendshapes(b: Record<string, number>): Record<string, number>`, `mirrorTransform(m: number[] | null): number[] | null`, `mirrorFrame(f: TrackedFrame): TrackedFrame`.

- [ ] **Step 1: Write the failing test**

Create `components/shared/mirrorFrame.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mirrorFrame, mirrorBlendshapes, mirrorTransform, swapSide } from './mirrorFrame';
import { mapHandToWorld } from './mapHandToWorld';
import { Landmark, TrackedFrame, TrackedHand } from './trackerTypes';

// x values are binary fractions (0.25, 0.75) so 1 - (1 - x) round-trips exactly.
const lm = (x: number, y = 0.5, z = 0.1): Landmark => ({ x, y, z });

function hand(side: 'left' | 'right', x: number): TrackedHand {
  const w = mapHandToWorld(x, 0.5, 0);
  return {
    side,
    score: 0.9,
    landmarks: [lm(x)],
    rawLandmarks: [lm(x)],
    world: [{ x: w.x, y: w.y, z: w.z }],
    tip: { x: w.x, y: w.y, z: w.z },
    velocity: { x: 3, y: 4, z: 5 },
    pinch: 0.1,
  };
}

function frame(): TrackedFrame {
  const r = hand('right', 0.25);
  const l = hand('left', 0.75);
  return {
    t: 100,
    dt: 16,
    hands: [r, l],
    right: r,
    left: l,
    face: {
      landmarks: [lm(0.25), lm(0.5)],
      rawLandmarks: [lm(0.25), lm(0.5)],
      blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1, jawOpen: 0.4 },
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25, 0.5, -0.75, 1],
    },
  };
}

describe('swapSide', () => {
  it('swaps a trailing Left/Right and leaves centered shapes alone', () => {
    expect(swapSide('eyeBlinkLeft')).toBe('eyeBlinkRight');
    expect(swapSide('mouthSmileRight')).toBe('mouthSmileLeft');
    expect(swapSide('eyeLookInLeft')).toBe('eyeLookInRight');
    expect(swapSide('jawOpen')).toBe('jawOpen');
    expect(swapSide('browInnerUp')).toBe('browInnerUp');
  });
});

describe('mirrorBlendshapes', () => {
  it('moves each value to the opposite side', () => {
    expect(mirrorBlendshapes({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1, jawOpen: 0.4 })).toEqual({
      eyeBlinkRight: 0.9,
      eyeBlinkLeft: 0.1,
      jawOpen: 0.4,
    });
  });
});

describe('mirrorTransform', () => {
  it('negates x translation and the x-row/x-column rotation terms only (column-major)', () => {
    const m = [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 0.25, 0.5, -0.75, 1];
    const out = mirrorTransform(m)!;
    expect(out[0]).toBe(1); // (0,0) unchanged
    expect(out[1]).toBe(-2); // (1,0): column 0, row 1
    expect(out[4]).toBe(-4); // (0,1): column 1, row 0
    expect(out[5]).toBe(5); // (1,1) unchanged
    expect(out[9]).toBe(8); // (1,2) unchanged
    expect(out[12]).toBe(-0.25); // tx
    expect(out[13]).toBe(0.5); // ty
    expect(out[15]).toBe(1);
  });
  it('passes null and malformed input through', () => {
    expect(mirrorTransform(null)).toBeNull();
    expect(mirrorTransform([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('mirrorFrame', () => {
  it('flips x and swaps sides for hands, keeping left/right pointing into hands', () => {
    const out = mirrorFrame(frame());
    // The old right hand (x 0.25) is now the left hand at x 0.75.
    expect(out.left!.side).toBe('left');
    expect(out.left!.landmarks[0].x).toBe(0.75);
    expect(out.right!.side).toBe('right');
    expect(out.right!.landmarks[0].x).toBe(0.25);
    expect(out.hands).toContain(out.left);
    expect(out.hands).toContain(out.right);
    expect(out.hands.length).toBe(2);
  });

  it('keeps world x consistent with mapHandToWorld on the flipped x', () => {
    const out = mirrorFrame(frame());
    // The old right hand came from x=0.25; flipped it sits at x=0.75.
    const expected = mapHandToWorld(0.75, 0.5, 0).x;
    expect(out.left!.world[0].x).toBeCloseTo(expected, 10);
    expect(out.left!.tip.x).toBeCloseTo(expected, 10);
  });

  it('negates only velocity x', () => {
    const out = mirrorFrame(frame());
    expect(out.left!.velocity).toEqual({ x: -3, y: 4, z: 5 });
  });

  it('flips face landmarks, swaps blendshape sides and conjugates the head matrix', () => {
    const out = mirrorFrame(frame());
    expect(out.face!.landmarks[0].x).toBe(0.75);
    expect(out.face!.rawLandmarks[1].x).toBe(0.5);
    expect(out.face!.blendshapes.eyeBlinkRight).toBe(0.9);
    expect(out.face!.blendshapes.eyeBlinkLeft).toBe(0.1);
    expect(out.face!.transform![12]).toBe(-0.25);
  });

  it('is its own inverse', () => {
    const f = frame();
    expect(mirrorFrame(mirrorFrame(f))).toEqual(f);
  });

  it('does not mutate its input', () => {
    const f = frame();
    const copy = structuredClone(f);
    mirrorFrame(f);
    expect(f).toEqual(copy);
  });

  it('handles frames with no face and one hand', () => {
    const r = hand('right', 0.25);
    const out = mirrorFrame({ t: 1, dt: 0, hands: [r], right: r, left: null, face: null });
    expect(out.face).toBeNull();
    expect(out.right).toBeNull();
    expect(out.left!.landmarks[0].x).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/shared/mirrorFrame.test.ts`
Expected: FAIL, cannot resolve `./mirrorFrame`.

- [ ] **Step 3: Write the implementation**

Create `components/shared/mirrorFrame.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rear-camera normalization. MediaPipe sees the same raw geometry from the
 * front and the rear camera, but everything downstream (the puppet's X mirror,
 * the recorder, mapHandToWorld's X mirror, the Blender importer) assumes the
 * front-camera convention. Mirroring the frame once at the tracker output
 * lets a rear-camera take mean exactly what a front-camera take means, with
 * no schema change: x flips, hand sides and blendshape sides swap, world x and
 * velocity x negate, and the head matrix is conjugated by diag(-1, 1, 1, 1).
 */
import { Landmark, TrackedFace, TrackedFrame, TrackedHand, Vec3 } from './trackerTypes';

const flipLm = (l: Landmark): Landmark => ({ x: 1 - l.x, y: l.y, z: l.z });
// 0 - v (not -v) so a zero never becomes -0.
const flipVec = (v: Vec3): Vec3 => ({ x: 0 - v.x, y: v.y, z: v.z });

/** ARKit blendshape names end in Left/Right when they are sided. */
export function swapSide(name: string): string {
  if (name.endsWith('Left')) return name.slice(0, -4) + 'Right';
  if (name.endsWith('Right')) return name.slice(0, -5) + 'Left';
  return name;
}

export function mirrorBlendshapes(b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(b)) out[swapSide(k)] = b[k];
  return out;
}

/** F * M * F with F = diag(-1,1,1,1) on a column-major 4x4: negate entries where exactly one of row/col is 0. */
export function mirrorTransform(m: number[] | null): number[] | null {
  if (!m || m.length !== 16) return m;
  return m.map((v, i) => ((i % 4 === 0) !== (i < 4) ? 0 - v : v));
}

function flipHand(h: TrackedHand): TrackedHand {
  return {
    ...h,
    side: h.side === 'left' ? 'right' : 'left',
    landmarks: h.landmarks.map(flipLm),
    rawLandmarks: h.rawLandmarks.map(flipLm),
    world: h.world.map(flipVec),
    tip: flipVec(h.tip),
    velocity: flipVec(h.velocity),
  };
}

function flipFace(f: TrackedFace): TrackedFace {
  return {
    landmarks: f.landmarks.map(flipLm),
    rawLandmarks: f.rawLandmarks.map(flipLm),
    blendshapes: mirrorBlendshapes(f.blendshapes),
    transform: mirrorTransform(f.transform),
  };
}

export function mirrorFrame(f: TrackedFrame): TrackedFrame {
  const hands = f.hands.map(flipHand);
  const flipped = new Map<TrackedHand, TrackedHand>(f.hands.map((h, i) => [h, hands[i]]));
  return {
    ...f,
    hands,
    // The old right hand is now the left one (and vice versa).
    left: f.right ? flipped.get(f.right) ?? null : null,
    right: f.left ? flipped.get(f.left) ?? null : null,
    face: f.face ? flipFace(f.face) : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/shared/mirrorFrame.test.ts`
Expected: PASS, all tests. (If `mapHandToWorld`'s parameter order differs from `(x, y, depthOffset)`, read `components/shared/buildFrame.ts` where it is called and fix the test helper; do not change the implementation.)

- [ ] **Step 5: Commit**

```bash
git add components/shared/mirrorFrame.ts components/shared/mirrorFrame.test.ts
git commit -m "feat(phone): mirrorFrame normalizes rear-camera frames to the front-camera convention

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Camera, fps and PiP-size helpers (pure)

**Files:**
- Create: `hooks/cameraSupport.ts`, `hooks/cameraSupport.test.ts`
- Create: `components/shared/fpsMeter.ts`, `components/shared/fpsMeter.test.ts`
- Create: `components/face/pipSize.ts`, `components/face/pipSize.test.ts`

**Interfaces:**
- Produces:
  - `type Facing = 'user' | 'environment'`, `type Delegate = 'GPU' | 'CPU'`
  - `resolveFacing(requested: Facing, reported: string | undefined): Facing`
  - `describeCameraError(err: unknown): string`
  - `createWithDelegateFallback<T>(create: (d: Delegate) => Promise<T>, onFallback?: (gpuError: unknown) => void): Promise<{ value: T; delegate: Delegate }>`
  - `createFpsMeter(windowMs?: number): { tick(nowMs: number): number }`
  - `pipDims(aspect: number, longSide: number): { w: number; h: number }`

- [ ] **Step 1: Write the failing tests**

`hooks/cameraSupport.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveFacing, describeCameraError, createWithDelegateFallback } from './cameraSupport';

describe('resolveFacing', () => {
  it('trusts what the track reports over what was requested', () => {
    expect(resolveFacing('environment', 'user')).toBe('user'); // one-camera phone: ideal fell back to front
    expect(resolveFacing('user', 'environment')).toBe('environment');
  });
  it('falls back to the request when the browser reports nothing or something odd', () => {
    expect(resolveFacing('environment', undefined)).toBe('environment');
    expect(resolveFacing('user', 'left')).toBe('user');
  });
});

describe('describeCameraError', () => {
  it('explains a denied permission with the iPhone Settings path', () => {
    const m = describeCameraError({ name: 'NotAllowedError' });
    expect(m).toMatch(/permission/i);
    expect(m).toMatch(/Website Settings/);
  });
  it('separates no-camera, busy-camera and insecure-page failures', () => {
    expect(describeCameraError({ name: 'NotFoundError' })).toMatch(/no camera/i);
    expect(describeCameraError({ name: 'NotReadableError' })).toMatch(/busy|in use|unavailable/i);
    expect(describeCameraError(new TypeError('navigator.mediaDevices is undefined'))).toMatch(/https/i);
  });
  it('never throws on junk', () => {
    expect(describeCameraError(null)).toMatch(/camera/i);
    expect(describeCameraError('boom')).toMatch(/camera/i);
    expect(describeCameraError(undefined)).toMatch(/camera/i);
  });
});

describe('createWithDelegateFallback', () => {
  it('uses the GPU when it works', async () => {
    const create = vi.fn(async (d: string) => `made-${d}`);
    const r = await createWithDelegateFallback(create);
    expect(r).toEqual({ value: 'made-GPU', delegate: 'GPU' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('retries on the CPU when GPU creation throws, and reports the GPU error', async () => {
    const gpuErr = new Error('gpu init failed');
    const create = vi.fn(async (d: string) => {
      if (d === 'GPU') throw gpuErr;
      return `made-${d}`;
    });
    const onFallback = vi.fn();
    const r = await createWithDelegateFallback(create, onFallback);
    expect(r).toEqual({ value: 'made-CPU', delegate: 'CPU' });
    expect(onFallback).toHaveBeenCalledWith(gpuErr);
  });
  it('rejects with the CPU error when both fail', async () => {
    const create = async (d: string) => {
      throw new Error(`${d} failed`);
    };
    await expect(createWithDelegateFallback(create)).rejects.toThrow('CPU failed');
  });
});
```

`components/shared/fpsMeter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFpsMeter } from './fpsMeter';

describe('createFpsMeter', () => {
  it('returns 0 until it has two samples', () => {
    const m = createFpsMeter();
    expect(m.tick(0)).toBe(0);
  });
  it('reads ~30 fps for 33.3 ms frames', () => {
    const m = createFpsMeter();
    let fps = 0;
    for (let i = 0; i < 120; i++) fps = m.tick(i * (1000 / 30));
    expect(fps).toBeCloseTo(30, 0);
  });
  it('reads ~60 fps for 16.7 ms frames', () => {
    const m = createFpsMeter();
    let fps = 0;
    for (let i = 0; i < 240; i++) fps = m.tick(i * (1000 / 60));
    expect(fps).toBeCloseTo(60, 0);
  });
  it('forgets frames older than the window', () => {
    const m = createFpsMeter(1000);
    for (let i = 0; i < 60; i++) m.tick(i * 16.7);
    const after = m.tick(10_000); // long stall
    expect(after).toBe(0);
  });
});
```

`components/face/pipSize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pipDims } from './pipSize';

describe('pipDims', () => {
  it('sizes a landscape frame by its long side, aspect-true', () => {
    expect(pipDims(4 / 3, 192)).toEqual({ w: 192, h: 144 });
  });
  it('sizes a portrait phone frame without stretching it', () => {
    expect(pipDims(3 / 4, 192)).toEqual({ w: 144, h: 192 });
  });
  it('handles square and junk aspects', () => {
    expect(pipDims(1, 100)).toEqual({ w: 100, h: 100 });
    expect(pipDims(NaN, 192)).toEqual({ w: 192, h: 144 });
    expect(pipDims(0, 192)).toEqual({ w: 192, h: 144 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run hooks/cameraSupport.test.ts components/shared/fpsMeter.test.ts components/face/pipSize.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementations**

`hooks/cameraSupport.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure camera/tracker support used by useTracker: facing resolution, readable
 * camera errors, and the GPU->CPU landmarker fallback.
 */
export type Facing = 'user' | 'environment';
export type Delegate = 'GPU' | 'CPU';

/** The facing the stream really has. `ideal` constraints can silently return the other camera, so the track's own report wins. */
export function resolveFacing(requested: Facing, reported: string | undefined): Facing {
  if (reported === 'user' || reported === 'environment') return reported;
  return requested;
}

/** One human sentence per getUserMedia failure. Every one of them is retryable. */
export function describeCameraError(err: unknown): string {
  const name = (err as { name?: string } | null | undefined)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow camera access for this site (on iPhone: the aA menu > Website Settings > Camera), then tap Retry.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy or unavailable. Close other apps that use it, then tap Retry.';
    case 'TypeError':
      // navigator.mediaDevices is undefined on non-https pages.
      return 'This browser blocked camera access here. The camera only works on a secure (https) page.';
    default:
      return 'Could not start the camera.';
  }
}

/** Try the GPU delegate, then the CPU one. If both fail the CPU error is what the caller sees. */
export async function createWithDelegateFallback<T>(
  create: (delegate: Delegate) => Promise<T>,
  onFallback?: (gpuError: unknown) => void
): Promise<{ value: T; delegate: Delegate }> {
  try {
    return { value: await create('GPU'), delegate: 'GPU' };
  } catch (gpuError) {
    onFallback?.(gpuError);
    return { value: await create('CPU'), delegate: 'CPU' };
  }
}
```

`components/shared/fpsMeter.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Frames per second over a sliding window. Call tick(now) once per frame.
 */
export function createFpsMeter(windowMs = 1000) {
  const stamps: number[] = [];
  return {
    tick(nowMs: number): number {
      stamps.push(nowMs);
      while (stamps.length > 1 && nowMs - stamps[0] > windowMs) stamps.shift();
      const span = nowMs - stamps[0];
      return span > 0 ? ((stamps.length - 1) * 1000) / span : 0;
    },
  };
}
```

`components/face/pipSize.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Aspect-true picture-in-picture size: the long side is fixed, the short side
 * follows the camera (a phone's portrait frame must not be stretched wide).
 */
export function pipDims(aspect: number, longSide: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return a >= 1 ? { w: longSide, h: Math.round(longSide / a) } : { w: Math.round(longSide * a), h: longSide };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run hooks/cameraSupport.test.ts components/shared/fpsMeter.test.ts components/face/pipSize.test.ts`
Expected: PASS. (If the "forgets frames older than the window" fps case returns a nonzero number, the window loop is wrong: after a 10 s stall only the newest stamp may remain.)

- [ ] **Step 5: Commit**

```bash
git add hooks/cameraSupport.ts hooks/cameraSupport.test.ts components/shared/fpsMeter.ts components/shared/fpsMeter.test.ts components/face/pipSize.ts components/face/pipSize.test.ts
git commit -m "feat(phone): pure helpers for facing, camera errors, delegate fallback, fps and PiP size

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Playwright phone gate (written first; fails until Tasks 4 and 6)

**Files:**
- Create: `scripts/phone-check.mjs`
- Modify: `package.json` (devDependency `playwright`, script `phone-check`)
- Modify: `.gitignore` (add `.proof/`)

**Interfaces:**
- Consumes (added by later tasks): `data-testid="controls-drawer"` on the sidebar, `aria-label="Controls"` on the bottom-bar toggle, `title="Start Recording (With Audio)"` on Record, a "Retry" button in the camera error card, `data-testid="debug-readout"` shown when the URL has `?debug`.
- Produces: `npm run phone-check`, screenshots under `.proof/<date>-phone-port/`.

- [ ] **Step 1: Install Playwright and browsers**

Run (PowerShell): `Push-Location <worktree>; npm install -D playwright; npx playwright install chromium webkit; Pop-Location`
Expected: `playwright` appears in `devDependencies`; both browsers download.

- [ ] **Step 2: Add the script entry and gitignore line**

In `package.json` `scripts` add: `"phone-check": "npm run build && node scripts/phone-check.mjs"`.
Append to `.gitignore`:

```
# Playwright proof captures (scripts/phone-check.mjs)
.proof/
```

- [ ] **Step 3: Write `scripts/phone-check.mjs`**

```js
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
  await page.getByText('Face Puppet').first().click();
  await page.locator('canvas').first().waitFor();
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
```

- [ ] **Step 4: Run it against the current layout and record the expected failures**

Run: `npm run phone-check`
Expected: the script runs to the end and exits 1. It crashes or FAILs at the first phone check (there is no `Controls` button, the stage is ~0px tall). That is the bug this plan fixes. Save the baseline output in your task report. If the crash is a Playwright/selector problem rather than the missing `Controls` button (for example the hub card text), fix the script's selectors now (read `components/DemoHub.tsx`), because the script itself must be sound before Task 4.

- [ ] **Step 5: Commit**

```bash
git add scripts/phone-check.mjs package.json package-lock.json .gitignore
git commit -m "test(phone): Playwright phone/desktop layout gate (fails until the phone layout lands)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Phone layout (stage, bottom bar, drawer, touch targets)

**Files:**
- Create: `hooks/useIsPhone.ts`, `components/PhoneBar.tsx`
- Modify: `App.tsx:33`, `index.css` (currently empty), `components/RecorderControls.tsx`, `components/FaceDemo.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 except that `phone-check` exists.
- Produces: `useIsPhone(): boolean`; `PhoneBar` props (below); `RecorderControls` gains `showTransport?: boolean` (default `true`); sidebar carries `data-testid="controls-drawer"`; bottom bar buttons carry `aria-label` `Record`, `Stop recording`, `Play`/`Pause`/`Resume`, `Stop playback`, `Flip camera`, `Controls`.

- [ ] **Step 1: `App.tsx`: use dynamic viewport height**

Line 33: replace `h-screen` with `h-[100dvh]` (the iOS toolbar no longer overshoots the container).

- [ ] **Step 2: Create `hooks/useIsPhone.ts`**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * True below Tailwind's md breakpoint (768px). Same boundary as the md:
 * classes, so JS and CSS agree on what "phone" means.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767px)';

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
```

- [ ] **Step 3: `index.css`: phone slider styling**

`index.css` is empty and already linked from `index.html`. Give it this content (phone only, so desktop sliders are untouched; explicit track and thumb so iOS Safari draws them, 44px tap height):

```css
/* Sliders on phones: explicit track + thumb (iOS Safari), 44px tap height.
   Scoped to < md so desktop keeps its existing look. */
@media (max-width: 767px) {
  input[type='range'].pl-range {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    width: 100%;
    height: 44px;
    margin: 0;
  }
  input[type='range'].pl-range::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 9999px;
    background: #22242b;
  }
  input[type='range'].pl-range::-moz-range-track {
    height: 6px;
    border-radius: 9999px;
    background: #22242b;
  }
  input[type='range'].pl-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 24px;
    height: 24px;
    margin-top: -9px; /* (6px track - 24px thumb) / 2 */
    border-radius: 9999px;
    background: #ee3b2b;
    border: 0;
  }
  input[type='range'].pl-range::-moz-range-thumb {
    width: 24px;
    height: 24px;
    border-radius: 9999px;
    background: #ee3b2b;
    border: 0;
  }
  input[type='range'].pl-range:disabled {
    opacity: 0.3;
  }
}
```

- [ ] **Step 4: Create `components/PhoneBar.tsx`**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phone-only fixed bottom bar: record/play transport, camera flip, and the
 * Controls drawer toggle. Everything is 44px or larger.
 */
import React from 'react';
import { Circle, Square, Play, Pause, SwitchCamera, SlidersHorizontal } from 'lucide-react';

interface PhoneBarProps {
  isRecording: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  hasData: boolean;
  /** Export in progress or recording: locks everything but Stop. */
  busy: boolean;
  canFlip: boolean;
  controlsOpen: boolean;
  onRecord: () => void;
  onStop: () => void;
  onPlayToggle: () => void;
  onStopPlayback: () => void;
  onFlip: () => void;
  onToggleControls: () => void;
}

const round =
  'w-11 h-11 rounded-full border flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed';

const PhoneBar: React.FC<PhoneBarProps> = (p) => (
  <div className="fixed inset-x-0 bottom-0 z-50 h-16 flex items-center justify-around px-3 bg-[#090A0C]/95 backdrop-blur-md border-t border-white/10 font-mono">
    {!p.isRecording ? (
      <button
        aria-label="Record"
        title="Start Recording (With Audio)"
        onClick={p.onRecord}
        disabled={p.isPlaying || p.busy}
        className={`${round} bg-white/5 border-white/20`}
      >
        <Circle fill="#EE3B2B" className="text-[#EE3B2B]" size={16} />
      </button>
    ) : (
      <button
        aria-label="Stop recording"
        title="Stop Recording"
        onClick={p.onStop}
        className={`${round} bg-[#EE3B2B] border-[#EE3B2B] text-white animate-pulse`}
      >
        <Square fill="currentColor" size={16} />
      </button>
    )}

    <button
      aria-label={p.isPaused ? 'Resume' : p.isPlaying ? 'Pause' : 'Play'}
      onClick={p.onPlayToggle}
      disabled={!p.hasData || p.isRecording || p.busy}
      className={`${round} ${p.isPlaying && !p.isPaused ? 'bg-white text-black border-white' : 'bg-white/5 border-white/20 text-white'}`}
    >
      {p.isPlaying && !p.isPaused ? <Pause fill="currentColor" size={16} /> : <Play fill="currentColor" size={16} className="ml-0.5" />}
    </button>

    {p.isPlaying && (
      <button aria-label="Stop playback" onClick={p.onStopPlayback} disabled={p.busy} className={`${round} bg-white/5 border-white/20 text-white`}>
        <Square fill="currentColor" size={14} />
      </button>
    )}

    {p.canFlip && (
      <button
        aria-label="Flip camera"
        onClick={p.onFlip}
        disabled={p.busy || p.isRecording || p.isPlaying}
        className={`${round} bg-white/5 border-white/20 text-white`}
      >
        <SwitchCamera size={18} />
      </button>
    )}

    <button
      aria-label="Controls"
      aria-expanded={p.controlsOpen}
      onClick={p.onToggleControls}
      className={`${round} ${p.controlsOpen ? 'bg-white text-black border-white' : 'bg-white/5 border-white/20 text-white'}`}
    >
      <SlidersHorizontal size={18} />
    </button>
  </div>
);

export default PhoneBar;
```

If `SwitchCamera` does not exist in `lucide-react@0.436.0`, use `RefreshCw` instead (typecheck will tell you).

- [ ] **Step 5: `components/RecorderControls.tsx`: `showTransport` prop and touch targets**

1. Add to `RecorderControlsProps`: `/** Hide the record/play buttons (the phone bottom bar owns them). Default true. */ showTransport?: boolean;` and destructure `showTransport = true`.
2. Wrap the whole `{/* Main Transport Controls */}` `<div className="flex items-center justify-center gap-4 my-1">...</div>` block in `{showTransport && ( ... )}`.
3. Touch targets (phone only via `md:` reset, desktop sizes unchanged):
   - Export button (`className="flex-1 flex items-center ... py-1.5 px-2 ..."`): append ` min-h-[44px] md:min-h-0`.
   - Chevron button (`className="px-2 border-l ..."`): append ` min-w-[44px] md:min-w-0`.
   - Load JSON button: append ` min-h-[44px] md:min-h-0`.
   - Each export-menu item button (`extraExports` map, the two JSON items and the Audio item): append ` min-h-[44px] md:min-h-0`.
   - Scrubber `<input type="range" ...>`: append `pl-range` to its `className`.
4. Wrapper card `min-w-[280px]` stays.

- [ ] **Step 6: `components/FaceDemo.tsx`: phone layout**

Apply these edits.

a) Imports: add `import { useIsPhone } from '../hooks/useIsPhone';`, `import PhoneBar from './PhoneBar';`, and `X` to the lucide import list.

b) Inside the component, after the existing `useState` block:

```tsx
const isPhone = useIsPhone();
const [controlsOpen, setControlsOpen] = useState(false);
```

c) Build one props object so desktop panel, drawer and bar share it. Just above `return (`:

```tsx
const recorderProps = {
  isRecording: recorder.isRecording,
  isPlaying: recorder.isPlaying,
  isPaused: recorder.isPaused,
  hasData: recorder.hasData,
  frameCount: recorder.frameCount,
  hasAudio: recorder.hasAudio,
  durationMs: recorder.durationMs,
  getPlaybackTimeMs: recorder.getPlaybackTimeMs,
  onScrubStart: recorder.beginScrub,
  onScrub: recorder.scrubTo,
  onScrubEnd: recorder.endScrub,
  onRecord: recorder.startRecording,
  onStop: recorder.stopRecording,
  onPlayToggle: recorder.togglePlayback,
  onStopPlayback: recorder.stopPlayback,
  onExport: recorder.exportData,
  onImport: recorder.loadData,
  // Also locks exports while recording (Stop Recording ignores busy).
  busy: exportState !== null || recorder.isRecording,
  primaryExport: { label: 'Video', onSelect: () => runExport('video') },
  extraExports: [
    { id: 'video', label: 'Video', hint: 'Puppet + your voice, as it plays', onSelect: () => runExport('video') },
    { id: 'pack', label: 'Pack (.zip)', hint: 'Video + recording.json + audio', onSelect: () => runExport('pack') },
  ],
};
```

d) Move the three header toggle buttons (GAZE RAYS, MOCAP DOTS, CAMERA PIP: the `<div className="flex items-center gap-2 pointer-events-auto bg-[#111317]/80 ...">` block) into a constant `displayToggles` defined above `return`. Give each of the three buttons `min-h-[44px] px-3 md:min-h-0 md:px-2` in place of `px-2 py-0.5` (keep `py-0.5` for md: `... md:py-0.5`). Then:
   - In the header, render `{!isPhone && displayToggles}` where the block was.
   - In the header's left cluster: Hub button gets ` min-h-[44px] md:min-h-0`; the title `<span>` gets `hidden md:inline`; the header wrapper gets `p-3 md:p-4` instead of `p-4`.

e) Stage container (`<div className="flex-1 relative bg-[#090A0C] ...">`): change to `flex-1 min-h-0 mb-16 md:mb-0 relative ...` (the bottom bar is fixed and 64px tall; `min-h-0` lets the flex child shrink).

f) Replace the old `{error && <p ...>}` and the initializing block conditions in a later task (Task 6). Here only guard nothing.

g) PiP block: replace with

```tsx
{showPip && (
  <div className="absolute top-16 right-3 md:top-auto md:right-auto md:bottom-8 md:left-8 z-30 pointer-events-auto bg-[#111317]/90 border border-white/15 rounded-lg p-1.5 md:p-2 shadow-2xl backdrop-blur-md">
    <div className="hidden md:flex items-center justify-between text-[10px] font-mono text-gray-400 pb-1.5 mb-1 border-b border-white/10">
      {/* existing INPUT CAM label + Minimize2 button, unchanged */}
    </div>
    <canvas ref={pipCanvasRef} className="rounded bg-black block" />
  </div>
)}
```

(The canvas loses `w-48 h-32`; Task 6 sets its pixel size from the camera aspect. Until then give it `style={{ width: 192, height: 128 }}` so it does not collapse.)

h) Export banner: add `max-w-[92vw] flex-wrap justify-center` to its className.

i) Recorder overlay: replace the `<div className="absolute bottom-8 right-8 pointer-events-auto z-30"><RecorderControls ... /></div>` block with

```tsx
{!isPhone && (
  <div className="absolute bottom-8 right-8 pointer-events-auto z-30">
    <RecorderControls {...recorderProps} />
  </div>
)}
```

j) Sidebar: replace the opening tag `<div className="w-full md:w-80 bg-[#0E1013] border-l border-white/10 p-5 flex flex-col overflow-y-auto shadow-2xl z-20 font-mono">` with

```tsx
<div
  data-testid="controls-drawer"
  className={`bg-[#0E1013] border-white/10 p-5 flex flex-col overflow-y-auto shadow-2xl font-mono
    fixed inset-x-0 bottom-16 z-40 max-h-[65dvh] rounded-t-xl border-t touch-pan-y overscroll-contain transition-transform duration-200
    ${controlsOpen ? 'translate-y-0' : 'translate-y-[130%] pointer-events-none'}
    md:static md:translate-y-0 md:pointer-events-auto md:w-80 md:max-h-none md:rounded-none md:border-t-0 md:border-l md:z-20`}
>
```

and, as the first children inside it (before the existing "EXPRESSIONS & BLENDSHAPES" header), phone-only content:

```tsx
{isPhone && (
  <>
    <div className="flex items-center justify-between mb-3">
      <span className="text-white font-bold text-xs tracking-wider">CONTROLS</span>
      <button aria-label="Close controls" onClick={() => setControlsOpen(false)} className="w-11 h-11 flex items-center justify-center text-gray-300">
        <X size={18} />
      </button>
    </div>
    <div className="mb-4">{displayToggles}</div>
    <div className="mb-4">
      <RecorderControls {...recorderProps} showTransport={false} />
    </div>
  </>
)}
```

k) Add the phone bar as the last child of the root `<div>` (after the sidebar):

```tsx
{isPhone && (
  <PhoneBar
    isRecording={recorder.isRecording}
    isPlaying={recorder.isPlaying}
    isPaused={recorder.isPaused}
    hasData={recorder.hasData}
    busy={exportState !== null || recorder.isRecording}
    canFlip={false /* wired in Task 6 */}
    controlsOpen={controlsOpen}
    onRecord={recorder.startRecording}
    onStop={recorder.stopRecording}
    onPlayToggle={recorder.togglePlayback}
    onStopPlayback={recorder.stopPlayback}
    onFlip={() => {}}
    onToggleControls={() => setControlsOpen((o) => !o)}
  />
)}
```

l) Sliders and mesh buttons: on every `<input type="range" ... className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]" />` in the sidebar (six of them) append ` pl-range` to the className. On the LOW/FULL mesh buttons change `px-2 py-0.5` to `px-3 min-h-[44px] min-w-[56px] md:px-2 md:py-0.5 md:min-h-0 md:min-w-0`.

- [ ] **Step 7: Typecheck and unit tests**

Run: `npm run typecheck; npm test`
Expected: clean; all existing tests plus Tasks 1-2 pass.

- [ ] **Step 8: Run the phone gate**

Run: `npm run phone-check`
Expected: every `chromium-phone` and `webkit-phone` layout check passes (stage tall, Record on-screen >= 44px, no horizontal overflow, drawer opens on-screen, touch targets >= 44px, drawer scrolls by touch) and every `desktop` check passes. Still failing, and expected to until Task 6: `chromium-phone: ?debug readout ...` and `webkit-phone: camera failure shows a Retry button`. If `touch targets` lists offenders, fix each with the `min-h-[44px] md:min-h-0` pattern and re-run. If `drawer scrolls by touch` fails, add `touch-action: pan-y` to the drawer element via `style={{ touchAction: 'pan-y' }}` and re-run. Open `.proof/<date>-phone-port/chromium-phone-bar.png` and `-drawer.png` and confirm they look right (puppet visible above the bar, drawer readable).

- [ ] **Step 9: Commit**

```bash
git add App.tsx index.css hooks/useIsPhone.ts components/PhoneBar.tsx components/RecorderControls.tsx components/FaceDemo.tsx
git commit -m "feat(phone): full-screen stage, bottom bar and Controls drawer at phone width

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `useTracker`: facing, camera restart, CPU fallback, errors, retry, stats

**Files:**
- Modify: `hooks/useTracker.ts` (replace the whole file with the version below)

**Interfaces:**
- Consumes: `mirrorFrame` (Task 1); `Facing`, `Delegate`, `resolveFacing`, `describeCameraError`, `createWithDelegateFallback` (Task 2); `createFpsMeter` (Task 2).
- Produces: `UseTrackerOptions.facing?: Facing` (default `'user'`). Return value gains `retry: () => void`, `activeFacing: Facing`, `canFlip: boolean`, `delegate: Delegate | null`, `statsRef: React.MutableRefObject<{ trackFps: number; delegate: Delegate | null }>`. Existing returns (`frameRef, isReady, error, setSmoothing, setConfidence, setFaceSmoothing`) are unchanged. `frameRef.current` is already normalized (mirrored) when the active camera is the rear one.

Behavior rules the code must keep:
- Changing `facing` restarts only the camera stream, never the models.
- `buildFrame` continuity (`prevFrame`) and the alternate-tick face reuse use the UN-mirrored frame (`rawFrameRef`); only the published `frameRef` is mirrored.
- `video.play()` is called explicitly, not just via `autoPlay`.

- [ ] **Step 1: Replace `hooks/useTracker.ts` with**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * and face tracking (TDD-001 Phases 2-3). Face landmarks run through a One
 * Euro bank owned here; hands keep the slider-driven lerp.
 *
 * Phone support: `facing` picks the front/rear camera (flipping restarts only
 * the stream, never the models); a rear-camera frame is mirrored once here so
 * every consumer sees front-camera semantics; landmarkers try the GPU delegate
 * then the CPU one; camera failures are readable and retryable.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH, FACE_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { createOneEuroBank, faceSmoothingToMinCutoff } from '../components/shared/oneEuro';
import { updateAvgDt, nextFaceAlternating } from '../components/shared/facePolicy';
import { TrackedFrame } from '../components/shared/trackerTypes';
import { mirrorFrame } from '../components/shared/mirrorFrame';
import { createFpsMeter } from '../components/shared/fpsMeter';
import { poke, registerTracker, useIdlePaused } from '../components/shared/idle';
import { Facing, Delegate, resolveFacing, describeCameraError, createWithDelegateFallback } from './cameraSupport';

export interface UseTrackerOptions {
  hands?: boolean;         // default true
  face?: boolean;          // default false
  smoothing?: number;      // 0..1 UI amount for hands, same scale as SmoothingControl
  confidence?: number;     // handedness gate, default 0.5
  faceSmoothing?: number;  // 0..1 UI amount for the face One Euro filter, default 0.5
  facing?: Facing;         // camera to request, default 'user'
}

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true, face = false, facing = 'user' } = options;
  const [isReady, setIsReady] = useState(false);
  const idlePaused = useIdlePaused();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [activeFacing, setActiveFacing] = useState<Facing>(facing);
  const [canFlip, setCanFlip] = useState(false);
  const [delegate, setDelegate] = useState<Delegate | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });
  const faceFilterRef = useRef(createOneEuroBank());
  const facingRef = useRef<Facing>(facing);
  facingRef.current = facing;
  const activeFacingRef = useRef<Facing>(facing);
  const requestedRef = useRef<Facing | null>(null); // facing the open stream was requested with
  const openCameraRef = useRef<(() => void) | null>(null);
  const statsRef = useRef<{ trackFps: number; delegate: Delegate | null }>({ trackFps: 0, delegate: null });

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

  /** Re-run setup after a failure (models or camera). */
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // Published frame: mirrored to the front-camera convention when the rear camera is live.
  const frameRef = useRef<TrackedFrame | null>(null);
  // Un-mirrored frame: what buildFrame's smoothing continuity and the alternate-tick face reuse read.
  const rawFrameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!hands && !face) return;
    // Idle auto-pause: tear down camera + models; the effect re-runs on resume.
    if (idlePaused) {
      setIsReady(false);
      return;
    }
    setError(null);
    const releaseIdle = registerTracker();
    let isActive = true;
    const meter = createFpsMeter();

    const closeAll = () => {
      handLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      faceLandmarkerRef.current = null;
    };

    const stopStream = () => {
      const s = videoRef.current?.srcObject as MediaStream | null | undefined;
      s?.getTracks().forEach((t) => t.stop());
    };

    const setup = async () => {
      // Which model was loading when a throw happened, so the error names the
      // one that actually failed. null = the shared WASM fileset (the message
      // then keeps the old requested-modality wording).
      let loading: 'hand' | 'face' | null = null;
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
        if (!isActive) return;

        let used: Delegate = 'GPU';
        if (hands) {
          loading = 'hand';
          const r = await createWithDelegateFallback(
            (d) =>
              HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: d },
                runningMode: 'VIDEO',
                numHands: 2,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              }),
            (e) => console.warn('Hand GPU delegate failed, using CPU', e)
          );
          handLandmarkerRef.current = r.value;
          if (r.delegate === 'CPU') used = 'CPU';
        }
        if (face && isActive) {
          loading = 'face';
          const r = await createWithDelegateFallback(
            (d) =>
              FaceLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: d },
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
                runningMode: 'VIDEO',
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              }),
            (e) => console.warn('Face GPU delegate failed, using CPU', e)
          );
          faceLandmarkerRef.current = r.value;
          if (r.delegate === 'CPU') used = 'CPU';
        }

        if (!isActive) {
          closeAll();
          return;
        }
        statsRef.current.delegate = used;
        setDelegate(used);
        openCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        setError(`Failed to load ${loading ?? (face && !hands ? 'face' : 'hand')} tracking: ${err.message}. Tap Retry.`);
      }
    };

    /** (Re)open the camera for the current `facing`. Models stay loaded. */
    const openCamera = async () => {
      const wanted = facingRef.current;
      requestedRef.current = wanted;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      setIsReady(false);
      try {
        stopStream(); // iOS will not hand out a second camera while the first is open
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: wanted }, width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const video = videoRef.current;
        if (!video || !isActive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const actual = resolveFacing(wanted, stream.getVideoTracks()[0]?.getSettings().facingMode);
        activeFacingRef.current = actual;
        setActiveFacing(actual);

        video.srcObject = stream;
        video.play().catch((e) => console.warn('video.play() was refused', e));
        video.onloadeddata = () => {
          if (!isActive) return;
          // A new stream: drop smoothing history so the first frame does not lerp from the old camera.
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
          rawFrameRef.current = null;
          frameRef.current = null;
          faceFilterRef.current.reset();
          setIsReady(true);
          tick();
        };

        navigator.mediaDevices
          .enumerateDevices()
          .then((d) => isActive && setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1))
          .catch(() => {});
      } catch (err) {
        console.error('Camera Error:', err);
        if (isActive) setError(describeCameraError(err));
      }
    };
    openCameraRef.current = openCamera;

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
          const prev = rawFrameRef.current;
          const next = buildFrame(prev, handResult, faceResult, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
            faceFilter: faceFilterRef.current,
          });
          if (faceLm && !runFace && prev) next.face = prev.face; // alternate tick: reuse
          rawFrameRef.current = next;
          frameRef.current = activeFacingRef.current === 'environment' ? mirrorFrame(next) : next;
          statsRef.current.trackFps = meter.tick(now);
          if (next.hands.length > 0) poke(); // playing with your hands is using the app
        } catch (e) {
          console.warn('Detection failed this frame', e);
        }
      }

      requestRef.current = requestAnimationFrame(tick);
    };

    setup();

    return () => {
      isActive = false;
      openCameraRef.current = null;
      requestedRef.current = null;
      releaseIdle();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      closeAll();
      stopStream();
    };
  }, [videoRef, hands, face, idlePaused, attempt]);

  // Flipping the camera reopens the stream only; the models stay loaded.
  useEffect(() => {
    if (requestedRef.current !== null && requestedRef.current !== facing) openCameraRef.current?.();
  }, [facing]);

  return { frameRef, isReady, error, retry, activeFacing, canFlip, delegate, statsRef, setSmoothing, setConfidence, setFaceSmoothing };
}
```

- [ ] **Step 2: Typecheck and tests**

Run: `npm run typecheck; npm test`
Expected: clean and all green. `hooks/useMediaPipe.ts` still compiles (it only reads fields that existed).

- [ ] **Step 3: Phone gate**

Run: `npm run phone-check`
Expected: `chromium-phone: hidden camera video is playing` passes (explicit `play()`); layout checks still pass. The `?debug` readout and Retry checks stay failing until Task 6.

- [ ] **Step 4: Commit**

```bash
git add hooks/useTracker.ts
git commit -m "feat(phone): useTracker facing option, stream-only camera flip, CPU fallback, readable errors, retry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire camera UI into Face Puppet (flip, errors, PiP, notice, debug readout)

**Files:**
- Create: `components/DebugReadout.tsx`
- Modify: `components/FaceDemo.tsx`

**Interfaces:**
- Consumes: `useTracker` return values from Task 5; `pipDims` (Task 2); `createFpsMeter` (Task 2); `PhoneBar` props (Task 4).
- Produces: `data-testid="debug-readout"` element when the URL contains `?debug`; a "Retry" button in the error card; the flip button live on phones with two cameras.

- [ ] **Step 1: Create `components/DebugReadout.tsx`**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ?debug overlay: one line of live numbers (render fps, tracker fps, delegate,
 * camera size and facing) so real-phone performance can be reported without dev tools.
 */
import React, { useEffect, useState } from 'react';

const DebugReadout: React.FC<{ getLine: () => string }> = ({ getLine }) => {
  const [line, setLine] = useState('');
  useEffect(() => {
    const id = setInterval(() => setLine(getLine()), 500);
    return () => clearInterval(id);
  }, [getLine]);
  return (
    <div
      data-testid="debug-readout"
      className="absolute bottom-2 left-2 z-50 pointer-events-none bg-black/70 text-[#7CFFB2] font-mono text-[10px] px-2 py-1 rounded"
    >
      {line}
    </div>
  );
};

export default DebugReadout;
```

- [ ] **Step 2: `components/FaceDemo.tsx` edits**

a) Imports: `import { useMemo, useCallback } from 'react'` merged into the existing React import; add `import DebugReadout from './DebugReadout';`, `import { pipDims } from './face/pipSize';`, `import { createFpsMeter } from './shared/fpsMeter';`, `import { Facing } from '../hooks/cameraSupport';`.

b) Replace the `useTracker(...)` line with:

```tsx
const [facing, setFacing] = useState<Facing>('user');
const { frameRef, isReady: isCameraReady, error, retry, activeFacing, canFlip, delegate, statsRef } =
  useTracker(videoRef, { hands: true, face: true, faceSmoothing, facing });
```

c) Refs read by the render loop (the loop's effect does not re-run on these), placed next to `videoAspectRef`:

```tsx
const activeFacingRef = useRef<Facing>('user');
activeFacingRef.current = activeFacing;
const isPhoneRef = useRef(false);
isPhoneRef.current = isPhone;
const renderMeterRef = useRef(createFpsMeter());
const renderFpsRef = useRef(0);
```

(`isPhone` is declared in Task 4; put these lines after it.)

d) Debug readout (declare after the refs):

```tsx
const debug = useMemo(() => new URLSearchParams(window.location.search).has('debug'), []);
const debugLine = useCallback(() => {
  const v = videoRef.current;
  return [
    `render ${renderFpsRef.current.toFixed(0)} fps`,
    `track ${statsRef.current.trackFps.toFixed(0)} fps`,
    statsRef.current.delegate ?? 'no-delegate',
    v ? `${v.videoWidth}x${v.videoHeight}` : 'no-video',
    activeFacingRef.current === 'environment' ? 'rear' : 'front',
    `dpr ${window.devicePixelRatio}`,
  ].join(' | ');
}, [statsRef]);
```

e) In the render loop, at the top of `render` (before `if (canvas && ctx)`): `renderFpsRef.current = renderMeterRef.current.tick(performance.now());`

f) Replace the PiP drawing block (`if (showPip && pipCanvasRef.current && pipCtx) { ... }`) with:

```tsx
if (showPip && pipCanvasRef.current && pipCtx) {
    const pipC = pipCanvasRef.current;
    const { w: pw, h: ph } = pipDims(videoAspectRef.current, isPhoneRef.current ? 112 : 192);
    if (pipC.width !== pw || pipC.height !== ph) {
        pipC.width = pw;
        pipC.height = ph;
        pipC.style.width = `${pw}px`;
        pipC.style.height = `${ph}px`;
    }
    pipCtx.save();
    // The front camera is shown as a mirror; the rear camera as a window.
    if (activeFacingRef.current === 'user') {
        pipCtx.scale(-1, 1);
        pipCtx.translate(-pw, 0);
    }
    pipCtx.drawImage(video, 0, 0, pw, ph);
    pipCtx.restore();
}
```

Remove the temporary `style={{ width: 192, height: 128 }}` from the PiP `<canvas>` added in Task 4.

g) Error card, replacing `{error && <p className="text-[#EE3B2B] font-mono text-xs">{error}</p>}`:

```tsx
{error && (
    <div className="absolute inset-x-4 top-20 md:top-16 z-40 mx-auto max-w-md pointer-events-auto flex flex-col items-center gap-3 bg-[#111317]/95 border border-[#EE3B2B]/40 rounded-lg p-4 text-center">
        <p className="text-[#EE3B2B] font-mono text-xs leading-relaxed">{error}</p>
        <button onClick={retry} className="min-h-[44px] px-6 rounded-lg bg-[#EE3B2B] text-white font-mono text-xs font-bold">Retry</button>
    </div>
)}
{!error && delegate === 'CPU' && (
    <p className="absolute top-14 left-1/2 -translate-x-1/2 z-30 font-mono text-[10px] text-amber-300/80 text-center px-4">
        Compatibility mode (CPU tracking): it may run slower.
    </p>
)}
```

and change the initializing block's condition from `!isCameraReady && !recorder.isPlaying` to `!isCameraReady && !recorder.isPlaying && !error`.

h) Render the readout as the last child of the stage container: `{debug && <DebugReadout getLine={debugLine} />}` (on a phone it sits above the bottom bar because the stage has `mb-16`).

i) Flip wiring in the `PhoneBar` element: `canFlip={canFlip}` and `onFlip={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}` (replacing the Task 4 placeholders).

- [ ] **Step 3: Typecheck and tests**

Run: `npm run typecheck; npm test`
Expected: clean; all green.

- [ ] **Step 4: Phone gate: everything passes**

Run: `npm run phone-check`
Expected: all checks pass, including `?debug readout shows a live tracker fps` and `webkit-phone: camera failure shows a Retry button`. Then check flip in Chromium with two fake cameras: temporarily launch Chromium with `--use-fake-device-for-media-stream=device-count=2` (if this flag form is unsupported in the installed Chromium, note that in your report and skip: flip is then verified on the real phone), open Face Puppet on the phone viewport, and use a throwaway Playwright snippet (do not commit it) to assert the `Flip camera` button appears and the `?debug` readout changes from `front` to `rear` (or stays `front` if the fake device does not report `facingMode`: that is `resolveFacing` doing its job, not a failure).

- [ ] **Step 5: Screenshot proof**

The gate wrote `.proof/<date>-phone-port/*.png`. Open `chromium-phone-bar.png`, `chromium-phone-drawer.png`, `webkit-phone-bar.png` (the error card should be visible there) and `desktop.png`; confirm each looks right and that the desktop shot matches the pre-change layout (sidebar right, recorder bottom-right, PiP bottom-left).

- [ ] **Step 6: Commit**

```bash
git add components/DebugReadout.tsx components/FaceDemo.tsx
git commit -m "feat(phone): camera flip, retryable errors, aspect-true PiP, CPU notice and ?debug readout in Face Puppet

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, full gate, push, deploy, proof

**Files:**
- Modify: `NORTH_STAR.md:61`, `docs/PHONE_PORT.md`, `HANDOFF.md`

- [ ] **Step 1: North Star non-goal**

Replace the line `- Not mobile. Desktop Chrome with a webcam is the target.` with:
`- Phones are supported for Face Puppet only (live view, front and rear camera, recording). Phone video export and the other four demos are unverified on phones (see docs/PHONE_PORT.md). Desktop Chrome with a webcam stays the primary target.`

- [ ] **Step 2: `docs/PHONE_PORT.md` status**

Change the header status line to: `Status: items 1 and 2 BUILT 2026-09-29 (layout, camera flip, CPU fallback, errors, ?debug readout); NOT yet verified on a real phone. Items 3 and 4 not built.` Under each of items 1 and 2 add a `Built:` line naming the files (`components/PhoneBar.tsx`, `hooks/useIsPhone.ts`, `hooks/useTracker.ts`, `hooks/cameraSupport.ts`, `components/shared/mirrorFrame.ts`, `scripts/phone-check.mjs`). Add a short "Host-verification checklist (real phone)" section:
1. Open `https://mocap.graysonchalmers.com/?debug` on the iPhone, open Face Puppet, allow the camera. Report the debug line (render fps | track fps | delegate | size | front/rear) after 10 s of moving your face, and again with hands in view.
2. Tap Controls: sliders draggable, drawer scrolls, Export/Load reachable.
3. Flip camera to rear and back; confirm the puppet is not mirrored on rear, and that hands stay on the right sides.
4. Deny the camera once (aA > Website Settings > Camera > Deny), reload, confirm the message and Retry after re-allowing.
5. Rotate to landscape: nothing unreachable.
6. Does the delegate say GPU or CPU? Any thermal or memory crash within 2 minutes?
Also record the residual risk: a GPU delegate that constructs fine but throws at the first `detectForVideo` is not handled (only construction failure falls back to CPU).

- [ ] **Step 3: Full gate**

Run (PowerShell): `Push-Location C:\Projects-local\Tool-PuppeteerLab\.claude\worktrees\puppeteer-lab-mobile-ecc9b4; npm run typecheck; npm test; npm run smoke; npm run phone-check; Pop-Location`
Expected: typecheck clean, all tests pass (175 prior + the new ones), smoke OK, phone-check all PASS. Paste the phone-check output in the report.

- [ ] **Step 4: Commit docs and push the branch**

```bash
git add NORTH_STAR.md docs/PHONE_PORT.md
git commit -m "docs(phone): phone port items 1-2 built; North Star non-goal narrowed; host checklist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
```

Do NOT merge or push to `main` here; ask Grayson first (report the branch name).

- [ ] **Step 5: Deploy to mocap (authorized by Grayson: "deploy after the gate passes")**

Invoke the `go-live` skill and follow the mocap redeploy record in `C:\Projects-local\_agent-commons\state\apps-01-server.md` (search "mocap"): build, secret gate, badge inject into `dist/index.html`, `scp` to `/var/www/mocap`. After deploy, confirm `https://mocap.graysonchalmers.com/` returns 200 and the served bundle contains the new build stamp from `npm run stamp`. Do not deploy if any Step 3 check failed.

- [ ] **Step 6: Proof for Grayson**

`SendUserFile` the Playwright screenshots (`chromium-phone-bar.png`, `chromium-phone-drawer.png`, `webkit-phone-bar.png`, `desktop.png` from `.proof/<date>-phone-port/`) with the live URL `https://mocap.graysonchalmers.com/?debug`, and the checklist from Step 2 so Grayson can report the phone's debug line. State plainly that the camera path, GPU delegate, memory and rear-camera behavior are unverified until then.

- [ ] **Step 7: Wrap-up**

Run the `wrap-up` skill (HANDOFF.md snapshot, handoff-log entry, `_agent-commons\log` entry). The next step in HANDOFF is Grayson's on-phone numbers, then decide hands-off/LOW-mesh defaults for phones.

---

## Self-Review

1. **Spec coverage:** Q1 Face-only -> only `FaceDemo` verified, shared `useTracker`/`App` fixed (Tasks 4-6). Q2/Q3 rear camera + normalize at tracker output -> Tasks 1, 5, 6 (PiP conditional mirror in 6f). Q4 layout -> Task 4. Q5 test/deploy -> Tasks 3, 7. Q6 measure-first + CPU fallback + `?debug` -> Tasks 5, 6. PHONE_PORT item 1 sub-points: `h-dvh` (4.1), 44px targets (4.5/4.6), hidden video + explicit `play()` (5), recorder collision with PiP (4.6g/i). Item 2: facingMode option + flip (5, 6), GPU->CPU (2, 5), permission errors (2, 5, 6g), orientation (self-heals per frame; asserted only by layout at 390x844; landscape covered by the checklist), mirroring (1, 5, 6f), portrait PiP (2, 6f). NORTH_STAR line (7.1).
2. **Placeholder scan:** none; the only forward reference is Task 4's `canFlip={false}` / `onFlip={() => {}}`, replaced explicitly in Task 6i.
3. **Type consistency:** `Facing`, `Delegate` defined in `hooks/cameraSupport.ts` (Task 2) and imported in Tasks 5 and 6; `pipDims(aspect, longSide)` matches its use; `mirrorFrame(f)` matches; `PhoneBar` props in Task 4 match the element in 4.6k and the Task 6i edits; `statsRef` shape matches `DebugReadout` usage; `recorderProps` includes `busy`, `primaryExport`, `extraExports` as `RecorderControls` expects.
4. **Review Focus:** items 1-4 map to pure tests in Tasks 1-2; item 5 maps to the CDP touch-scroll check in Task 3 (passing in Task 4).
