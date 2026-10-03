# Take cleanup and orbit camera: design

_2026-10-02. Status: approved in chat, awaiting written-spec review. Next: `writing-plans`._

## Goal
Two playback features for recorded Face Puppet takes (v3 recordings), in the live recorder playback and the `/t/<id>` viewer:

1. **Cleanup layer.** Zero-phase smoothing plus short-gap interpolation on recorded frames, as a non-destructive toggle. Dropouts are filled and jitter is reduced without touching the raw take.
2. **Orbit camera.** Drag, zoom and reset around the playing animation to see it from another angle, including a settled answer to the face/hand depth mismatch.

Cleanup ships first (Phase 1), orbit second (Phase 2). Phase 2 reuses Phase 1's hand tracking and smoothing primitive.

## Findings that constrain the design (verified in code, 2026-10-02)
- **A dropout is a missing frame.** `components/face/captureFrame.ts` returns `null` when neither face nor hands are tracked, so no frame is recorded. Playback (`findFrameIndex`) then holds the previous frame, which looks like a freeze. A face-only or hand-only dropout omits that channel from the frame.
- **Saved takes carry no hand identity.** `captureFrame` writes hands right-first, filtered to those present, and `recordingSchema.ts` (`mapFrameHands`) labels index 0 `right` and index 1 `left`. A lone hand is always index 0, whichever hand it is. Identity has to be re-established before smoothing or filling a hand.
- **Stored landmarks are already live-filtered** (`TrackedHand.landmarks`: lerp; `TrackedFace.landmarks`: One Euro), never raw. Some causal lag is baked in and zero-phase smoothing cannot undo it. Storing raw alongside would need a schema change and would roughly double upload size against the 50 MB cap, so it is out of scope.
- **Depth is invisible today.** `projection.ts` maps x and y to image position and `z = lm.z * drawW`. Face z is centered on the head, hand z is relative to the wrist, so a hand's absolute depth is unknown. The ortho camera and `renderer.clearDepth()` before the hand pass hide this. Orbit would expose it.
- **The face is a front-only mask** (468 vertices, no skull or ears), so a look-behind view is not available.
- `FrameData` (`types.ts`) is the in-memory shape both players read: `timestamp`, `landmarks` (hands, array of 21-point arrays), `faceLandmarks` (478 points), `blendshapes` (record of 0..1 scalars).

## Non-goals (v1)
Live (non-playback) orbit, predictive extrapolation, back-of-head view, any schema change, storing raw landmarks, export or upload of cleaned data (raw stays raw). Cleaned export to Blender is near-free later because `buildEnvelope` already accepts `FrameData[]`.

## Phase 1: cleanup layer

### Module: `components/shared/cleanTake.ts`
Pure and deterministic. No React, no three. Reuses the speed-adaptive cutoff idea and constants from `components/shared/oneEuro.ts` (`FACE_ONE_EURO_DEFAULTS`, `faceSmoothingToMinCutoff`).

```ts
cleanTake(frames: FrameData[], opts: { strength: number /* 0..1 */; maxGapMs?: number /* default 300 */ }): {
  frames: FrameData[];
  report: { gapsFilled: number; gapsLeft: number; filledMs: number };
}
```

The input is never mutated. The result is memoized by `(frames identity, strength, maxGapMs)`.

**Steps**
1. **Resample** to a uniform grid at the median frame interval, from the first to the last timestamp. A dropped frame becomes a grid slot with every channel absent, instead of a freeze. Output keeps the `FrameData` shape, so `findFrameIndex` and both players work unchanged.
2. **Hand tracking** (`components/shared/handTracks.ts`, also used by Phase 2). Two persistent slots. In each frame, assign the present hands to slots by nearest wrist (landmark 0), choosing the assignment with the smaller total distance when two hands are present. A lone hand goes to the nearer slot, or to a free slot if it is far from both. The first frame with two hands seeds the slots (index 0 is slot A). Output keeps the existing convention (present hands only, slot A first). Tracks are per-channel series with a presence mask.
3. **Gap fill.** A gap is a run of absent samples in one channel between two present samples, with duration at most `maxGapMs` (default 300). Landmarks use cubic Hermite per coordinate, with tangents from the finite difference of the neighbouring samples. Blendshapes use linear interpolation clamped to 0..1. Longer gaps stay absent (the face or hand disappears, as it does today). Leading and trailing gaps are never filled: no extrapolation, no prediction.
4. **Zero-phase smoothing**, per channel and per contiguous present segment, so nothing bleeds across a long gap. The cutoff at each sample is `minCutoff + beta * |v|`, with `v` a central-difference speed (non-causal). Then a forward and a backward exponential pass with the per-sample alpha derived from that cutoff and the grid dt. `strength` maps to `minCutoff` through the existing mapping, and `strength = 0` is a pass-through. Filled samples are smoothed along with present ones.
5. **Report** counts gaps filled, gaps left, and total filled milliseconds, for a small badge ("filled 3 gaps, 0.4 s").

### Playback integration
- Hook `hooks/useCleanedFrames.ts`: `(frames, enabled, strength) => { frames, report }`. Returns the raw frames when disabled.
- One "Clean up" switch plus a strength slider (shown when on) in the Face Puppet playback controls and in `TakeViewer`'s player. **Default off.** The choice is remembered per viewer in `localStorage` (guarded with try/catch). Strength default: medium (0.5).
- Export and upload paths keep using the raw frames. The report badge shows only when the switch is on.
- Cost: the cleaned copy is roughly one more take's worth of landmark objects (a 150 s take at 60 fps is about 9000 frames). It is computed once per toggle or strength change. If profiling shows a stall on a phone, move the compute to a worker or to typed arrays; do not pre-optimize.

### Phase 1 gates
- Unit tests (`cleanTake.test.ts`, `handTracks.test.ts`):
  - A synthetic sine with a 200 ms dropout is filled within a tolerance, and a 400 ms dropout is left absent.
  - Zero phase: the smoothed peak time equals the input peak time, where a causal filter's peak lags.
  - Hand identity survives a swap in array order (one hand present, then both, then the other alone).
  - Blendshapes stay in 0..1 after fill and smoothing.
  - `strength = 0` returns values equal to the resampled input. The input is not mutated. The report counts are correct.
- `npm run typecheck`, `npm test`, build and smoke stay green.
- Proof: a synthetic take with injected dropouts and jitter, screenshotted raw versus cleaned (Playwright capture script, output under `.proof/`, captured last, after the gate).

## Phase 2: orbit camera

### Depth: size-based placement (decided)
Rejected: a fixed plane (wrong whenever a hand reaches in or out) and an extra pose model for wrist depth (heavy, a new model to ship).

In a pinhole camera, depth is inversely proportional to apparent size, and the focal length cancels in the hand/face ratio. Using the 3D length (so it is rotation-invariant) of face landmarks 234 to 454 (about 14.5 cm) and hand landmarks 0 to 9 (about 9.5 cm):

`r = Zhand / Zface = (9.5 / handSize) / (14.5 / faceSize) ≈ 0.655 * faceSize / handSize`, clamped to `[0.25, 1.3]`.

Placement leaves the face geometry exactly as it is. With `c` the image center in scene units and `f` the focal length in stage pixels (assumed horizontal FOV 63 degrees, `f = (drawW / 2) / tan(31.5 deg)`), each hand scene point `(x, y, z)` becomes:

`(cx + r*(x - cx), cy + r*(y - cy), f*(1 - r) + r*z)`

- `r = 1` is the identity, so the default (ortho) view is pixel-identical to today.
- A perspective camera at the capture pose (distance `f` from the face plane, looking down -z) reproduces the captured image for the hands.
- Accuracy is roughly plus or minus 20 to 30 percent: a plausible 3D view, not metric. Document this in `docs/`, not in the UI.
- `r` is computed once per take as a per-slot series (`components/face/handDepth.ts`). Face size comes from the face channel with gaps filled from neighbours (hand over face), and hold at the ends. Both sizes and `r` pass through the Phase 1 zero-phase smoothing primitive, independent of the cleanup toggle (orbit on a raw take still gets smoothed depth). If the take has no face at all, `r` falls back to 0.7.

### Rendering
- `PuppetScene.ts` keeps its `OrthographicCamera` as the default and gains a `PerspectiveCamera` (vertical FOV 35 degrees, front distance chosen so the front view fits like the ortho one). Lights become children of the active camera (a headlight), so an orbited view is never dark.
- `PuppetOptions` gains `view?: { yaw: number; pitch: number; dist: number } | null`. `null` (default) renders exactly as today.
- `handRig` is refactored into `handRigFromScenePoints(P: V3[])` plus the existing `handRig(lm, p)` wrapper (maps with `toScene`, calls the new function), so the placement is applied before the rig is built. Existing `handRig` tests stay unchanged.
- The pivot is a fixed point per take: the median face center over the take (stage-center fallback with no face). The camera is world-fixed in the capture volume, not head-following.
- Yaw is clamped to plus or minus 75 degrees and pitch to plus or minus 40 degrees. Only the front surface was captured, so there is no look-behind.

### Input: `components/face/orbitState.ts`
A small pure module (state, reducer-style update functions, clamps) plus a thin pointer-event hook. No OrbitControls dependency. Drag rotates, wheel or two-finger pinch zooms (distance clamped to roughly 0.5x to 2x of the front fit), double-tap or a "Reset view" button restores the front pose. `touch-action: none` is applied only while orbit is on, so page scroll on a phone is unaffected. An "Orbit" toggle (default off) sits next to "Clean up" in both players.

### Phase 2 gates
- Unit tests: `r = 1` placement is the identity; a hand placed with `r` reprojects through the capture-pose camera to its original image position; `r` is clamped; no-face fallback is 0.7; orbit clamps hold; pinch and wheel zoom clamp; reset restores the front pose.
- Existing `face`/`phone-check` gates stay green with orbit off (default view unchanged).
- Proof (WebKit, matching the iPhone): a still of the front pose and an orbited pose, plus a short video of a drag-orbit with a hand in front of the face. Extend `phone-check` with one orbit drag assertion on the iPhone profile. Captured last, outside `test-results/`.

## Risks and open items
- Baked-in lag (see findings): cleaned takes are smoother and gap-filled but not lag-free. Revisit raw storage only if this bites.
- Hand-size depth is noisy under heavy occlusion or extreme foreshortening. The clamp, the smoothing and the fallback bound the damage.
- A hand re-detected as a different hand across a gap up to 300 ms interpolates as a slide. Accepted for v1.
- Memory on phones for the cleaned copy (see cost note in Phase 1).
- Not blocking, for later: cleaned export to Blender, live orbit, a "Reset view" gesture on desktop beyond the button.
