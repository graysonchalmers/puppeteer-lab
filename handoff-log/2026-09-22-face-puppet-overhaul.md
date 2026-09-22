# 2026-09-22 - Face Puppet overhaul: brainstorm, spec, plan, 16 tasks, final review + fix wave, push, redeploy

## Ask
Grayson (`/pickup`): improve the Face Puppet. A fuller low-poly look (keep the eyes and gaze), better mouth tracking ("feels very sloppy"), hands shown so gestures read, and two exports: a shareable video of the animated puppet with the recorded voice, and a "pack" zip (video + animation data + audio). He said the style felt "all over"; the screenshot he mentioned never arrived.

## Diagnosis (from code)
- Mouth open/closed was `mouthOpenDist > 4` in pixels (scale-dependent); face path had zero smoothing; mouth blendshapes were captured but unused.
- Renderer mapped normalized landmarks straight onto canvas w/h, stretching the face on non-4:3 stages.

## Brainstorm decisions (architectural path, one question at a time)
- Hands: visual only (no gesture recognition). Video framing: match the stage, width capped at 1280. Look: faceted solid, mono gray ramp, one accent `#EE3B2B`. Overlays: grid + SYS.04 HUD + nose crosshair removed; Gaze Rays / Mocap Dots toggles off by default.
- Mouth: Grayson picked approach A (filtered landmarks + scale-invariant ratio with hysteresis) over the recommended hybrid (blendshape state).
- Renderer stays Canvas 2D (not Three.js) so playback renders in the camera-less, WebGL-less preview for screenshot proof, and the eye code stays untouched.
- Zip via `fflate`. Spec: `docs/superpowers/specs/2026-09-22-face-puppet-overhaul-design.md` (`e6c03d0`).

## Plan + execution
- Plan `docs/superpowers/plans/2026-09-22-face-puppet-overhaul.md` (`15e9445`): 16 tasks, 4 phases. A planning prototype (Delaunay on the canonical face, SVG render) confirmed the topology approach before the plan was written: 210 verts, 336 tris, clean eye/mouth holes.
- Spec deviations recorded in the plan: hands reuse `FrameData.landmarks`; `capture.smoothing` deferred; `useFaceTracker` deleted (its only consumer moved onto `useTracker`); later accepted: continuous finger shading, two closed-mouth colors outside the palette.
- Subagent-Driven, direct to `main` (haiku for transcription tasks, sonnet for integration + reviewers, opus for final review and the fix wave). Fix rounds that mattered: Task 7 test fixture (degenerate scatter triangles), Task 9 synthetic fixture (canonical face has parted lips at rest; hands hidden under overlays), Task 12 export (draw-throw hang, clip truncation from encoder warm-up).
- Final whole-branch review (opus): "with fixes". Critical: hands only recorded when a face was detected (covering the face is the core gesture); two export hang paths. Important: mic audio starts L ms after frame t0 (export lip-sync), camera aspect not saved with takes, export possible mid-recording, missing combined face+hands test. One fix wave (`4f5e8cc..9d3e455`), scoped re-review all addressed.
- Rulings of note: audio offset corrected in the export only (in-app playback timing in the shared recorder left alone); line-width scaling for downscaled exports and a useTracker ref-hardening deferred; residual "browser never fires onstop" hang accepted.

## Verification
- Gate at HEAD: typecheck clean, 140/140 tests (17 files), build + smoke OK.
- Camera-less browser proof from `tools/make-synthetic-take.mjs` takes: faceted head, closed seam vs open cavity, hands, face-dropout frames (hands only), Video export (H.264 MP4) and Pack zip (`puppet.mp4` + `recording.json`). Stills and clips sent to Grayson.
- NOT verified: real webcam, real mic audio, phone playback, A/V sync with real audio, fps of the combined loop.

## Gotchas found
- The Playwright MCP browser on this machine has live camera access; one of its screenshots captured Grayson's webcam feed (deleted, not shared). The in-app pane has no camera.
- Exports render in real time; a hidden pane or occluded window throttles rAF (9-frame clip from a hidden pane). Verify with the page visible.
- The in-app browser was denied opening the live mocap URL by the auto-mode classifier after deploy.

## Ship
- Pushed `origin/main` `460f8bf..9d3e455` (+ `68ddfa6` HANDOFF). Redeployed `mocap.graysonchalmers.com` (stamp `⚡ CLICK · 9d3e45 · 2026-09-22`, secret gate clean, `/` + `FaceDemo-*.js` 200 over HTTPS).
- Commons logs: `2026-09-22-claude-code-puppeteer-lab-face-puppet-overhaul-spec.md`, `...-face-puppet-overhaul-built.md`, `...-mocap-redeploy-face-puppet.md`. SDD workspace moved to `C:\Projects-local\_to_delete\Tool-PuppeteerLab-sdd-2026-09-22-face-puppet-overhaul\`.
- Wrap-up: migrated the inline HANDOFF session log into `handoff-log/` (one file per dated entry, verbatim).
