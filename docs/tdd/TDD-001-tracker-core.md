# TDD-001: Tracker core and one `TrackedFrame`

| | |
|---|---|
| Status | Proposed (2026-09-06) |
| Serves | **Track** (Drive and Save both consume its output) |
| Teardown findings | F1 (dead smoothing slider), F4 (two copy-pasted trackers, engine covers 2 of 5 demos), F6 (camera-rate React state) |
| Effort | M overall; phase 1 alone is S and is the recommended first change in the repo |
| Depends on | nothing |
| Unblocks | TDD-002 (recorder over the frame), TDD-003 (skeleton replay) |

## Problem

Hand data exists in two shapes that never meet:

- `handPositionsRef`: one smoothed world-space `Vector3` per hand (the index fingertip) plus velocity. Consumers: Tempo Strike, Motion Recorder, Hand Telemetry's sidebar numbers.
- `lastResultsRef`: the raw MediaPipe `HandLandmarkerResult` (21 normalized landmarks per hand, unsmoothed). Consumers: Air Canvas, Hand Telemetry's drawn skeleton, the hologram cube, `WebcamPreview`.

The Global Smoothing slider only affects the first shape, so in Air Canvas it does nothing and in Hand Telemetry it only changes the sidebar numbers ([teardown F1](../TEARDOWN-2026-09-06.md)).

Face tracking is a second copy of the same hook with a different landmarker (`useFaceTracker.ts`), so hands and face together means two camera requests and two rAF loops. Three demos run their own rAF loop instead of `useHandRenderLoop`, and two skeleton-drawing tables disagree.

## Goals

1. One camera grant, one rAF loop, one frame shape (`TrackedFrame`) for hands and face.
2. Smoothing acts on the landmarks every consumer reads, so the slider does what it says everywhere.
3. Every existing demo keeps working through the migration. Adapter first, rewrite never.
4. Adding a third modality (pose) is a one-file addition.
5. Frames are plain data (serializable) so the recorder can store them verbatim.

## Non-goals

- Changing any demo's look, thresholds, or feel. Pinch is still "under 30 px"; the world mapping is still `mapHandToWorld`.
- Moving inference to a Web Worker. The GPU delegate wants the main thread's WebGL context. Revisit only if jank persists after F6 is fixed.
- A public API surface. Internal shape only; publishing is a separate decision.
- Folder moves. `core/` is the target name; the files can stay where they are until the last migration step.

## Design

### Types

```ts
// core/tracker/types.ts (name is a proposal; today it can live in components/shared/)

export interface Landmark { x: number; y: number; z: number }
export interface Vec3 { x: number; y: number; z: number }   // plain, serializable

export interface TrackedHand {
  side: 'left' | 'right';
  score: number;              // handedness confidence, 0..1
  landmarks: Landmark[];      // 21, normalized image space, SMOOTHED (what demos draw)
  rawLandmarks: Landmark[];   // 21, exactly as MediaPipe returned them (telemetry shows both)
  world: Vec3[];              // 21, world units via mapHandToWorld with this hand's depth
  tip: Vec3;                  // world[8]; the value Tempo Strike and Motion Recorder use today
  velocity: Vec3;             // world units per second, from the smoothed tip
  pinch: number;              // thumb tip to index tip distance in normalized units
}

export interface TrackedFace {
  landmarks: Landmark[];                 // 478
  blendshapes: Record<string, number>;   // 52 ARKit-style scores
  transform: number[] | null;            // 16 floats, column-major, from facialTransformationMatrixes
}

export interface TrackedFrame {
  t: number;                 // ms since tracker start
  dt: number;                // ms since the previous frame (0 on the first)
  hands: TrackedHand[];      // 0..2, after confidence gating
  left: TrackedHand | null;
  right: TrackedHand | null;
  face: TrackedFace | null;
}
```

Why plain `Vec3` and not `THREE.Vector3`: the recorder stores frames as-is and `MotionRecorder` already re-wraps `frame.leftHand` into a `Vector3` on load because JSON round-trips strip the class. Consumers that want `THREE.Vector3` wrap at the edge.

### Hook

```ts
useTracker(videoRef, options: {
  hands?: boolean;        // default true
  face?: boolean;         // default false
  smoothing?: number;     // 0..1 UI amount, same scale as SmoothingControl
  confidence?: number;    // handedness gate, default 0.5
}): {
  frameRef: React.RefObject<TrackedFrame | null>;
  isReady: boolean;
  error: string | null;
  setSmoothing: (amount01: number) => void;
  setConfidence: (threshold: number) => void;
}
```

Internals, one loop:

1. `getUserMedia` once (video only; audio is the recorder's business).
2. Create the landmarkers requested in `options` from one `FilesetResolver`.
3. Per rAF tick with a fresh video frame: `HandLandmarker.detectForVideo` and/or `FaceLandmarker.detectForVideo` with the same timestamp, then `buildFrame(prevFrame, handResult, faceResult, now)`.
4. Publish to `frameRef.current`. No React state per frame; `isReady` and `error` are the only state.

If both landmarkers are enabled and the combined cost drops the loop under about 30 fps, run the face landmarker on alternate ticks and reuse the previous face. That is an internal policy, not an option.

### Signal pipeline (pure, tested)

- `resolveHands(landmarksList, handedness, confidence, bypass)`: unchanged. Already pure and tested.
- `smoothLandmarks(prev: Landmark[] | null, next: Landmark[], alpha: number): Landmark[]`: per-landmark lerp; `alpha = smoothingToLerp(amount)`, so `RAW` is passthrough and `MAX` is heavy. **Pair by side** (the frame's `left`/`right` after `resolveHands`), never by array index, because MediaPipe reorders hands between frames.
- `mapHandToWorld(x, y, depth)`: unchanged, applied to all 21 points using the hand's depth estimate (wrist to middle-MCP size, as today).
- Velocity: `(tip - prevTip) / dt`, from the smoothed tip, in world units per second (as today).
- `pinch`: `hypot(landmarks[4] - landmarks[8])` in normalized units. Demos that want pixels multiply by canvas size, as today.

### Why smoothing at the landmark level

Smoothing the 21 points once means the skeleton, the pinch midpoint, the fingertip, the cube's basis vectors, and the recorder all see the same motion. Smoothing only the fingertip (today) means the skeleton jitters while the number in the sidebar is calm, which is the opposite of what a demo wants.

Trade-off: at heavy presets, pinch onset lags because the thumb and index positions lag. Two choices, recorded here so the next session does not re-derive them:

- **Option A (default):** gate pinch on the smoothed landmarks. Simple, consistent with what is drawn. Onset lag at `MAX` is about 100 ms; acceptable and visible, which is the point of a demo slider.
- **Option B:** gate pinch on `rawLandmarks`, draw with `landmarks`. Snappier onset, slight visual mismatch. Keep as a one-line switch if A feels laggy on a real camera.

### Migration adapter

`useMediaPipe` becomes a thin wrapper over `useTracker({ hands: true })` and keeps returning `{ isCameraReady, handPositionsRef, lastResultsRef, error, setSmoothingFactor }`:

- `handPositionsRef.current` is rebuilt each frame from `frame.left?.tip` / `velocity` (same field names as today).
- `lastResultsRef.current` is rebuilt each frame as `{ landmarks: [left.landmarks, right.landmarks], handedness: [...] }` carrying the **smoothed** landmarks, so every current consumer of `lastResultsRef` gets F1 fixed for free.
- `useFaceTracker` becomes a wrapper over `useTracker({ hands: false, face: true })` returning `faceResultRef` in MediaPipe's shape.

Consumers do not change until phase 4. The wrappers are deleted in phase 4.

### Render loop

`useHandRenderLoop` is renamed `useRenderLoop` (or kept; the name is cosmetic) and gains nothing. `FaceDemo` and `WebcamPreview` move onto it so there is one rAF policy for canvas demos. `WebcamPreview` draws with `drawingHelpers.drawConnectors` and the second `HAND_CONNECTIONS` table is deleted.

### Readouts (F6)

Sidebar numbers (`HandTelemetry` metrics, `FaceDemo` blendshapes) move into a small `<Readout>` component that samples `frameRef.current` on a 100 ms interval and holds its own state. The render loop stops calling `setState`.

## Phases and gates

Each phase ends with `npm run typecheck && npm test && npm run build && npm run smoke` green and a host-verification line recorded in `HANDOFF.md`.

| Phase | Work | Effort | Gate (binary) |
|---|---|---|---|
| 1 | `smoothLandmarks` (pure + test) applied inside today's `useMediaPipe.processResults` before publishing `lastResultsRef`; pair by side | S | New test file passes with the endpoints pinned (alpha 1.0 returns `next` exactly; alpha 0.1 moves 10% toward `next`). Host: in Air Canvas, `RAW` vs `MAX` visibly differ while drawing a slow circle. Closes F1. |
| 2 | `TrackedFrame` types + `buildFrame` (pure, tested) + `useTracker` for hands only; `useMediaPipe` becomes the adapter | S | tsc clean; all existing tests pass; a `buildFrame` test covers: two hands, one hand, hand swap between frames keeps smoothing continuity by side. Host: all 5 demos mount and behave as before. |
| 3 | Face into `useTracker`; `useFaceTracker` becomes the adapter; `FaceDemo` onto the shared render loop | S | Host: Face Puppet works; enabling `hands` and `face` together in Hand Telemetry (dev-only toggle) shows both in one loop at 30 fps or better. |
| 4 | Consumers read `frameRef` directly; delete both adapters; `WebcamPreview` reuses `drawConnectors` | S | `grep -rn "lastResultsRef\|handPositionsRef\|faceResultRef"` returns nothing outside git history. Host: all 5 demos re-verified. |
| 5 | `<Readout>` component; remove per-frame `setState` from both demos | S | React DevTools Profiler: sidebar commits at or under 10 per second while tracking. Closes F6. |

Phase 1 is independently valuable and is the teardown's recommended first change. Phases 2 through 5 are a `phased-rebuild`.

## Test plan

Pure (vitest, run in CI):

- `smoothLandmarks`: endpoints, length mismatch returns `next`, `prev === null` returns `next`.
- `buildFrame`: side pairing across a swap; `dt` computed from timestamps; `pinch` matches `calculatePinchDistance` scaled by canvas size for a known landmark set; `left`/`right` null when absent; face null when not requested.
- Existing `resolveHands`, `smoothing`, `lineReliability` tests unchanged.

Host-verified (real Chrome with a webcam; write the result in `HANDOFF.md`):

- Air Canvas: slider presets visibly change line jitter.
- Hand Telemetry: skeleton and sidebar numbers agree (both calm at `SMTH`).
- Tempo Strike: hits register as before; saber follows the fingertip.
- Motion Recorder: record, replay, export produce data.
- Face Puppet: puppet follows; PiP shows the camera.

## Risks

- **Pinch onset lag at heavy smoothing.** See Option A/B above. Default A; switch to B if it feels wrong on camera.
- **Two landmarkers per tick.** On an integrated GPU, hands cost roughly 6 to 10 ms and face roughly 8 to 12 ms per frame; together they can push a 60 fps loop to about 40. The alternate-tick policy for face keeps hands responsive.
- **Adapter drift.** If a consumer is changed to read `frameRef` in phase 2 or 3 "while we are in there", the adapter guarantee breaks. Rule: consumers move only in phase 4, all at once.
- **`rawLandmarks` doubles per-hand memory.** 21 points twice per hand is trivial; the recorder stores `landmarks` only (see TDD-002).

## Open questions

1. Keep `rawLandmarks` in the frame, or expose a `tracker.debug` flag that adds it only when Hand Telemetry asks? Proposal: keep it always; the cost is nothing and it keeps the frame shape stable.
2. Compute `world` for all 21 points every frame, or lazily? Proposal: all 21; 42 `mapHandToWorld` calls per frame is noise.
3. Should `useTracker` own the `<video>` element instead of taking a ref? Proposal: keep the ref; demos position the hidden video differently and it avoids a portal.
