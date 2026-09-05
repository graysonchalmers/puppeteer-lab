# DebugView Split: Air Canvas + Hand Telemetry

_Design spec. Status: approved for planning. Date: 2026-09-04._

## Problem

`components/DebugView.tsx` is a ~900-line component that fuses two distinct
products behind one screen:

1. A NASA-style diagnostic / telemetry view (mirrored webcam, hand skeleton,
   HUD, bounding boxes, pinch line, hand-state labels, basis vectors,
   inter-hand distances, center estimate, confidence gate, a 3D hologram, a
   proximity audio synth, a landmark recorder, and a live metrics readout).
2. A consumer "Air Canvas" drawing demo (right-hand pinch to draw, left-hand
   grab / move / delete, air-touch undo / clear, spark particles, and the new
   Line Reliability smoothing).

They share one `useMediaPipe` hook, one `requestAnimationFrame` render loop, one
canvas, one settings panel, and a large shared ref set. The naming is tangled
across the codebase: mode `debug`, component `DebugView`, folder
`components/debug/`, docs folder `demos/data-visualizer/`, and hub label
"Air Canvas" all point at the same thing.

The 2026-09-04 teardown flagged this as the project's biggest structural debt.

## Goal

Split into two separate hub demos with clean boundaries, and unify the naming.
A clean minimal **Air Canvas** and a full **Hand Telemetry**, sharing a thin
engine. This is deliberately NOT behavior-preserving (see Behavior delta).

## Decisions (locked during brainstorming)

- **Seam:** two separate hub demos (not one decomposed screen).
- **Air Canvas scope:** minimal / clean. Webcam mirror + drawn strokes + pinch
  reticles + undo / clear + two sliders (Global Smoothing, Line Reliability).
  No skeleton, HUD, bounding boxes, distances, hologram, audio, or recorder.
- **Hand Telemetry scope:** everything diagnostic that DebugView has today,
  minus the drawing and air-touch controls.
- **Telemetry name:** "Hand Telemetry" (mode `telemetry`, component
  `HandTelemetry`, folder `components/telemetry/`).
- **Air Canvas name:** keeps "Air Canvas" (mode `aircanvas`, component
  `AirCanvas`, folder `components/aircanvas/`).
- **Approach:** extract a thin shared engine first, then split. Build Air Canvas
  fresh (it is small now); derive Hand Telemetry from DebugView minus drawing;
  rewire hub / routing / folders; delete DebugView.

## Target file / folder layout

```
components/
  shared/
    useHandRenderLoop.ts    canvas sizing + mirrored webcam blit + rAF lifecycle;
                            calls a per-frame drawFrame(ctx, frame)
    resolveHands.ts         pure: (landmarksList, handedness, confidenceThreshold)
    resolveHands.test.ts      -> { left, right, drawnCount }
    gestureAnalysis.ts      moved from components/debug (calculatePinchDistance, analyzeGesture)
  telemetry/
    HandTelemetry.tsx       all diagnostic overlays + panel
    drawingHelpers.ts       moved from components/debug
    InteractiveObject.tsx   moved from components/debug
  aircanvas/
    AirCanvas.tsx           minimal drawing surface + two-slider panel
    pinchTracer.ts          moved from components/debug
    lineReliability.ts      moved from components/debug
    lineReliability.test.ts moved from components/debug
```

`components/debug/` is removed once every file above has moved out. Import paths
in each moved file and its consumers update to the new locations.

## The units

### `resolveHands` (pure, TDD target)

Extracts the handedness-resolution and confidence-gating logic currently inline
in DebugView's render loop (approx lines 239-257 of the pre-split file):

- Input: `landmarksList: Landmark[][]`, `handedness: Handedness[][]`,
  `confidenceThreshold: number`, and a flag for whether gating is bypassed
  (playback bypasses the gate today).
- Output: `{ left: Landmark[] | null, right: Landmark[] | null, drawnCount: number }`.
- Rules to preserve exactly:
  - Handedness category `'Right'` -> right; otherwise left.
  - When handedness is missing for an index, fall back to `index === 0` means
    right (matches current `isRight = index === 0`).
  - A hand whose score is below `confidenceThreshold` is skipped, UNLESS gating
    is bypassed (playback), in which case it is always counted / assigned.

This is the one genuinely logic-bearing extraction and gets unit tests first
(red / green) before either demo consumes it.

### `useHandRenderLoop` (shared hook)

Owns the boilerplate both demos need identically:

- Size the canvas to the video (`canvas.width/height = video.videoWidth/Height`).
- Clear, then draw the mirrored webcam frame (the `scale(-1,1)` blit) when the
  camera is ready and the video is readable.
- Start / stop the `requestAnimationFrame` loop tied to camera-ready state.
- Each frame, after the shared setup, call the demo's
  `drawFrame(ctx, { canvas, nowMs })`. Landmark resolution stays in each demo
  (they need results differently: telemetry iterates all hands; Air Canvas only
  wants left / right pinch points), but both use `resolveHands` for the split.

The hook does not own the demo-specific overlays, panels, refs, audio, or
recorder. It is purely the canvas + webcam + loop lifecycle.

### AirCanvas.tsx (minimal)

- Its own `useMediaPipe` instance; wires `setSmoothingFactor` from the Global
  Smoothing slider exactly as today.
- `drawFrame`: right-hand capture state machine (grace window + `bridgeGap`),
  left-hand grab / move / delete + particles, `renderStrokes` on the display
  buffers, `renderAirTouchControls`, and the pinch reticles. All of this is
  lifted verbatim from the current DebugView Air Canvas path (it already works
  and is tested at the geometry level).
- Panel: Global Smoothing slider, Line Reliability slider, and the manual
  Undo / Clear buttons. Plus the back-to-hub button.
- Drops: recorder, audio synth, hologram, and every telemetry overlay + toggle.
- Confidence gate: Air Canvas has no confidence slider, so it passes a fixed
  threshold to `resolveHands` matching today's default (`0.5`). Behavior for a
  well-tracked hand is unchanged; there is just no live knob for it.

### HandTelemetry.tsx (full diagnostics)

- Today's DebugView with the Air Canvas drawing path and air-touch controls
  removed.
- Keeps: HUD overlay, connectors, landmarks, bounding boxes, pinch line,
  hand-state labels, basis vectors, inter-hand distances (palm / finger / thumb /
  pinky), center estimate, confidence gate, Global Smoothing filter, the 3D
  hologram (`InteractiveObject`), the proximity audio synth, the landmark
  recorder + playback, and the live metrics readout, plus all their toggles.
- Uses `useHandRenderLoop` for the canvas / webcam / loop, and `resolveHands`
  for per-frame hand assignment.

## Routing, hub, naming

- `types.ts`: `AppMode` becomes `'home' | 'game' | 'telemetry' | 'aircanvas' | 'recorder' | 'face'` (drops `'debug'`).
- `App.tsx`: replace the single `mode === 'debug'` branch with two branches
  routing `'aircanvas'` -> `<AirCanvas>` and `'telemetry'` -> `<HandTelemetry>`,
  each with `onBack={() => setMode('home')}`.
- `DemoHub.tsx`: the current `id: 'debug'` card (label "Air Canvas") becomes two
  cards: "Air Canvas" (`id: 'aircanvas'`) and "Hand Telemetry"
  (`id: 'telemetry'`). Hub goes from 4 demos to 5. Copy / icons for the new
  Hand Telemetry card written fresh; Air Canvas card copy trimmed to the clean
  drawing scope.
- Docs: rename `demos/data-visualizer/` to `demos/air-canvas/`; add
  `demos/hand-telemetry/` (PLANNING.md + README.md describing the diagnostic
  demo). The `debug` / `data-visualizer` names disappear from the tree.

## Behavior delta (intentional, not behavior-preserving)

- You can no longer draw while watching full telemetry on one screen. Drawing is
  Air Canvas; diagnostics is Hand Telemetry.
- The recorder, audio synth, and 3D hologram are reachable only from Hand
  Telemetry now (Air Canvas has none of them). Note: a standalone Motion
  Recorder demo already exists separately; that is unchanged.
- Everything else keeps its current behavior within whichever demo owns it.

## Testing and verification

- TDD `resolveHands`: write failing unit tests for the handedness / confidence
  rules above, then extract the function to pass them.
- Keep the 11 `lineReliability` tests green after the file moves (update the
  import path only).
- `npm test` green, `npm run build` clean.
- Dev-server check: hub shows 5 cards; Air Canvas mounts with the two-slider
  panel and no telemetry overlays; Hand Telemetry mounts with the full
  diagnostic panel; zero console errors on both.
- Live webcam behavior (drawing, dropout bridging, telemetry overlays reacting
  to a real hand) stays a manual follow-up: the in-app preview has no camera.

## Out of scope

- No changes to the geometry / smoothing math (already shipped and tested).
- No changes to the standalone Game, Motion Recorder, or Face demos.
- No CI / deploy work.
- README `worldZ` snippet drift is a separate minor item, not addressed here.

## Execution

After this spec is reviewed and approved: `writing-plans` to produce the
implementation plan, then subagent-driven execution (fresh subagent per task,
two-stage review between tasks) per the standing preference.
