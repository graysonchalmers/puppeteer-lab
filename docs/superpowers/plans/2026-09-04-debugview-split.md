# DebugView Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the ~900-line `components/DebugView.tsx` into two hub demos, a minimal `AirCanvas` and a full `HandTelemetry`, over a thin shared engine, and unify the tangled naming.

**Architecture:** Extract a pure `resolveHands` (handedness + confidence gating) and a `useHandRenderLoop` hook (canvas sizing + mirrored webcam blit + rAF lifecycle) into `components/shared`. Relocate the existing helper modules into `components/telemetry` and `components/aircanvas`. Build the two demos on top, rewire `App`/`DemoHub`/`types`, then delete `DebugView`. Each task keeps `npm run build` and `npm test` green.

**Tech Stack:** React 18, TypeScript, Vite 6, @react-three/fiber, @mediapipe/tasks-vision, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-debugview-split-design.md`

## Global Constraints

- No em dashes in any prose written to disk (docs, comments). Use a period, comma, colon, or spaced hyphen.
- Every source file keeps the existing license header block (`@license` / `SPDX-License-Identifier: Apache-2.0`).
- Behavior within each demo is preserved from today's DebugView; the split itself is non-behavior-preserving (drawing and telemetry become separate screens; recorder, audio synth, and hologram live only in Hand Telemetry).
- Air Canvas has no confidence slider; it passes a fixed threshold of `0.5` to `resolveHands`.
- Gates after every task: `npm test` (all green) and `npm run build` (clean, only the pre-existing chunk-size warning is acceptable).
- The dev server runs on port 3000 (`npm run dev`); the in-app preview has no camera, so a real-hand behavior test is out of scope for these gates.
- Commit after each task. End commit messages with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure (target)

```
components/
  shared/
    resolveHands.ts         NEW pure: assign + gate hands
    resolveHands.test.ts    NEW vitest
    useHandRenderLoop.ts    NEW hook: canvas + webcam + rAF
    gestureAnalysis.ts      MOVED from components/debug
  telemetry/
    HandTelemetry.tsx       NEW (derived from DebugView minus drawing)
    drawingHelpers.ts       MOVED from components/debug
    InteractiveObject.tsx   MOVED from components/debug
  aircanvas/
    AirCanvas.tsx           NEW (minimal drawing surface)
    pinchTracer.ts          MOVED from components/debug
    lineReliability.ts      MOVED from components/debug
    lineReliability.test.ts MOVED from components/debug
components/debug/            DELETED once empty
```

---

## Task 1: Pure `resolveHands`

Extracts the handedness-resolution and confidence-gating logic currently inline in `DebugView.tsx:239-257`. This is the one logic-bearing extraction and is built test-first.

**Files:**
- Create: `components/shared/resolveHands.ts`
- Test: `components/shared/resolveHands.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface ResolvedHand { landmarks: any[]; isRight: boolean; score: number; }
  export interface ResolvedHands { hands: ResolvedHand[]; left: any[] | null; right: any[] | null; drawnCount: number; }
  export function resolveHands(
    landmarksList: any[][],
    handedness: any[],
    confidenceThreshold: number,
    bypassGate: boolean
  ): ResolvedHands
  ```

Rules to preserve exactly (from the current inline loop):
- `isRight` is true when `handedness[index][0].categoryName === 'Right'`; when handedness is missing for that index, fall back to `index === 0` means right.
- `score` is `handedness[index][0].score` when present, else `1.0`.
- A hand with `score < confidenceThreshold` is skipped UNLESS `bypassGate` is true (playback bypasses the gate today).
- Accepted hands go into `hands` in input order; `drawnCount === hands.length`.
- `left` / `right` are the landmark arrays of the last accepted hand of each handedness (matches the current single-assignment behavior).

- [ ] **Step 1: Write the failing tests**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { resolveHands } from './resolveHands';

const hand = (tag: string) => [{ x: 0, y: 0, tag }]; // minimal stand-in landmark array
const rightHandedness = [{ categoryName: 'Right', score: 0.9 }];
const leftHandedness = [{ categoryName: 'Left', score: 0.9 }];

describe('resolveHands', () => {
  it('assigns right and left from handedness category', () => {
    const r = resolveHands([hand('a'), hand('b')], [rightHandedness, leftHandedness], 0.5, false);
    expect(r.right).toEqual(hand('a'));
    expect(r.left).toEqual(hand('b'));
    expect(r.drawnCount).toBe(2);
    expect(r.hands.map((h) => h.isRight)).toEqual([true, false]);
  });

  it('falls back to index 0 = right when handedness is missing', () => {
    const r = resolveHands([hand('a'), hand('b')], [], 0.5, false);
    expect(r.right).toEqual(hand('a'));
    expect(r.left).toEqual(hand('b'));
  });

  it('skips a hand below the confidence threshold', () => {
    const lowRight = [{ categoryName: 'Right', score: 0.2 }];
    const r = resolveHands([hand('a'), hand('b')], [lowRight, leftHandedness], 0.5, false);
    expect(r.right).toBeNull();
    expect(r.left).toEqual(hand('b'));
    expect(r.drawnCount).toBe(1);
  });

  it('bypasses the gate for playback (keeps a low-score hand)', () => {
    const lowRight = [{ categoryName: 'Right', score: 0.2 }];
    const r = resolveHands([hand('a')], [lowRight], 0.5, true);
    expect(r.right).toEqual(hand('a'));
    expect(r.drawnCount).toBe(1);
  });

  it('returns empty result for no hands', () => {
    const r = resolveHands([], [], 0.5, false);
    expect(r).toEqual({ hands: [], left: null, right: null, drawnCount: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module './resolveHands'".

- [ ] **Step 3: Write the implementation**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure hand assignment + confidence gating, extracted from the DebugView
 * render loop so both the telemetry and Air Canvas demos share one rule set.
 */
export interface ResolvedHand {
  landmarks: any[];
  isRight: boolean;
  score: number;
}

export interface ResolvedHands {
  hands: ResolvedHand[];
  left: any[] | null;
  right: any[] | null;
  drawnCount: number;
}

export function resolveHands(
  landmarksList: any[][],
  handedness: any[],
  confidenceThreshold: number,
  bypassGate: boolean
): ResolvedHands {
  const hands: ResolvedHand[] = [];
  let left: any[] | null = null;
  let right: any[] | null = null;

  landmarksList.forEach((landmarks, index) => {
    let isRight = false;
    let score = 1.0;

    if (handedness && handedness[index] && handedness[index][0]) {
      isRight = handedness[index][0].categoryName === 'Right';
      score = handedness[index][0].score;
    } else {
      isRight = index === 0;
    }

    if (score < confidenceThreshold && !bypassGate) return;

    hands.push({ landmarks, isRight, score });
    if (isRight) right = landmarks;
    else left = landmarks;
  });

  return { hands, left, right, drawnCount: hands.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (5 new resolveHands tests + the existing 11 lineReliability tests).

- [ ] **Step 5: Commit**

```bash
git add components/shared/resolveHands.ts components/shared/resolveHands.test.ts
git commit -m "Add pure resolveHands (handedness + confidence gating)"
```

---

## Task 2: `useHandRenderLoop` hook

Extracts the canvas / webcam / rAF boilerplate shared by both demos (`DebugView.tsx:180-208` for setup and `531-540` for teardown). Not unit-tested directly (it owns DOM + rAF); verified by build here and by both demos consuming it in Tasks 4-5.

**Files:**
- Create: `components/shared/useHandRenderLoop.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface RenderFrame { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; nowMs: number; }
  export function useHandRenderLoop(
    canvasRef: React.RefObject<HTMLCanvasElement>,
    videoRef: React.RefObject<HTMLVideoElement>,
    active: boolean,
    isCameraReady: boolean,
    drawFrame: (frame: RenderFrame) => void
  ): void
  ```
  Behavior: while `active`, each animation frame it sizes the canvas to the video, clears it, draws the mirrored webcam frame when `isCameraReady` and the video is readable, then calls `drawFrame`. Cleans up the rAF on unmount / dependency change.

**Gotcha (critical for Tasks 4-5):** `drawFrame` is in the effect's dependency array, so consumers MUST wrap it in `useCallback` whose deps are only the stable settings/toggles (e.g. `confidenceThreshold`, the `show*` flags, `soundEnabled`). Every frequently-changing value the loop reads (the mediapipe results ref, stroke refs, `lineReliabilityRef`, `smoothingAmount` if read live) must come through a ref, not a closed-over state variable. Hand Telemetry calls `setMetrics` every frame; if `drawFrame` closed over per-frame state it would get a new identity each render and the loop would restart every frame. Memoizing `drawFrame` on toggles-only keeps the loop stable, matching the old single-effect behavior whose deps were exactly those toggles (`DebugView.tsx:541-556`).

- [ ] **Step 1: Write the hook**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared per-frame scaffolding for the hand-tracking demos: size the canvas to
 * the video, draw the mirrored webcam frame, and run the rAF loop. Each demo
 * supplies its own drawFrame for everything it paints on top.
 */
import { useEffect } from 'react';

export interface RenderFrame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  nowMs: number;
}

export function useHandRenderLoop(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  videoRef: React.RefObject<HTMLVideoElement>,
  active: boolean,
  isCameraReady: boolean,
  drawFrame: (frame: RenderFrame) => void
): void {
  useEffect(() => {
    if (!active) return;

    let animationFrameId: number;
    const renderLoop = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (video && video.videoWidth > 0) {
            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (isCameraReady && video && video.readyState >= 2) {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.translate(-canvas.width, 0);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }

          drawFrame({ canvas, ctx, nowMs: performance.now() });
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [active, isCameraReady, canvasRef, videoRef, drawFrame]);
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: clean build (the new file is unused so far but must typecheck/transpile).

- [ ] **Step 3: Commit**

```bash
git add components/shared/useHandRenderLoop.ts
git commit -m "Add useHandRenderLoop shared render-loop hook"
```

---

## Task 3: Relocate helper modules into new folders

Mechanical move of the existing helpers into `shared` / `telemetry` / `aircanvas`, updating every import so the build stays green while `DebugView` still exists.

**Files:**
- Move: `components/debug/gestureAnalysis.ts` to `components/shared/gestureAnalysis.ts`
- Move: `components/debug/drawingHelpers.ts` to `components/telemetry/drawingHelpers.ts`
- Move: `components/debug/InteractiveObject.tsx` to `components/telemetry/InteractiveObject.tsx`
- Move: `components/debug/pinchTracer.ts` to `components/aircanvas/pinchTracer.ts`
- Move: `components/debug/lineReliability.ts` to `components/aircanvas/lineReliability.ts`
- Move: `components/debug/lineReliability.test.ts` to `components/aircanvas/lineReliability.test.ts`
- Modify: `components/DebugView.tsx` import block (lines ~28-62) to point at the new paths.
- Modify: any moved file whose internal imports reference a sibling that also moved.

**Interfaces:** no code changes to the modules themselves, only their locations and import specifiers.

- [ ] **Step 1: Move the files with git**

```bash
git mv components/debug/gestureAnalysis.ts components/shared/gestureAnalysis.ts
git mv components/debug/drawingHelpers.ts components/telemetry/drawingHelpers.ts
git mv components/debug/InteractiveObject.tsx components/telemetry/InteractiveObject.tsx
git mv components/debug/pinchTracer.ts components/aircanvas/pinchTracer.ts
git mv components/debug/lineReliability.ts components/aircanvas/lineReliability.ts
git mv components/debug/lineReliability.test.ts components/aircanvas/lineReliability.test.ts
```

- [ ] **Step 2: Fix imports in moved files**

Check each moved file for imports of a sibling that also moved. `pinchTracer.ts` and `lineReliability.ts` do not import each other or `gestureAnalysis`, so they need no change. `drawingHelpers.ts` and `InteractiveObject.tsx`: if either imports `gestureAnalysis` or `../../types`, update the relative path (`../shared/gestureAnalysis`, `../../types`). Grep to confirm:

Run: `grep -rn "from '\./\|from '\.\./" components/shared components/telemetry components/aircanvas`
Fix any specifier that now points at the wrong depth.

- [ ] **Step 3: Fix DebugView imports**

In `components/DebugView.tsx`, update the import block so:
- `drawingHelpers` comes from `./telemetry/drawingHelpers`
- `gestureAnalysis` (`calculatePinchDistance`, `analyzeGesture`) comes from `./shared/gestureAnalysis`
- `InteractiveObject` comes from `./telemetry/InteractiveObject`
- `pinchTracer` symbols come from `./aircanvas/pinchTracer`
- `lineReliability` symbols come from `./aircanvas/lineReliability`

- [ ] **Step 4: Delete the now-empty debug folder**

Run: `rmdir components/debug` (it must be empty; if git left a directory, that is fine).

- [ ] **Step 5: Verify tests and build**

Run: `npm test` then `npm run build`
Expected: 16 tests pass (5 resolveHands + 11 lineReliability at its new path); build clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Relocate hand-tracking helpers into shared/telemetry/aircanvas folders"
```

---

## Task 4: Build the minimal AirCanvas demo

New component holding only the drawing surface, plus its hub card and route. `DebugView` still exists and still routes from `'debug'`; this task adds Air Canvas alongside it.

**Files:**
- Create: `components/aircanvas/AirCanvas.tsx`
- Modify: `types.ts:18` (add `'aircanvas'` to `AppMode`)
- Modify: `App.tsx` (import + route `'aircanvas'`)
- Modify: `components/DemoHub.tsx` (change the existing `id: 'debug'` card to `id: 'aircanvas'`; trim its copy to the clean drawing scope; bump the count text and grid, see Step 5)

**Interfaces:**
- Consumes: `useMediaPipe` (`hooks/useMediaPipe`), `resolveHands` + `useHandRenderLoop` (`./` ... `../shared/*`), `pinchTracer` + `lineReliability` (`./pinchTracer`, `./lineReliability`).
- Produces: `export default AirCanvas`, props `{ onBack: () => void }`.

- [ ] **Step 1: Write AirCanvas.tsx**

Build the component by lifting the Air Canvas slices from the current `DebugView.tsx`. The component:
- Declares `videoRef`, `canvasRef`, and calls `useMediaPipe(videoRef)` for `isCameraReady`, `lastResultsRef`, `error`, `setSmoothingFactor`.
- Holds the Air Canvas state/refs lifted verbatim from `DebugView.tsx:70` (`smoothingAmount`), `86-105` region (`showPinchTracer` can be dropped; Air Canvas always draws), and the line-reliability + stroke refs at `DebugView.tsx:89-108` (`lineReliabilityAmount`, `lineReliabilityRef`, `completedStrokesRef`, `currentStrokeRef`, `currentDisplayRef`, `drawStateRef`, `particlesRef`, `leftGrabStateRef`, `airTouchStateRef`).
- Keeps the Global Smoothing `useEffect` from `DebugView.tsx:114-118` (maps `smoothingAmount` to `setSmoothingFactor`) and the line-reliability ref sync `useEffect`.
- Uses `useHandRenderLoop(canvasRef, videoRef, isCameraReady, isCameraReady, drawFrame)`. In `drawFrame`, per frame:
  - `const { left: leftHandLandmarks, right: rightHandLandmarks } = resolveHands(results.landmarks ?? [], results.handedness ?? [], 0.5, false)` using `lastResultsRef.current`.
  - Then the right-hand capture state machine, left-hand grab/particles, live-display + settle pass, `renderStrokes`, and `renderAirTouchControls` blocks lifted verbatim from `DebugView.tsx:312-502` (the full `if (showPinchTracer) { ... }` body, minus the `showPinchTracer` guard itself). Use `ctx`, `canvas`, and `nowMs` from the `RenderFrame`.
- Renders: the mirrored `<video ref={videoRef} .../>` (hidden, matching DebugView), the `<canvas ref={canvasRef} .../>`, a back button, and a right-side panel containing ONLY the Global Smoothing control block (`DebugView.tsx:572-620`), the Line Reliability control block (the block added this session), and the manual Undo / Clear buttons (`DebugView.tsx:602-620` region of buttons). Drop every telemetry toggle, the confidence gate, the hologram Canvas, the recorder, and the audio synth.

Refer to the current `DebugView.tsx` for the exact JSX of the video element, canvas element, and the two slider blocks; copy their markup and Tailwind classes verbatim so the look is unchanged.

- [ ] **Step 2: Add the route and mode**

In `types.ts` change:
```ts
export type AppMode = 'home' | 'game' | 'debug' | 'aircanvas' | 'recorder' | 'face';
```
In `App.tsx` add near the other imports `import AirCanvas from './components/aircanvas/AirCanvas';` and add a branch:
```tsx
{mode === 'aircanvas' && (
  <AirCanvas onBack={() => setMode('home')} />
)}
```

- [ ] **Step 3: Repoint the hub card**

In `components/DemoHub.tsx`, change the first section's `id: 'debug'` to `id: 'aircanvas'`. Keep its "Air Canvas" title and drawing highlights.

- [ ] **Step 4: Verify build + tests**

Run: `npm run build` then `npm test`
Expected: clean build, 16 tests pass.

- [ ] **Step 5: Browser smoke test**

Start the dev server and confirm Air Canvas mounts with only the two sliders and undo/clear, no telemetry overlays, no console errors. The hub still shows the same number of cards at this point (the debug card became the aircanvas card).

Run (manual): `npm run dev`, open `http://localhost:3000`, click the Air Canvas card, confirm the panel shows Global Smoothing + Line Reliability + Undo/Clear only, and the console is clean. The MediaPipe "StartGraph failed" line is expected (no camera in the preview).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add minimal AirCanvas demo on the shared render loop"
```

---

## Task 5: Build the full HandTelemetry demo

New component holding all diagnostic features, plus its hub card and route.

**Files:**
- Create: `components/telemetry/HandTelemetry.tsx`
- Modify: `types.ts` (add `'telemetry'` to `AppMode`)
- Modify: `App.tsx` (import + route `'telemetry'`)
- Modify: `components/DemoHub.tsx` (add a new "Hand Telemetry" card; update count text to 5 and grid to `lg:grid-cols-5`)

**Interfaces:**
- Consumes: `useMediaPipe`, `useRecorder`, `RecorderControls`, `resolveHands`, `useHandRenderLoop`, `drawingHelpers`, `InteractiveObject`, `gestureAnalysis`.
- Produces: `export default HandTelemetry`, props `{ onBack: () => void }`.

- [ ] **Step 1: Write HandTelemetry.tsx**

Derive from the current `DebugView.tsx` by keeping everything EXCEPT the Air Canvas drawing. Concretely:
- Keep all telemetry state/toggles from `DebugView.tsx:69-112` EXCEPT the Air Canvas ones (`showPinchTracer`, `lineReliabilityAmount`, `lineReliabilityRef`, and the stroke refs `completedStrokesRef`, `currentStrokeRef`, `currentDisplayRef`, `drawStateRef`, `particlesRef`, `leftGrabStateRef`, `airTouchStateRef`). Keep `smoothingAmount`, `confidenceThreshold`, the show* telemetry toggles, `soundEnabled`, `showHologram`, the audio refs, and `metrics`.
- Keep the Global Smoothing `useEffect` and the audio-synth `useEffect` (`DebugView.tsx:114-178`).
- Replace the inline render loop (`DebugView.tsx:180-556`) with `useHandRenderLoop(canvasRef, videoRef, isCameraReady || recorder.isPlaying, isCameraReady, drawFrame)`. In `drawFrame`:
  - Resolve playback vs live landmarks exactly as `DebugView.tsx:210-232` (recorder playback frame vs `lastResultsRef`), including the `recorder.captureFrame` call while recording.
  - Call `resolveHands(currentLandmarksList, currentHandedness, confidenceThreshold, recorder.isPlaying)` to get `{ hands, left, right, drawnCount }`.
  - Iterate `hands` and draw each with `drawConnectors` / `drawLandmarks` / `drawBoundingBox` / `drawPinchLine` / `drawHandStateLabel` / `drawBasisVectors` using its `isRight`/`score`, lifted from `DebugView.tsx:254-289`. Track `minPinchDist` for the audio synth.
  - Keep the inter-hand distance block (`DebugView.tsx:293-306`), center estimate (`308-310`), audio synth block (`504-514`), and the metrics `setMetrics` block (`516-528`), using `left`/`right`/`drawnCount` from `resolveHands`.
  - Do NOT include the `if (showPinchTracer) { ... }` drawing body.
- Render: the same header, hidden video, canvas, the 3D hologram `<Canvas>` overlay (`DebugView.tsx:636-642`), the `RecorderControls` overlay (`645-...`), and the full settings panel MINUS the Line Reliability block and the Air Canvas Tracer toggle and the drawing Undo/Clear buttons. Keep Global Smoothing, Confidence Gate, sound toggle, hologram toggle, and the kinematics-overlay checkboxes.

Refer to the current `DebugView.tsx` for exact JSX/classes and copy verbatim.

- [ ] **Step 2: Add the route and mode**

In `types.ts`:
```ts
export type AppMode = 'home' | 'game' | 'debug' | 'aircanvas' | 'telemetry' | 'recorder' | 'face';
```
In `App.tsx` add `import HandTelemetry from './components/telemetry/HandTelemetry';` and:
```tsx
{mode === 'telemetry' && (
  <HandTelemetry onBack={() => setMode('home')} />
)}
```

- [ ] **Step 3: Add the hub card**

In `components/DemoHub.tsx`, add a new section object (place it after the aircanvas card) using existing lucide icons already imported where possible (e.g. `Activity` is not imported; use `Sliders` or import a suitable icon). Example:
```tsx
{
  id: 'telemetry',
  tag: 'HAND TELEMETRY',
  tagColor: 'text-white border-white/30 bg-white/10',
  title: 'Hand Telemetry',
  description: 'Full diagnostic view: skeleton, distances, confidence, and 3D readouts.',
  icon: <Sliders size={18} className="text-white" />,
  highlights: [
    { icon: <Sliders size={13} className="text-white" />, title: 'Skeleton & HUD', detail: 'Landmarks, connectors, bounding boxes, and basis vectors.' },
    { icon: <Move size={13} className="text-[#38BDF8]" />, title: 'Inter-Hand Distances', detail: 'Palm, finger, thumb, and pinky separation readouts.' },
    { icon: <RotateCcw size={13} className="text-amber-400" />, title: 'Confidence & Smoothing', detail: 'Gate low-confidence hands; tune the smoothing filter.' }
  ],
  actionLabel: 'Open Telemetry',
  accentColor: 'hover:border-white/50',
  buttonHoverBg: 'hover:bg-white hover:text-black'
}
```
Update the intro count text `DemoHub.tsx:208` from "4 Interactive Demos" to "5 Interactive Demos", and the grid class `DemoHub.tsx:213` from `lg:grid-cols-4` to `lg:grid-cols-5`.

- [ ] **Step 4: Verify build + tests**

Run: `npm run build` then `npm test`
Expected: clean build, 16 tests pass.

- [ ] **Step 5: Browser smoke test**

Run (manual): `npm run dev`, open the hub, confirm 5 cards. Open Hand Telemetry: the full diagnostic panel is present (Global Smoothing, Confidence Gate, sound, hologram, kinematics overlays), the hologram Canvas and RecorderControls render, and the console is clean apart from the expected no-camera MediaPipe line.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add full HandTelemetry demo; hub now has 5 cards"
```

---

## Task 6: Delete DebugView and the `debug` mode

Remove the now-unreferenced original component and its mode.

**Files:**
- Delete: `components/DebugView.tsx`
- Modify: `types.ts` (remove `'debug'` from `AppMode`)
- Modify: `App.tsx` (remove the `DebugView` import and the `mode === 'debug'` branch)

- [ ] **Step 1: Confirm nothing references DebugView or `'debug'`**

Run: `grep -rn "DebugView\|'debug'\|\"debug\"" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
Expected: only the lines in `App.tsx` and `types.ts` you are about to remove. If anything else appears, fix it first.

- [ ] **Step 2: Remove the file and references**

```bash
git rm components/DebugView.tsx
```
In `types.ts` set:
```ts
export type AppMode = 'home' | 'game' | 'aircanvas' | 'telemetry' | 'recorder' | 'face';
```
In `App.tsx` delete the `import DebugView ...` line and the `{mode === 'debug' && ( ... )}` block.

- [ ] **Step 3: Verify build + tests + browser**

Run: `npm run build` then `npm test`
Expected: clean build, 16 tests pass. Manual: `npm run dev`, hub shows 5 cards, both new demos open, no `debug` route remains.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Delete DebugView and the debug mode; split is complete"
```

---

## Task 7: Rename docs folders

Align the demo docs folders with the new names.

**Files:**
- Move: `demos/data-visualizer/` to `demos/air-canvas/`
- Create: `demos/hand-telemetry/PLANNING.md`, `demos/hand-telemetry/README.md`

- [ ] **Step 1: Rename the data-visualizer docs**

```bash
git mv demos/data-visualizer demos/air-canvas
```

- [ ] **Step 2: Add hand-telemetry docs**

Create `demos/hand-telemetry/README.md` with a short description: "Hand Telemetry: the full diagnostic view (skeleton, HUD, bounding boxes, inter-hand distances, confidence gate, smoothing filter, 3D hologram, proximity audio synth, landmark recorder, and live metrics). Split out of the former DebugView on 2026-09-04." Create `demos/hand-telemetry/PLANNING.md` noting it is the diagnostic counterpart to Air Canvas and shares the `components/shared` engine.

- [ ] **Step 3: Grep for stale doc references**

Run: `grep -rn "data-visualizer" --include="*.md" . | grep -v node_modules`
Fix any references in READMEs / PLANNING docs to point at the new folder names.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Rename demo docs: data-visualizer -> air-canvas; add hand-telemetry docs"
```

---

## Self-Review notes

- Spec coverage: shared engine (Tasks 1-2), folder reorg (Task 3), minimal Air Canvas (Task 4), full Hand Telemetry (Task 5), routing/hub/naming (Tasks 4-6), DebugView deletion (Task 6), docs renames (Task 7). Confidence-gate-fixed-0.5 for Air Canvas is in Task 4 Step 1 and the Global Constraints. Behavior delta captured in Global Constraints.
- Type consistency: `resolveHands` returns `{ hands, left, right, drawnCount }` and is consumed with those exact names in Tasks 4-5; `useHandRenderLoop(canvasRef, videoRef, active, isCameraReady, drawFrame)` and `RenderFrame { canvas, ctx, nowMs }` are used consistently.
- Verification: every task ends with `npm test` + `npm run build`; the two component tasks add a manual browser smoke test. Real-webcam behavior is explicitly out of scope for automated gates.
