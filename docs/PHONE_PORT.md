# Phone port: scope and findings (2026-09-29)

**Status: NOT built. Documentation only.** Left here for whoever next touches this project.
Today the app is desktop Chrome with a webcam, as `NORTH_STAR.md` says ("Not mobile"). If phones become
a goal, remove that non-goal line first, then work this list.

The audit was a code read plus a Chromium run with a fake camera against
https://mocap.graysonchalmers.com at 390x844, 820x600 and 1440x900. iOS Safari and a real rear
camera were NOT tested (Playwright WebKit has no fake camera). Everything marked "unverified" needs
a real phone.

## Verdict per case

| Case | Verdict | Why |
|---|---|---|
| Front camera, Android Chrome | Blocked by layout | Camera and tracker start, but the stage is 0px tall, so nothing is reachable |
| Front camera, iOS Safari | Untested, also blocked by layout | Tracker start on iOS unverified (item 2) |
| Rear camera, either OS | Not offered | Only camera call is hard-coded `facingMode: 'user'`, no flip control |
| Recording, Android Chrome | Unreachable at phone width | Record button is off-screen; the code path itself looks fine |
| Recording, iOS Safari | Partial at best | Same layout block, plus video export and download risks (item 3) |

## What is wrong, in fix order

### 1. Layout collapses at phone width (the blocker)
- `components/FaceDemo.tsx:260` uses `flex flex-col md:flex-row`. The stage is `flex-1`, the sidebar is
  `w-full`. At 390x844 the stage measures 390x0 and the sidebar takes all 844px, so the puppet, the
  PiP preview and the Record/Play/Export panel sit inside a 0-height box. Measured: Record button at
  y = -170, Export at y = -78, taps time out.
- Fix: give the stage a real height on mobile (for example `h-[55dvh] md:h-auto`, line ~300), scroll the
  sidebar (`overflow-y-auto`), and move the recorder into a fixed bottom bar or drawer instead of
  `absolute bottom-8 right-8` with `min-w-[280px]` (it collides with the PiP pinned at `bottom-8 left-8`).
- `App.tsx`: use `h-dvh`, not `h-screen`, so the iOS toolbar does not overshoot.
- Touch targets (measured): hub button 30px, gaze/dots/PiP toggles 37px, LOW/FULL 19px, Export 29px,
  Load JSON 31px, export-format arrow 30x29, sliders 6px tall. Only Record/Play/Stop are 44px. Raise all
  to >= 44px. Nothing is hover-only.
- Hidden camera `<video>` was `paused: true` in 4 of 5 narrow runs. Hypothesis (unconfirmed): Chrome
  pauses a muted autoplay video inside a zero-height clipped container. If true, tracking is dead as
  well as invisible until the layout is fixed. Also call `video.play()` explicitly (`FaceDemo.tsx:309`
  relies on `autoPlay`).

### 2. Camera and tracker (`hooks/useTracker.ts`)
- Line 139-141: `getUserMedia({ video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480} } })`.
  Make `facingMode` an option, add a flip button that restarts the stream. Use `ideal`, never `exact`.
- Lines 104 and 115: both landmarkers use `delegate: 'GPU'` with no fallback. Lines 131-134 show
  "Failed to load hand/face tracking" and never retry. Add GPU-then-CPU fallback.
  Unverified: whether `@mediapipe/tasks-vision` 0.10.9 (pinned) initialises its GPU delegate on current
  iOS Safari. There are reports of iOS trouble; not confirmed here.
- Memory risk (unverified): three or more WebGL contexts live at once (hand landmarker, face
  landmarker, Three.js puppet) plus one for export.
- Lines 154-157: permission denial only sets "Could not access camera." No retry, no Settings hint, no
  `NotAllowedError` vs `NotFoundError` distinction.
- Orientation change is not handled (no resize/orientationchange listener); aspect is re-read from
  `videoWidth/videoHeight` each frame (`FaceDemo.tsx:117`), so it partly self-heals.
- Mirroring is hard-coded: puppet X-mirror in `components/face/projection.ts:33`, PiP `scale(-1,1)` at
  `FaceDemo.tsx:140`, hand left/right labels in `recordingSchema.ts:39-44`. Right for the front camera,
  wrong for a rear camera. Make it conditional on `facingMode`. The PiP is also drawn into a fixed
  192x128 box, which would stretch a portrait frame.

### 3. Recording and export
- A take is a landmark stream (`useRecorder.ts` buffers `FrameData` in a ref), so it is codec-independent
  and fine on iOS. A mic-only `MediaRecorder` runs alongside it (`useRecorder.ts:170-227`), with
  feature detection `audio/webm;codecs=opus`, then `audio/mp4`, then `audio/ogg`. iOS-safe.
- Record calls `getUserMedia({audio:true})` while the camera is live: a second permission prompt
  mid-take. Unverified: some iOS versions may mute or end the camera track when audio is requested.
  Consider asking for camera + mic together on the first tap. If the mic is denied, recording continues
  motion-only (`useRecorder.ts:224-226`).
- Video export (`components/face/exportVideo.ts`) replays the take to an offscreen canvas and records
  `canvas.captureStream(30)` with `MediaRecorder`. `pickVideoMime` (`exportPack.ts:12-21`) prefers
  MP4/H.264 then WebM, with `isTypeSupported` detection: correct for iOS.
- iOS risks (untested):
  - `audioCtx.resume()` and `audioEl.play()` run after `await`s and a 250 ms lead-in
    (`exportVideo.ts:128-130`); Safari may reject them outside a user gesture. The catch falls back to a
    silent export on the wall clock (`:131-135`). Create/resume the AudioContext inside the tap, or gate
    export on its own Start tap.
  - The export runs in real time and needs the tab in front; a screen lock or app switch stalls it.
    Warn, and consider `navigator.wakeLock`.
  - `components/shared/download.ts` uses a programmatic `<a download>` click after a long async chain;
    iOS Safari may ignore it or prompt. Add `navigator.share({ files })` as a fallback, and end the export
    on a visible Save button so the download comes from a fresh tap.
- No API in the codebase excludes iOS (no `showSaveFilePicker`).

### 4. Smaller items
- `index.html:13` loads Tailwind from the CDN at runtime; the page needs network for styling. Replace
  with a build-time install (not phone-specific).
- Remove the "Not mobile" non-goal from `NORTH_STAR.md:61` when phones are in scope. `HANDOFF.md:28` and
  `handoff-log/2026-09-22-face-puppet-overhaul.md:26` already list phone playback and phone exports as
  never verified.

## Verification plan for whoever builds this
1. Fix the layout (item 1), then re-measure at 390x844 with Playwright (chromium touch + webkit) that
   Record/Play/Stop/Export are on-screen and >= 44px.
2. Fake camera in Chromium: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. The fake
   feed has no face or hands, so a take records 0 frames; replay, export and download cannot be
   verified that way.
3. Everything else needs a real iPhone (Safari and Chrome/Edge iOS) and a real Android phone: camera
   start, both cameras, GPU delegate init, memory with several WebGL contexts, the hidden 1px video
   staying alive, the mic prompt not killing the camera, MP4 export with audio, and the download.
4. Update `HANDOFF.md` and the Web-GC portfolio card (`tool-puppeteerlab` says webcam only) once phones
   actually work; until then the card should keep saying desktop webcam.
