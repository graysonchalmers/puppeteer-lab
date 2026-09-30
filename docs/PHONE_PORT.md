# Phone port: scope and findings (2026-09-29)

**Status: items 1 and 2 BUILT 2026-09-29 (layout, camera flip, CPU fallback, errors, ?debug readout); NOT yet verified on a real phone. Items 3 and 4 not built.**
**Update 2026-09-30: Face Puppet is the default load, and the camera/microphone permission flow was redone (tap-to-start card, one combined camera+mic request, per-error cards, one-tap resume). Built and gated in Chromium (fake camera) and WebKit (no camera); NOT yet verified on a real phone. See "Permission flow (2026-09-30)" at the end. The audit text below is the original record; where it says Record asks for the microphone, or that errors only say "Could not access camera", that is no longer true for Face Puppet.**
`NORTH_STAR.md` now says phones are supported for Face Puppet only; desktop Chrome with a webcam stays the primary target.
The findings below are the original 2026-09-29 audit (pre-build), kept as the record of what was wrong.

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
- **Built 2026-09-29** (Face Puppet only): full-screen stage on phones (below 768px, `hooks/useIsPhone.ts`),
  a bottom bar with Record/Play/Stop, camera flip and a Controls button (`components/PhoneBar.tsx`), the
  controls panel as a bottom drawer (`components/FaceDemo.tsx`, `index.css`), 44px touch targets at phone
  width (`components/RecorderControls.tsx`), `h-dvh` in `App.tsx`, PiP sized to the real video aspect
  (`components/face/pipSize.ts`), and the Layout gate `scripts/phone-check.mjs` (`npm run phone-check`,
  Playwright chromium touch + webkit + desktop at 390x844 and 1440x900).


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
- SUPERSEDED (2026-09-29): the "wrong for a rear camera / make it conditional on `facingMode`" conclusion
  below does not hold under the final design (see "Built 2026-09-29"). Recorded and tracked data stays RAW
  for both cameras, because MediaPipe sees the same raw geometry front and rear, so the hand `side` labels
  in `recordingSchema.ts` must NOT be made conditional; only the live puppet view and the PiP follow the
  viewfinder on the rear camera. Making the data conditional would re-introduce a data-mirroring bug.
  Original audit text follows for history.
- Mirroring is hard-coded: puppet X-mirror in `components/face/projection.ts:33`, PiP `scale(-1,1)` at
  `FaceDemo.tsx:140`, hand left/right labels in `recordingSchema.ts:39-44`. Right for the front camera,
  wrong for a rear camera. Make it conditional on `facingMode`. The PiP is also drawn into a fixed
  192x128 box, which would stretch a portrait frame.
- **Built 2026-09-29**: `hooks/useTracker.ts` takes a `facing` option (`ideal` facingMode, stream-only
  flip that keeps the models loaded), tries the GPU delegate then the CPU one and reports which
  (`delegate`, shown as a "Compatibility mode" notice on CPU), exposes readable camera errors and a
  `retry()`. Tracked frames stay RAW for both cameras: MediaPipe sees the same geometry from the front
  and the rear camera for a subject facing the lens, so recordings keep one meaning (same schema, same
  hand `side` and blendshape semantics). Only the live view follows the viewfinder: on the rear camera
  the live puppet is mirrored at display time (`viewFrame` in `components/shared/mirrorFrame.ts`, used
  by `components/FaceDemo.tsx`) and the PiP is drawn unmirrored; the recorder always gets the raw frame.
  Pure helpers (facing resolution, error text, delegate fallback) are in `hooks/cameraSupport.ts`; the
  `?debug` readout is `components/DebugReadout.tsx` with `components/shared/fpsMeter.ts`. The Retry
  button, the PiP (mirrored only for the front camera) and the rear-camera view mirroring live in `components/FaceDemo.tsx`.

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

## Host-verification checklist (real phone)

Nothing below is verified until someone runs it on a real iPhone (and ideally a real Android phone).
The Playwright gate (`npm run phone-check`) proves layout only; it has no real camera, GPU or memory
pressure.

1. Open `https://mocap.graysonchalmers.com/?debug` on the iPhone, open Face Puppet, allow the camera.
   Report the debug line (render fps | track fps | delegate | size | front/rear) after 10 s of moving
   your face, and again with hands in view.
2. Tap Controls: sliders draggable, drawer scrolls, Export/Load reachable.
3. In the Controls drawer, tap the Video/Pack export chevron and confirm the format popover is fully
   visible. It opens upward (`bottom-full`) inside the scrolling drawer and may clip at the top of it,
   especially when the take has audio and more options are listed. Report either way.
4. Rear-camera data check: record the SAME gesture (raise your right hand, wink your right eye) once on
   the front camera and once on the rear camera pointed at yourself or another person. Export each take
   (Video/Pack or Full JSON) and confirm the hand `side` labels and the eyeBlink blendshapes in
   recording.json match between the two. The live view on the rear camera should look like the
   viewfinder (not mirrored). Flip back to front afterwards. Compare the exported `recording.json`,
   NOT the live sidebar blendshape readout: on the rear camera the live readout follows the mirrored
   viewfinder, so its Left/Right differs from what is recorded, by design.
5. Deny the camera once (aA > Website Settings > Camera > Deny), reload, confirm the message and Retry
   after re-allowing.
5b. Idle check: keep the app open for over 60 s with no touches while only your face is in view. The
   camera idle-pauses after 60 s (a visible face does not count as activity; hands do). Report whether
   that surprises you.
5c. At 390px wide the CPU "Compatibility mode" notice may wrap and sit under the corner PiP. Report if it
   looks wrong.
6. Rotate to landscape: nothing unreachable. (A landscape phone at 768px wide or more gets the desktop
   layout, see below.)
7. Does the delegate say GPU or CPU? On a phone with a working GPU delegate the debug line should say
   GPU. If it says CPU the app shows a "Compatibility mode" notice; report the fps. Any thermal or
   memory crash within 2 minutes?

Residual risk: a GPU delegate that constructs fine but throws at the first `detectForVideo` call is not
handled. Only a construction failure falls back to CPU.

## Known limitations / deferred

- Phone layout reserves a 48px strip at the very bottom that the app never uses (bar `bottom-12`,
  drawer `bottom-28`, stage `mb-28`). The deploy-time attribution badge (`badge.js`, fixed
  bottom-right, z 9999, roughly 170x28) sits there; without the strip it covers the Controls button
  and the drawer is unreachable. The gate injects a stand-in badge and hit-tests every bar button.
- Landscape phones that are 768px wide or more get the desktop layout (the phone layout is below
  Tailwind's `md` breakpoint), so the side panel and small targets return there.
- Only Face Puppet was ported and gated. The other four demos (Hand Telemetry, Air Canvas, Tempo
  Strike, Motion Recorder) are unverified on phones. Only Face Puppet renders a Retry
  button; the others show tracker errors (now worded without "tap Retry") with no retry control.
- The closed Controls drawer is only moved off-screen (`translate-y-[130%]` + `pointer-events-none`);
  it is still reachable by keyboard and screen reader (no `inert`/`aria-hidden`).
- Tailwind still loads from a CDN at runtime (item 4); the page needs network for styling.
- A GPU delegate that constructs but fails at the first detect call is not handled (see above).
- iOS video export and download (item 3) are not built or verified: `audioCtx.resume()` outside a
  user gesture, real-time export needing the tab in front, and the programmatic `<a download>`.
- Pre-existing, desktop: the header display toggles overlap the sidebar title.
- On a 320px-wide screen the display-toggles row overflows the drawer.
- The export banner is narrow on phones (phone export is out of scope for this port).
- ~~Retry reloads both models even if only the camera failed.~~ Fixed 2026-09-30: a camera-only failure reopens just the stream.
- Flip is not possible after a tablet crosses 768px while on the rear camera (the PhoneBar disappears
  with the phone layout).
- No `vh` fallback for `dvh` on very old browsers.
- ~~If the rear camera fails to open, Flip is disabled.~~ Fixed 2026-09-30: Flip is only locked while a camera request is in flight, so it is the way back to the other camera.


## Permission flow (2026-09-30)

What changed for Face Puppet (other demos still start the camera on load and ask for the microphone on Record):

- **Default load.** `/` opens Face Puppet (no hub). `?demo=<face|game|aircanvas|telemetry|recorder>` deep-links, `?demo=menu` opens the old hub as an overview, `?debug` and other params are kept. A small "Demos" menu in Face Puppet's header switches demos; on a phone the other four are marked "Desktop recommended" (unverified on phones). The build stamp moved into that menu.
- **Nothing is requested on load.** A start card says what is used (camera for tracking; microphone only for recording with sound) and that video and voice stay on the device. One tap on "Start camera" is the user gesture and sends one request: camera and, if the "Record with sound" box is ticked (default on), the microphone in the SAME request, so there is one prompt and no second `getUserMedia` while the camera is live. The camera request goes out before the models load so the prompt appears at once.
- **Skip the card only when no prompt can appear.** `navigator.permissions.query` (guarded; throws or unsupported = unknown) for camera and microphone; the card is skipped only if the camera is granted and the microphone is granted or not wanted. Nothing is stored by the app.
- **Record never asks.** The microphone track is kept aside by `useTracker` (muted until a take records, unmuted on Record, muted again on Stop, survives camera flips, stopped on unmount/idle pause). `useRecorder` borrows it and never stops it. With no microphone the take is motion only and the button title says so. A "Turn on" link (explicit tap, mic-only request) lets someone who unticked the box add sound later.
- **Denied microphone never blocks.** If the combined request fails, `planAudioFallback` decides: missing/busy device or camera-already-granted -> silently retry video-only; camera undecided or unknowable (Safari) -> show the error with a "Continue without microphone" button (no automatic re-prompt); camera denied -> show the error.
- **Errors.** See the matrix in the 2026-09-30 handoff-log entry. Blocked shows per-browser steps (iOS Safari aA > Website Settings, iOS Chrome/Edge via the Settings app, Android Chrome, desktop Chrome/Edge/Firefox/Safari). Insecure and unsupported are caught BEFORE asking.
- **Interruptions.** `ended` on the camera track, or `mute` that lasts over 2.5 s (only after the first frame), moves the tracker to `lost`: a "Camera paused" card with one-tap "Resume camera". An `unmute` brings it back by itself. Checked again on `visibilitychange`, `pageshow` and `orientationchange`. A camera lost mid-take ends the take and keeps it.
- **Re-entrancy.** Retry/resume are ignored while a request is in flight; superseded requests stop their own tracks; the stale error is cleared when a new attempt starts, not when it succeeds.

Verified by `npm run phone-check` (97 checks): Chromium fake camera, stubbed `getUserMedia` rejections, live-track counts. **Playwright WebKit has no camera and, in this build, no `navigator.mediaDevices`**: WebKit sections prove layout, the start card and the error UI only. Everything about how iOS Safari/Chrome/Edge actually behave (prompt wording, whether a mute event fires when backgrounding, whether the mic indicator stays on, what `permissions.query` returns) is reasoned, not observed.

## Save & get link (2026-09-30)

On a phone, Face Puppet's Controls drawer has **Save & get link**: it uploads the take and returns a 24 h link, so nothing has to be saved on the phone (this replaces the need for item 3 for most people). See `docs/SHARE_LINKS.md`. The button is hidden when the site has no API. Untested on a real phone: the Copy button (clipboard permission on iOS) and the share sheet.
