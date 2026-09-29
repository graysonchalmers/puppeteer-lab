# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-29 (CT)_

## 🎯 Current state
Face Puppet now has a **phone layout and a front/rear camera**, deployed to [mocap.graysonchalmers.com](https://mocap.graysonchalmers.com) (stamp `🌴 LATIN · 9a7593 · 2026-09-29`). The code is merged to `main` (fast-forward, 2026-09-29; the deployed build `9a7593c` is in `main`'s history; later commits are docs only). The branch `claude/puppeteer-lab-mobile-ecc9b4` can be retired.

What's in it (Face Puppet only; the other 4 demos are unverified on phones):
- **Layout (< 768px):** full-screen stage, fixed bottom bar (Record / Play / Flip camera / Controls), slide-up Controls drawer (sliders, display toggles, recorder file ops). A 48px strip under the bar is reserved for the deploy-time attribution badge, which otherwise covers the Controls button. Desktop (>= 768px) is unchanged except the PiP is now aspect-true (192x144).
- **Camera:** `useTracker` takes `facing`; flipping reopens only the stream. GPU delegate falls back to CPU (visible "Compatibility mode" notice). Camera errors are readable, with a Retry button in Face Puppet. Explicit `video.play()`. The stream is now released on unmount.
- **Rear camera design (important):** tracked frames and recordings stay **RAW** for both cameras (MediaPipe sees the same geometry front and rear). Only the live puppet view and the PiP follow the viewfinder on the rear camera (`viewFrame` in `components/shared/mirrorFrame.ts`). Do not mirror data in the tracker; a final review caught exactly that bug.
- **`?debug`** in the URL shows one line: render fps | track fps | delegate | camera size | front/rear | dpr.
- **Gate:** `npm run phone-check` (Playwright: Chromium touch + WebKit at 390x844, desktop 1440x900, stand-in deploy badge). 26/26 pass. Also typecheck clean, 204 tests, smoke OK.

## 📌 Where we stopped
Everything is built, reviewed, merged to `main` and deployed. **Nothing has been tested on a real phone.** Camera start, the GPU delegate on iOS, memory with several WebGL contexts, rear camera facing reports, WebKit finger scrolling and slider drags are all unverified.

## ▶️ Next concrete step
Grayson opens `https://mocap.graysonchalmers.com/?debug` on the iPhone and works through the **host-verification checklist in `docs/PHONE_PORT.md`**, reporting the debug line (render fps | track fps | GPU/CPU | size | front/rear) with face only and with hands in view. Then decide phone defaults (hands-off by default? LOW mesh?) from those numbers.

Alternatives:
- **(a) Phone export/download on iOS** (PHONE_PORT item 3), after the phone camera path is proven.
- **(b) The 2026-09-22 on-camera Three.js tuning** (LOW/FULL, boost defaults) is still owed.

## ❓ Open questions
- Should a visible face count as activity for the idle auto-pause? On a phone with no touches it pauses after 60 s (hands already count).
- Hands-off / LOW-mesh defaults on phones: decide after real numbers.
- Flip button is disabled after a failed camera open (Retry re-requests the same camera; reload returns to front). One-line fix: `flipDisabled={!isCameraReady && !error}`.
- Carried over from 2026-09-22: mesh LOW/FULL choice, eyeball poke-through at strong turns, in-app playback voice offset, Video preprocessing (split out), and the older items listed in `handoff-log/`.

## 🗂️ Changed this session
- Merged to `main` (was branch `claude/puppeteer-lab-mobile-ecc9b4`), 16 commits from `9bf3e49`. Key files: `hooks/useTracker.ts`, `hooks/cameraSupport.ts`, `hooks/useIsPhone.ts`, `components/PhoneBar.tsx`, `components/DebugReadout.tsx`, `components/FaceDemo.tsx`, `components/RecorderControls.tsx`, `components/shared/mirrorFrame.ts`, `components/shared/fpsMeter.ts`, `components/face/pipSize.ts`, `scripts/phone-check.mjs`, `index.css`, `App.tsx`. Plan: `docs/superpowers/plans/2026-09-29-phone-port-layout-camera.md`. NORTH_STAR non-goal narrowed to "Face Puppet on phones".
- Decisions (+ why):
  - **Data stays raw for both cameras.** Same geometry front and rear; mirroring data would record a subject's anatomy backwards.
  - **Reserve a 48px strip for the deploy badge.** The badge is injected at deploy time (fixed bottom-right, z 9999), so no local gate sees it; the gate injects a stand-in of the same size.
  - **Measure before changing phone defaults.** Hence `?debug` and the CPU fallback notice.
  - **Touch-scroll gate uses real touch events** (`Input.dispatchTouchEvent`); synthesized scroll gestures don't scroll in this environment.
- Known flaky test: `recordingSchema.test.ts` "under 100ms" wall-clock perf budget (100-111 ms under load; passes alone). A separate session was started to fix it.

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
