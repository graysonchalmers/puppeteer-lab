# Face Puppet overhaul: design

_2026-09-22. Brainstormed with Grayson (architectural path). Status: approved in chat section by section, pending review of this written spec._

## Goal

Make the Face Puppet demo something worth sending to a friend:

1. The face looks like one coherent thing: a faceted, flat-shaded low-poly head. The current eyes and gaze behavior stay.
2. The mouth stops feeling sloppy.
3. Hands appear in the puppet so gestures read, and they record and play back with the face.
4. A take exports as a **video with audio** of the animated puppet, exactly as it plays.
5. A take exports as a **pack**: one zip with the video, the animation data, and the audio.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Hands scope | Visual only. Low-poly hands drawn where they are in frame, recorded and played back. No gesture recognition. |
| Video framing | Match the stage aspect, width capped at 1280. |
| Look | Faceted solid, mono gray ramp, one accent color (`#EE3B2B`). Hands get the same treatment. |
| Overlays | Grid, SYS.04 HUD badge, nose crosshair removed. Gaze Rays and Mocap Dots kept as toggles, both off by default. Video draws what the stage shows. |
| Mouth | Approach A: filtered landmarks plus a scale-invariant open ratio with hysteresis. Not blendshape-driven. |
| Renderer tech | Canvas 2D, not Three.js. Keeps `renderStylizedEye`, keeps `captureStream` simple, and lets playback render in the camera-less, WebGL-less preview for screenshot proof. |
| Zip | `fflate` (one ~8 KB dependency): media stored, JSON deflated. |

## Diagnosis of today's mouth

From `components/face/FaceMeshRenderer.ts` and `hooks/useFaceTracker.ts`:

- Open/closed is `mouthOpenDist > 4` in **pixels**, so it changes with camera distance and canvas size. (The eye blink test uses a ratio and is fine.)
- The face path has **no smoothing**; `useFaceTracker` hands back raw results.
- The renderer maps normalized landmarks straight onto canvas `w` and `h`, so a non-4:3 stage stretches the face.

## Section 1: Tracking and data flow

### One loop for face and hands (TDD-001 Phase 3)

- `useTracker({ face: true, hands: true })` creates `FaceLandmarker` and `HandLandmarker` from one `getUserMedia` stream and runs one rAF tick. Face and hands share the detection timestamp. `buildFrame` puts both into one `TrackedFrame` (the `face` slot and `buildTrackedFace` already exist).
- TDD-001's cost policy applies: if the combined loop falls under ~30 fps, the face landmarker runs on alternate ticks and the previous face is reused. Internal policy, not an option.
- `useFaceTracker` becomes a thin adapter over `useTracker({ hands: false, face: true })`, keeping its public shape (`{ isCameraReady, faceResultRef, error }`), same adapter-first pattern as Phase 2. **FaceDemo moves to reading `frameRef` directly** because it is being rebuilt anyway. No other demo changes.

### Face smoothing: One Euro filter

- New pure module `components/shared/oneEuro.ts`: a One Euro filter (adaptive low-pass: heavy smoothing when still, low lag when moving), plus a bank that filters an array of landmarks per coordinate.
- Filter state is a bank object owned by `useTracker` and passed to `buildFrame` through `BuildFrameOptions` (for example `faceFilter`). `buildFrame` stays deterministic for the same inputs and state.
- Applies to the 478 face landmarks. **Hands keep their existing slider-driven lerp**, so the other four demos are untouched.
- Params: `beta` and `dCutoff` fixed in code; `minCutoff` driven by one new "Face Smoothing" slider in the Face Puppet sidebar.
- `TrackedFace.landmarks` becomes the filtered set. Add `rawLandmarks` alongside, mirroring `TrackedHand`.

### Mouth state

- `mouthOpenRatio = dist(inner upper lip 13, inner lower lip 14) / dist(mouth corners 61, 291)`, computed on filtered landmarks in normalized image space (scale-invariant).
- Hysteresis: opens above ~0.08, closes below ~0.05. Starting values; tuned against a real take and pinned in tests.
- Pure function in its own module (for example `components/face/mouthState.ts`) taking the ratio and the previous state.

### Recording

- A Face Puppet take records per frame: `faceLandmarks` (filtered), `blendshapes`, and (Phase 4) `hands?: { side: 'left' | 'right'; landmarks: Landmark[] }[]`. `FrameData` gains the optional `hands` field (additive).
- The v3 envelope writes `channels: ['face', 'hands']` when any frame has hands, else `['face']`. `detectTrackingType` already lets `face` win, so older files still load.
- `capture.smoothing` records the One Euro settings used.

### Playback

Playback reads recorded frames and the renderer draws them exactly like live. This is what makes screenshot proof possible from an imported take in the camera-less preview.

## Section 2: Rendering

### Framing

The camera frame is fit into the stage at the video's own aspect ratio (contain, centered, letterboxed). Mirrored X as today. One projection helper shared by face, hands, and overlays.

### Low-poly face mesh

- **Vertex subset** (~150 of 468), fixed in `components/face/faceTopology.ts`: face oval, brows, nose ridge, both eye contours, both lip rings (outer and inner, full detail), plus sparse cheek, forehead, and jaw points.
- **Triangle table**, fixed and committed, generated once by `tools/gen-face-topology.mjs`: Delaunay-triangulate the subset on a frontal neutral reference frame, then delete triangles whose centroid falls inside either eye contour or the inner-lip ring (these become holes). Reference frame: Grayson's real take if available, otherwise MediaPipe's published canonical face model. Never re-triangulate at runtime (that would flicker).
- **Shading**: per-triangle normal from landmark 3D in stage pixels (x, y, and z scaled like x). Lambert with a fixed light, upper-left front. Mapped onto one gray ramp, charcoal `#2A2D33` to pale `#D9DCE1`. Each triangle is stroked with its own fill color to hide anti-alias seams.
- **Depth order**: triangles sorted back to front by average z each frame.
- **Lips**: triangles between the outer and inner lip rings use the same ramp, offset one step darker.
- Pure module `components/face/lowPoly.ts`: landmarks plus projection in, sorted and shaded triangle list out. No canvas calls.

### Eyes

`renderStylizedEye` unchanged, drawn into the eye holes after the mesh. Blink logic unchanged.

### Mouth drawing

- Open: inner-lip polygon filled `#0B0C0E` (the cavity shows through the hole).
- Closed: inner lip drawn as one seam line through midpoints of paired upper and lower inner-lip landmarks, so no jittery sliver.

### Hands (Phase 4)

- Pure module `components/face/handMesh.ts`.
- Palm: fixed triangle fan over landmarks 0, 1, 5, 9, 13, 17, flat-shaded from its 3D normal.
- Fingers: each bone becomes a tapered quad (two triangles), about 1.3x wider at the knuckle than the tip, width scaled to palm size. Two tones (lit and shade) from the bone's angle to the light.
- Same mirrored image space as the face; always drawn in front of the face.

### Overlays

- Removed: grid, on-canvas SYS.04 HUD badge, nose-tip crosshair.
- Gaze Rays: toggle, off by default, `#EE3B2B`.
- Mocap Dots: toggle, off by default, small white points (the amber brow beads go).
- Camera PiP: unchanged DOM overlay (never in exported video).

### Renderer

`components/face/FaceMeshRenderer.ts` becomes the thin drawing layer: background fill, mesh triangles, eyes, mouth, hands, overlays. Signature takes the frame content (face landmarks, blendshapes, hands) plus `{ showGazeRays, showMocapDots }`, and a target size, so it can draw into the stage or an offscreen canvas.

## Section 3: Export

### UI

- Face Puppet's primary Export button becomes **Video**. Dropdown: Video, Pack (.zip), Full data (.json), Kinematics (.json), Audio.
- `RecorderControls` gains an optional prop for these extra entries; the other demos render exactly as today.
- During export: a progress strip ("Rendering 0:07 / 0:20, keep this tab in front") with Cancel. Record, Play, and scrub are locked.

### Video render pass (`components/face/exportVideo.ts`)

1. Requires a loaded take. Stops live playback.
2. Offscreen canvas at stage aspect, width `min(stageWidth, 1280)`, size locked at export start. Each tick draws the same renderer into it, honoring the current overlay toggles.
3. `offscreen.captureStream(30)`. Audio: a fresh `Audio` element on the take's audio (recorded blob, or the imported take's decoded data URL) goes through `AudioContext.createMediaElementSource` into a `MediaStreamAudioDestinationNode`; its track is added to the stream. Not routed to the speakers.
4. Clock: audio is master; frame = `findFrameIndex(frames, audio.currentTime * 1000)`. No audio: `performance.now()` clock from start. At `durationMs`, stop and download.
5. Format: first `MediaRecorder.isTypeSupported` hit in order `video/mp4;codecs=avc1,mp4a`, `video/mp4`, `video/webm;codecs=vp9,opus`, `video/webm`. Extension follows the chosen type.

`useRecorder` gains a small seam exposing what export needs (frames, `durationMs`, and an audio source: blob or URL plus MIME type). Exact shape decided in the plan after reading `useRecorder.ts`.

### Pack

Runs the same video pass, then zips with `fflate`:

- `puppet.mp4` or `puppet.webm` (stored)
- `recording.json`: the full v3 file from the existing serializer (deflated)
- `audio.webm` or `audio.m4a` etc.: the take's audio (stored)

Downloads as `puppet-take-YYYYMMDD-HHMMSS.zip`.

### Errors

- No `MediaRecorder` video support: clear message, nothing downloads.
- No audio in the take: silent video; pack omits the audio file.
- Cancel: recorder stops, nothing downloads, controls unlock.
- Tab hidden: rAF pauses and export stalls; the strip warns up front. Not treated as failure.
- Export time equals take length (real-time render); the UI says so.

## Section 4: Phasing, testing, verification

### Phases

Each lands on `main` with typecheck, test, build, and smoke green.

1. **Face into `useTracker` + One Euro + mouth ratio.** TDD-001 Phase 3 face-only path; `useFaceTracker` adapter; FaceDemo on `frameRef`; Face Smoothing slider; ratio-plus-hysteresis mouth on the current renderer.
2. **Low-poly restyle.** Topology script and `faceTopology.ts`, `lowPoly.ts`, framing fix, mouth drawing, overlay cut, renderer signature change. First step: confirm Import then Play renders in the preview when MediaPipe init has failed.
3. **Video and Pack export.** `exportVideo.ts`, `fflate`, export menu entries, progress strip with Cancel, `useRecorder` seam.
4. **Hands.** Combined face+hands loop with alternate-tick face policy, `handMesh.ts`, `FrameData.hands`, `channels: ['face', 'hands']`, hands in playback and export.

### Unit tests (vitest, pure modules)

- `oneEuro`: still input settles with jitter suppressed; step input tracked within a bounded lag; lower `minCutoff` means more lag.
- `mouthState`: hysteresis holds inside the band; the same face at 2x scale yields the same state.
- `lowPoly`: all indices in range; no triangle centroid inside an eye or inner-lip hole on the reference frame; back-to-front order; shading monotonic with facing.
- `handMesh`: triangle count; palm fan present; finger width scales with palm size.
- `buildFrame`: face and hands in one frame; face `null` when not requested; face landmarks filtered when a bank is passed.
- `recordingSchema`: `channels` is `['face', 'hands']` only when a frame has hands; v3 round-trip keeps hands; old face-only files load.
- Export: MIME picker order; clock-to-frame mapping; pack contents (unzip with `fflate` in the test, check three entries and names; audio omitted when absent).

### Screenshot proof

- Phases 2 to 4: Import a take JSON in the preview, Play, screenshot the stage. Sent to Grayson.
- Phase 3: export a video in the preview browser. Its Chromium likely lacks H.264, so this proves the WebM fallback. The clip is sent too. MP4 is host-verified.

### Take fixture

- Grayson records a 10 to 20 s face take in real Chrome (Face Puppet, Record, Export, Full) and drops the JSON in the repo root. Uses: topology reference frame, mouth threshold tuning, screenshot fixture.
- That take is face-only. Phase 4 screenshots need a second take with hands in frame, recorded after Phase 1 lands.
- Fallback if no take arrives: canonical face model for topology, and a synthetic take generated from it for screenshots.

### Host verification (added to HANDOFF.md)

- Mouth feel: no flicker at the open/close boundary, seam when closed.
- Face Smoothing slider visibly trades jitter for lag.
- Face + hands combined loop holds 30 fps or better.
- Exported MP4 plays on a phone with audio in sync.
- Pack unzips; `recording.json` re-imports and plays.

## Out of scope

Gesture recognition; square or vertical video; blendshape-driven mouth; Three.js puppet; video export in other demos; moving other demos onto `frameRef` (TDD-001 Phase 4); redeploy (separate, after Phase 4, on Grayson's go).
