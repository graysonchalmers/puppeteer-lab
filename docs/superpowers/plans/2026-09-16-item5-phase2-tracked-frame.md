# Item 5 Phase 2: `TrackedFrame` + `buildFrame` + `useTracker` (hands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one serializable `TrackedFrame` shape for hand tracking, a pure `buildFrame` that produces it, and a `useTracker` hook that owns the camera/detection loop — then turn `useMediaPipe` into a thin adapter over it so every existing consumer keeps working unchanged.

**Architecture:** `useTracker` runs the `getUserMedia` + `HandLandmarker` + rAF loop (lifted from today's `useMediaPipe`) and calls the pure `buildFrame` each tick to publish `frameRef.current`. `useMediaPipe` becomes an adapter: it calls `useTracker({ hands: true })` and, in its own small rAF loop, reads `frameRef.current` each tick to rebuild `handPositionsRef` and `lastResultsRef` in their exact original shapes. No consumer file changes in this phase — that is Phase 4, all at once, per TDD-001's adapter-drift risk note.

**Tech Stack:** React 19, TypeScript, `@mediapipe/tasks-vision` (`HandLandmarker`), `three` (`THREE.Vector3`, kept only at the adapter boundary), Vitest.

**Spec:** [docs/tdd/TDD-001-tracker-core.md](../../tdd/TDD-001-tracker-core.md) (Design > Types, Design > Hook, Design > Migration adapter, Phases table — Phase 2 row). Also see [PLANNING.md](../../../PLANNING.md) item 5.

## Global Constraints

- Every file's license header is exactly:
  ```
  /**
   * @license
   * SPDX-License-Identifier: Apache-2.0
   */
  ```
- `TrackedFrame` and everything inside it (`TrackedHand`, `TrackedFace`, `Vec3`, `Landmark`) is plain, serializable data — never `THREE.Vector3`. Consumers that want a `THREE.Vector3` wrap at their own edge (per TDD-001 "Why plain `Vec3`").
- Smoothing and hand-identity pairing is always **by side** (`'left' | 'right'`, from `resolveHands`), never by MediaPipe's array index — index order can swap between frames.
- **Adapter-first rule (load-bearing):** no consumer file (`AirCanvas.tsx`, `HandTelemetry.tsx`, `RhythmGame.tsx`, `MotionRecorder.tsx`, `FaceDemo.tsx`, `WebcamPreview.tsx`, `GameScene.tsx`, `InteractiveObject.tsx`) changes in this phase. `useMediaPipe`'s public return shape (`{ isCameraReady, handPositionsRef, lastResultsRef, error, setSmoothingFactor }`) and `mapHandToWorld`'s import path from `hooks/useMediaPipe` are both preserved exactly.
- Gate for this phase, run after every task and again at the end: `npm run typecheck && npm test && npm run build && npm run smoke` — all four green. There is no camera in this environment, so the phase's host-verification line in `HANDOFF.md` records **code-complete, camera-unverified**, matching the existing pattern for roadmap items 1-4 and 6 (do not skip or fake it — record the gap honestly).
- Commit after every task (small, focused commits), following this repo's direct-to-main convention — no feature branch.

---

### Task 1: Extract `mapHandToWorld` to break a circular import

**Files:**
- Create: `components/shared/mapHandToWorld.ts`
- Create: `components/shared/mapHandToWorld.test.ts`
- Modify: `hooks/useMediaPipe.ts:1-35` (delete the local definition, re-export from the new location)

**Interfaces:**
- Consumes: nothing new.
- Produces: `mapHandToWorld(x: number, y: number, z?: number): THREE.Vector3`, importable from `components/shared/mapHandToWorld` (new canonical home) and still from `hooks/useMediaPipe` (re-export, so `components/telemetry/InteractiveObject.tsx:9`'s existing `import { mapHandToWorld } from '../../hooks/useMediaPipe'` needs no change).

**Why this task exists:** Task 4's `useTracker` hook will import the pure `buildFrame` (Task 3), which needs `mapHandToWorld`. If `mapHandToWorld` stays in `hooks/useMediaPipe.ts`, and `hooks/useMediaPipe.ts` becomes an adapter that imports `useTracker` (Task 5), you get a cycle: `useMediaPipe.ts` → `useTracker.ts` → `buildFrame.ts` → `useMediaPipe.ts`. Moving the function to `components/shared/` breaks the cycle; re-exporting it from `useMediaPipe.ts` keeps every existing import path working.

- [ ] **Step 1: Write the failing test**

Create `components/shared/mapHandToWorld.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { mapHandToWorld } from './mapHandToWorld';

describe('mapHandToWorld', () => {
  it('maps normalized center with zero depth to the Y-offset baseline', () => {
    const v = mapHandToWorld(0.5, 0.5, 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0.8);
    expect(v.z).toBeCloseTo(0);
  });

  it('maps the top-left normalized corner with positive depth', () => {
    const v = mapHandToWorld(0, 0, 1);
    expect(v.x).toBeCloseTo(2.5);
    expect(v.y).toBeCloseTo(2.55);
    expect(v.z).toBeCloseTo(8);
  });

  it('clamps Y to a 0.1 floor instead of going negative', () => {
    const v = mapHandToWorld(1, 1, 1);
    expect(v.x).toBeCloseTo(-2.5);
    expect(v.y).toBeCloseTo(0.1);
    expect(v.z).toBeCloseTo(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mapHandToWorld`
Expected: FAIL — `components/shared/mapHandToWorld.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `components/shared/mapHandToWorld.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps 2D normalized hand-landmark coordinates (plus a depth proxy) to the
 * 3D game-world space used by Tempo Strike, Motion Recorder, and the Hand
 * Telemetry hologram cube. Extracted out of useMediaPipe.ts (TDD-001 Phase 2)
 * so buildFrame can call it without hooks/useMediaPipe.ts (the adapter,
 * which imports useTracker, which imports buildFrame) forming a cycle back
 * through this function's old home.
 */
import * as THREE from 'three';

export const mapHandToWorld = (x: number, y: number, z: number = 0): THREE.Vector3 => {
  const GAME_X_RANGE = 5;
  const GAME_Y_RANGE = 3.5;
  const Y_OFFSET = 0.8;

  const worldX = (0.5 - x) * GAME_X_RANGE;
  const worldY = (1.0 - y) * GAME_Y_RANGE - (GAME_Y_RANGE / 2) + Y_OFFSET;
  const worldZ = z * 8;

  return new THREE.Vector3(worldX, Math.max(0.1, worldY), worldZ);
};
```

Modify `hooks/useMediaPipe.ts`: delete lines 13-35 (the `mapHandToWorld` definition and its comment) and replace with a re-export. **Keep the existing `import * as THREE from 'three';` line** — the rest of this file (everything from line 37 down, e.g. `handPositionsRef`'s `THREE.Vector3` fields) is untouched until Task 5 rewrites it, and still needs that import:

```ts
export { mapHandToWorld } from '../components/shared/mapHandToWorld';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mapHandToWorld`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build && npm run smoke`
Expected: all green (this only moved a pure function and re-exported it; no consumer import changed).

```bash
git add components/shared/mapHandToWorld.ts components/shared/mapHandToWorld.test.ts hooks/useMediaPipe.ts
git commit -m "Extract mapHandToWorld to components/shared (item 5 phase 2, task 1)"
```

---

### Task 2: `TrackedFrame` types

**Files:**
- Create: `components/shared/trackerTypes.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Landmark`, `Vec3`, `TrackedHand`, `TrackedFace`, `TrackedFrame` — imported by `buildFrame.ts` (Task 3) and `useTracker.ts` (Task 4).

No test: this file is type declarations only, no runtime logic to pin.

- [ ] **Step 1: Write the file**

Create `components/shared/trackerTypes.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One frame shape for hand (and, from Phase 3, face) tracking (TDD-001).
 * Plain, serializable data — no THREE.Vector3 — so the recorder can store
 * frames verbatim and consumers wrap at the edge if they want a THREE type.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackedHand {
  side: 'left' | 'right';
  score: number;             // handedness confidence, 0..1
  landmarks: Landmark[];     // 21, normalized image space, SMOOTHED (what demos draw)
  rawLandmarks: Landmark[];  // 21, exactly as MediaPipe returned them
  world: Vec3[];             // 21, world units via mapHandToWorld with this hand's depth
  tip: Vec3;                 // world[8]; the value Tempo Strike and Motion Recorder use today
  velocity: Vec3;            // world units per second, from the smoothed tip
  pinch: number;             // thumb tip to index tip distance in NORMALIZED units (not pixels)
}

export interface TrackedFace {
  landmarks: Landmark[];                 // 478
  blendshapes: Record<string, number>;   // ARKit-style scores by name
  transform: number[] | null;            // 16 floats, column-major, from facialTransformationMatrixes
}

export interface TrackedFrame {
  t: number;                 // ms, performance.now() at capture
  dt: number;                // ms since the previous frame (0 on the first)
  hands: TrackedHand[];      // 0..2, after confidence gating
  left: TrackedHand | null;
  right: TrackedHand | null;
  face: TrackedFace | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (new file isn't imported by anything yet, so this just confirms it parses).

- [ ] **Step 3: Commit**

```bash
git add components/shared/trackerTypes.ts
git commit -m "Add TrackedFrame types (item 5 phase 2, task 2)"
```

---

### Task 3: `buildFrame` (pure, tested)

**Files:**
- Create: `components/shared/buildFrame.ts`
- Create: `components/shared/buildFrame.test.ts`

**Interfaces:**
- Consumes: `resolveHands` (`components/shared/resolveHands.ts`, unchanged), `smoothLandmarks` (`components/shared/smoothing.ts`, unchanged), `mapHandToWorld` (`components/shared/mapHandToWorld.ts`, Task 1), `Landmark`/`Vec3`/`TrackedHand`/`TrackedFace`/`TrackedFrame` (`components/shared/trackerTypes.ts`, Task 2).
- Produces: `buildFrame(prevFrame, handResult, faceResult, now, options): TrackedFrame`, `RawHandResult`, `RawFaceResult`, `BuildFrameOptions` — imported by `useTracker.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `components/shared/buildFrame.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildFrame, RawHandResult } from './buildFrame';
import { TrackedFrame } from './trackerTypes';

const landmarks21 = (fill: (i: number) => { x: number; y: number; z: number }) =>
  Array.from({ length: 21 }, (_, i) => fill(i));

// Wrist (0) and middle-MCP (9) far apart -> a large depth proxy, easy to distinguish from baseline.
const handAt = (originX: number, originY: number): { x: number; y: number; z: number }[] =>
  landmarks21((i) => {
    if (i === 0) return { x: originX, y: originY, z: 0 };
    if (i === 9) return { x: originX, y: originY + 0.3, z: 0 };
    if (i === 4) return { x: originX, y: originY, z: 0 }; // thumb tip
    if (i === 8) return { x: originX + 0.05, y: originY, z: 0 }; // index tip, 0.05 normalized away from thumb
    return { x: originX, y: originY, z: 0 };
  });

const rightHandedness = [{ categoryName: 'Right', score: 0.95 }];
const leftHandedness = [{ categoryName: 'Left', score: 0.95 }];

describe('buildFrame', () => {
  it('assigns left and right from handedness and leaves the other side null', () => {
    const handResult: RawHandResult = {
      landmarks: [handAt(0.6, 0.5)],
      handedness: [rightHandedness],
    };
    const frame = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(frame.right).not.toBeNull();
    expect(frame.left).toBeNull();
    expect(frame.hands).toHaveLength(1);
    expect(frame.right!.side).toBe('right');
  });

  it('computes dt from consecutive timestamps, and 0 on the first frame', () => {
    const handResult: RawHandResult = { landmarks: [handAt(0.6, 0.5)], handedness: [rightHandedness] };
    const first = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(first.dt).toBe(0);
    expect(first.t).toBe(1000);

    const second = buildFrame(first, handResult, null, 1033, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(second.dt).toBe(33);
  });

  it('pairs smoothing continuity by side across an index swap between frames', () => {
    // Frame 1: index 0 = Left, index 1 = Right.
    const frame1Result: RawHandResult = {
      landmarks: [handAt(0.3, 0.5), handAt(0.7, 0.5)],
      handedness: [leftHandedness, rightHandedness],
    };
    const frame1 = buildFrame(null, frame1Result, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });

    // Frame 2: MediaPipe reordered its array -- index 0 is now Right, index 1 is now Left.
    // Heavy smoothing (alpha 0.1) should pull each side's landmarks toward ITS OWN previous
    // frame, not toward whatever sat at the same array index last time.
    const rightMoved = handAt(0.75, 0.5); // right hand moved a little
    const leftMoved = handAt(0.32, 0.5); // left hand moved a little
    const frame2Result: RawHandResult = {
      landmarks: [rightMoved, leftMoved],
      handedness: [rightHandedness, leftHandedness],
    };
    const frame2 = buildFrame(frame1, frame2Result, null, 1016, { confidence: 0.5, smoothingAlpha: 0.1 });

    // Right hand's smoothed landmark[0].x should sit between frame1.right's x (0.7) and the new
    // raw x (0.75) -- i.e. pulled toward frame1's RIGHT hand, not frame1's index-0 (which was left, x=0.3).
    expect(frame2.right!.landmarks[0].x).toBeGreaterThan(0.7);
    expect(frame2.right!.landmarks[0].x).toBeLessThan(0.75);

    expect(frame2.left!.landmarks[0].x).toBeGreaterThan(0.3);
    expect(frame2.left!.landmarks[0].x).toBeLessThan(0.32);
  });

  it('computes pinch in normalized units matching the known thumb/index gap', () => {
    const handResult: RawHandResult = { landmarks: [handAt(0.6, 0.5)], handedness: [rightHandedness] };
    const frame = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    // handAt() places thumb (4) and index (8) exactly 0.05 apart on X, 0 apart on Y.
    expect(frame.right!.pinch).toBeCloseTo(0.05, 5);
  });

  it('returns face null when no face result is passed', () => {
    const handResult: RawHandResult = { landmarks: [handAt(0.6, 0.5)], handedness: [rightHandedness] };
    const frame = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(frame.face).toBeNull();
  });

  it('builds face blendshapes and transform when a face result is passed', () => {
    const frame: TrackedFrame = buildFrame(
      null,
      null,
      {
        faceLandmarks: [landmarks21((i) => ({ x: i / 21, y: 0.5, z: 0 }))],
        faceBlendshapes: [{ categories: [{ categoryName: 'mouthSmileLeft', score: 0.8 }] }],
        facialTransformationMatrixes: [{ data: Array.from({ length: 16 }, (_, i) => i) }],
      },
      1000,
      { confidence: 0.5, smoothingAlpha: 1.0 }
    );
    expect(frame.face).not.toBeNull();
    expect(frame.face!.blendshapes.mouthSmileLeft).toBeCloseTo(0.8);
    expect(frame.face!.transform).toHaveLength(16);
  });

  it('returns no hands when handResult is null (face-only tick)', () => {
    const frame = buildFrame(null, null, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(frame.hands).toHaveLength(0);
    expect(frame.left).toBeNull();
    expect(frame.right).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- buildFrame`
Expected: FAIL — `components/shared/buildFrame.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `components/shared/buildFrame.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure frame builder: raw MediaPipe hand/face results in, one TrackedFrame
 * out. Pairs hand identity and smoothing continuity by side (left/right),
 * never by MediaPipe's array index, since MediaPipe can reorder hands
 * between frames (TDD-001).
 */
import { Landmark, Vec3, TrackedHand, TrackedFace, TrackedFrame } from './trackerTypes';
import { resolveHands } from './resolveHands';
import { smoothLandmarks } from './smoothing';
import { mapHandToWorld } from './mapHandToWorld';

export interface RawHandResult {
  landmarks: Landmark[][];
  handedness: { categoryName: string; score: number }[][];
}

export interface RawFaceResult {
  faceLandmarks: Landmark[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { data: number[] | Float32Array }[];
}

export interface BuildFrameOptions {
  confidence: number;
  smoothingAlpha: number;
}

// Wrist (0) to middle-finger-MCP (9) distance at a "neutral" hand distance
// from the camera, in normalized coords. Same baseline useMediaPipe used.
const HAND_DEPTH_BASELINE = 0.12;

function buildTrackedHand(
  side: 'left' | 'right',
  rawLandmarks: Landmark[],
  score: number,
  prevHand: TrackedHand | null,
  dtSeconds: number,
  smoothingAlpha: number
): TrackedHand {
  const landmarks = smoothLandmarks(prevHand?.landmarks ?? null, rawLandmarks, smoothingAlpha) as Landmark[];

  const wrist = landmarks[0];
  const midMcp = landmarks[9];
  const depthOffset = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y) - HAND_DEPTH_BASELINE;

  const world: Vec3[] = landmarks.map((lm) => {
    const w = mapHandToWorld(lm.x, lm.y, depthOffset);
    return { x: w.x, y: w.y, z: w.z };
  });

  const tip = world[8];
  const velocity: Vec3 =
    prevHand && dtSeconds > 0.001
      ? {
          x: (tip.x - prevHand.tip.x) / dtSeconds,
          y: (tip.y - prevHand.tip.y) / dtSeconds,
          z: (tip.z - prevHand.tip.z) / dtSeconds,
        }
      : { x: 0, y: 0, z: 0 };

  const pinch = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);

  return { side, score, landmarks, rawLandmarks, world, tip, velocity, pinch };
}

function buildTrackedFace(faceResult: RawFaceResult): TrackedFace | null {
  if (!faceResult.faceLandmarks || faceResult.faceLandmarks.length === 0) return null;

  const blendshapes: Record<string, number> = {};
  for (const cat of faceResult.faceBlendshapes?.[0]?.categories ?? []) {
    blendshapes[cat.categoryName] = cat.score;
  }

  const rawMatrix = faceResult.facialTransformationMatrixes?.[0]?.data ?? null;
  const transform = rawMatrix ? Array.from(rawMatrix) : null;

  return { landmarks: faceResult.faceLandmarks[0], blendshapes, transform };
}

export function buildFrame(
  prevFrame: TrackedFrame | null,
  handResult: RawHandResult | null,
  faceResult: RawFaceResult | null,
  now: number,
  options: BuildFrameOptions
): TrackedFrame {
  const dt = prevFrame ? now - prevFrame.t : 0;
  const dtSeconds = dt / 1000;

  const resolved = resolveHands(
    handResult?.landmarks ?? [],
    handResult?.handedness ?? [],
    options.confidence,
    false
  );

  const hands: TrackedHand[] = [];
  let left: TrackedHand | null = null;
  let right: TrackedHand | null = null;

  for (const h of resolved.hands) {
    const side: 'left' | 'right' = h.isRight ? 'right' : 'left';
    const prevHand = prevFrame ? (side === 'right' ? prevFrame.right : prevFrame.left) : null;
    const trackedHand = buildTrackedHand(side, h.landmarks, h.score, prevHand, dtSeconds, options.smoothingAlpha);
    hands.push(trackedHand);
    if (side === 'right') right = trackedHand;
    else left = trackedHand;
  }

  const face = faceResult ? buildTrackedFace(faceResult) : null;

  return { t: now, dt, hands, left, right, face };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- buildFrame`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build && npm run smoke`
Expected: all green.

```bash
git add components/shared/buildFrame.ts components/shared/buildFrame.test.ts
git commit -m "Add pure buildFrame: raw MediaPipe results -> TrackedFrame (item 5 phase 2, task 3)"
```

---

### Task 4: `useTracker` hook (hands only)

**Files:**
- Create: `hooks/useTracker.ts`

**Interfaces:**
- Consumes: `buildFrame`, `RawHandResult` (`components/shared/buildFrame.ts`, Task 3), `TrackedFrame` (`components/shared/trackerTypes.ts`, Task 2), `smoothingToLerp` (`components/shared/smoothing.ts`, unchanged), `MEDIAPIPE_WASM_PATH`/`HAND_MODEL_PATH` (`hooks/mediapipeAssets.ts`, unchanged), `HandLandmarker`/`FilesetResolver` from `@mediapipe/tasks-vision`.
- Produces: `useTracker(videoRef, options): { frameRef: React.RefObject<TrackedFrame | null>; isReady: boolean; error: string | null; setSmoothing: (amount01: number) => void; setConfidence: (threshold: number) => void }`, `UseTrackerOptions` — imported by `hooks/useMediaPipe.ts` (Task 5).

No new test file: this hook is the camera/rAF plumbing lifted near-verbatim from `useMediaPipe.ts`, and it has no browser/camera in this environment to exercise. Its correctness is proven by Task 5's adapter reproducing `useMediaPipe`'s exact existing behavior on top of it, gated by the full automated suite plus the honest camera-unverified HANDOFF.md line (Task 6).

- [ ] **Step 1: Write the implementation**

Create `hooks/useTracker.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * tracking. Phase 2 only wires the hands-only path; Phase 3 adds face and
 * the combined hands+face path (TDD-001).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { TrackedFrame } from '../components/shared/trackerTypes';

export interface UseTrackerOptions {
  hands?: boolean;      // default true
  face?: boolean;       // default false (added Phase 3)
  smoothing?: number;   // 0..1 UI amount, same scale as SmoothingControl
  confidence?: number;  // handedness gate, default 0.5
}

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true } = options;
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });

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

  const setSmoothing = useCallback((amount01: number) => {
    settingsRef.current.smoothingAlpha = smoothingToLerp(Math.max(0, Math.min(1, amount01)));
  }, []);

  const setConfidence = useCallback((threshold: number) => {
    settingsRef.current.confidence = threshold;
  }, []);

  const frameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!hands) return; // Phase 3 adds the face-only and combined paths here.
    let isActive = true;

    const setup = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!isActive) {
          landmarker.close();
          return;
        }

        handLandmarkerRef.current = landmarker;
        startCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        setError(`Failed to load hand tracking: ${err.message}`);
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
        }
      } catch (err) {
        console.error('Camera Error:', err);
        setError('Could not access camera.');
      }
    };

    const tick = () => {
      if (!videoRef.current || !handLandmarkerRef.current || !isActive) return;

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const now = performance.now();
        try {
          const handResult = handLandmarkerRef.current.detectForVideo(video, now);
          frameRef.current = buildFrame(frameRef.current, handResult, null, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
          });
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
      if (handLandmarkerRef.current) handLandmarkerRef.current.close();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoRef, hands]);

  return { frameRef, isReady, error, setSmoothing, setConfidence };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (not imported by anything yet).

- [ ] **Step 3: Commit**

```bash
git add hooks/useTracker.ts
git commit -m "Add useTracker hook: hands-only camera + rAF loop over buildFrame (item 5 phase 2, task 4)"
```

---

### Task 5: `useMediaPipe` becomes an adapter over `useTracker`

**Files:**
- Modify: `hooks/useMediaPipe.ts` (full rewrite of the body below the Task 1 re-export line; the re-export itself stays)

**Interfaces:**
- Consumes: `useTracker` (`hooks/useTracker.ts`, Task 4).
- Produces: `useMediaPipe(videoRef): { isCameraReady: boolean; handPositionsRef: React.RefObject<{...}>; lastResultsRef: React.RefObject<{landmarks, handedness} | null>; error: string | null; setSmoothingFactor: (factor: number) => void }` — **identical public shape** to today, so every current consumer (`AirCanvas.tsx`, `HandTelemetry.tsx`, `RhythmGame.tsx`, `MotionRecorder.tsx`) keeps compiling and behaving the same with zero changes.

No new test file: this is glue code with no pure logic of its own (it re-shapes already-tested `buildFrame` output). Correctness is proven by the full gate plus the honest camera-unverified line in Task 6 — the same bar the original hook was held to.

- [ ] **Step 1: Write the implementation**

Replace everything in `hooks/useMediaPipe.ts` below the license header and the Task 1 re-export with:

```ts
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useTracker } from './useTracker';
import { Landmark } from '../components/shared/trackerTypes';

interface AdapterHandResult {
  landmarks: Landmark[][];
  handedness: { categoryName: string; score: number }[][];
}

export const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const [smoothing, setSmoothingState] = useState(0.6);
  const tracker = useTracker(videoRef, { hands: true, smoothing, confidence: 0.5 });

  const setSmoothingFactor = useCallback((factor: number) => {
    setSmoothingState(Math.max(0.01, Math.min(1.0, factor)));
  }, []);

  const handPositionsRef = useRef<{
    left: THREE.Vector3 | null;
    right: THREE.Vector3 | null;
    lastLeft: THREE.Vector3 | null;
    lastRight: THREE.Vector3 | null;
    leftVelocity: THREE.Vector3;
    rightVelocity: THREE.Vector3;
    lastTimestamp: number;
  }>({
    left: null,
    right: null,
    lastLeft: null,
    lastRight: null,
    leftVelocity: new THREE.Vector3(0, 0, 0),
    rightVelocity: new THREE.Vector3(0, 0, 0),
    lastTimestamp: 0,
  });

  const lastResultsRef = useRef<AdapterHandResult | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!tracker.isReady) return;
    let isActive = true;

    const tick = () => {
      if (!isActive) return;
      const frame = tracker.frameRef.current;

      if (frame) {
        lastResultsRef.current = {
          landmarks: frame.hands.map((h) => h.landmarks),
          handedness: frame.hands.map((h) => [
            { categoryName: h.side === 'right' ? 'Right' : 'Left', score: h.score },
          ]),
        };

        const s = handPositionsRef.current;
        s.lastTimestamp = frame.t;

        if (frame.left) {
          const v = new THREE.Vector3(frame.left.tip.x, frame.left.tip.y, frame.left.tip.z);
          s.leftVelocity.set(frame.left.velocity.x, frame.left.velocity.y, frame.left.velocity.z);
          s.lastLeft = s.left ?? v.clone();
          s.left = v;
        } else {
          s.left = null;
        }

        if (frame.right) {
          const v = new THREE.Vector3(frame.right.tip.x, frame.right.tip.y, frame.right.tip.z);
          s.rightVelocity.set(frame.right.velocity.x, frame.right.velocity.y, frame.right.velocity.z);
          s.lastRight = s.right ?? v.clone();
          s.right = v;
        } else {
          s.right = null;
        }
      }

      requestRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      isActive = false;
      cancelAnimationFrame(requestRef.current);
    };
  }, [tracker.isReady, tracker.frameRef]);

  return {
    isCameraReady: tracker.isReady,
    handPositionsRef,
    lastResultsRef,
    error: tracker.error,
    setSmoothingFactor,
  };
};
```

The full file after this task is: the license header, `export { mapHandToWorld } from '../components/shared/mapHandToWorld';` (from Task 1), then everything above.

- [ ] **Step 2: Typecheck (this is where consumer compatibility gets proven)**

Run: `npm run typecheck`
Expected: clean. `AirCanvas.tsx`, `HandTelemetry.tsx`, `RhythmGame.tsx`, `MotionRecorder.tsx` all destructure `{ isCameraReady, handPositionsRef, lastResultsRef, error, setSmoothingFactor }` (some subsets) from `useMediaPipe` — if any field's shape drifted, this is where it shows up. `resolveHands` and `gestureAnalysis.calculatePinchDistance` both take loosely-typed `any[][]` landmark/handedness params, so `AdapterHandResult`'s narrower typing does not break them.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this task touches no pure function any test exercises directly — `useMediaPipe` itself has never been unit-tested, being a hook that needs a real DOM/camera).

- [ ] **Step 4: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build && npm run smoke`
Expected: all green.

```bash
git add hooks/useMediaPipe.ts
git commit -m "useMediaPipe becomes a thin adapter over useTracker (item 5 phase 2, task 5)"
```

---

### Task 6: Record the phase gate honestly and wrap up

**Files:**
- Modify: `HANDOFF.md` (add a new host-verification checklist item, same pattern as items 1-4, 6, and 9)
- Modify: `PLANNING.md` (item 5's row — mark Phase 2 done, Phase 3 as the next unit of work)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Run the full gate one final time**

Run: `npm run typecheck && npm test && npm run build && npm run smoke`
Expected: all green. Note the exact test count (should be the pre-phase count + 3 new `mapHandToWorld` tests + 8 new `buildFrame` tests) for the HANDOFF.md entry.

- [ ] **Step 2: Add the HANDOFF.md checklist item**

Add a new numbered item to the "Next concrete step" host-verification checklist in `HANDOFF.md` (after the existing item 9), following the exact phrasing pattern already used there:

```markdown
10. **(item 5, TDD-001 Phase 2, 🔌 wired not verified)** `TrackedFrame`/`buildFrame`/`useTracker` landed; `useMediaPipe` is now an adapter over `useTracker` with an identical public shape, so Air Canvas, Hand Telemetry, Tempo Strike, and Motion Recorder should behave exactly as before. Never run against a real camera this session. Confirm all four demos mount and track hands exactly as before (no visible regression in smoothing, pinch detection, or the world-space fingertip position Tempo Strike/Motion Recorder/the hologram cube read via `handPositionsRef`).
```

- [ ] **Step 3: Update PLANNING.md item 5's row**

In `PLANNING.md`'s Next table, item 5's Gate column currently reads "Per-phase gates in the TDD; final: no `lastResultsRef` / `handPositionsRef` / `faceResultRef` left in the tree; all five demos host-verified." Add a parenthetical noting Phase 2 status, matching the style already used for item 6 in the Now table:

```markdown
| 5 | **`TrackedFrame` + `useTracker`**: one frame shape, `useMediaPipe` and `useFaceTracker` become adapters, face folds into the same loop, then consumers move and the adapters are deleted. Run as a `phased-rebuild`. **Phase 2 (`TrackedFrame`/`buildFrame`/hands-only `useTracker`/`useMediaPipe` adapter) landed 2026-09-16, gate-green, camera-unverified — see `HANDOFF.md`. Next: Phase 3 (face).** | M | [TDD-001](docs/tdd/TDD-001-tracker-core.md) P2 to P4 | Per-phase gates in the TDD; final: no `lastResultsRef` / `handPositionsRef` / `faceResultRef` left in the tree; all five demos host-verified. |
```

- [ ] **Step 4: Commit**

```bash
git add HANDOFF.md PLANNING.md
git commit -m "Record item 5 Phase 2 (TrackedFrame + useTracker hands-only) gate status"
```

---

## After this plan

Phase 3 (fold face into `useTracker`, `useFaceTracker` becomes its adapter, `FaceDemo` moves onto the shared render loop) gets its own plan once this one's gate is green and committed — its exact task shape depends on the final `useTracker`/`buildFrame` API this plan produces, and TDD-001's own risk note is explicit that consumers (including `FaceDemo`'s render-loop wiring) must not move until Phase 4, all at once.
