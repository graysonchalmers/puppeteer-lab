# 2026-10-03 (night): tracker debug overlay, phone lag report, 60 fps capture idea

Follows `2026-10-03-even-mesh-smoothing-eyes.md`. Grayson tried the live site on his phone and reported lag while recording: smoother with only a face in view, but with a hand in view the face animation suffered. He asked for a debug overlay in the webcam view, then (after trying it) said performance did not seem much better, asked to wrap up, and raised one more idea: record at the highest frame rate the phone offers (60 fps where available) for more precise capture.

## What was done
- Read `hooks/useTracker.ts` and `components/shared/facePolicy.ts`. Hand and face `detectForVideo` run synchronously one after the other in a single rAF tick; when both models run and the loop drops under 30 fps (`avgDt` over 33 ms) the face model runs only on alternate ticks and the previous face is reused (hysteresis: off again above 45 fps). That plausibly halves the face rate exactly when a hand enters view (hand frames cost more). **Hypothesis only, never confirmed on a real phone.**
- Built the overlay (no tracking behavior change): `components/shared/trackerStats.ts` (smoothed per-model ms, face fps, alternation flag, hands/face present, a 60-tick ring), `useTracker` writes them each tick and returns `historyRef`, `components/TrackerDebug.tsx` renders under the INPUT CAM canvas inside the PiP (refresh 4 Hz), DEBUG toggle beside CAMERA PIP in `FaceDemo.tsx` (Controls drawer on phones; `?debug` starts it on). Graph: cyan = face only, magenta = hand in view, dim = face model skipped, white line = 30 fps budget.
- Verified in a real browser (headless Chromium, fake camera, so the numbers there are slow and not phone numbers) on a 1440 desktop and a 390 phone layout, then again against the live URL after deploy. Gates: tsc, 550 tests, phone-check 97/97, facedemo-check 27/27.
- Committed `ba95e76`, pushed, redeployed (static, stamp `v0.0.0 🥭 CHEAP · ba95e7 · 2026-10-03`, bundle `index-Dw-IPPMv.js`, backup `index.html.bak-20261003154907`), verified live (200, bundle match, 40/40 files, API health, overlay in the live chunk, Playwright on the live URL).

## Outcome
Grayson's verdict after trying it: performance did not seem much better. Nothing in this session tried to fix throughput; the overlay only measures. He did not relay the overlay numbers.

## The 60 fps idea (not started)
- Today `getStream` requests `width: { ideal: 640 }, height: { ideal: 480 }` and no `frameRate`, so the browser default applies (usually 30).
- A take records one frame per tracker tick (the measured fps is stored in schema v3). A faster camera only improves capture precision if the tracker loop keeps up; the loop is the suspected bottleneck, so requesting 60 fps could make things worse.
- Plan if the overlay shows headroom: add `frameRate: { ideal: 60 }` to the constraints (the existing `OverconstrainedError` fallback covers refusal), show `track.getSettings().frameRate` in the overlay, check `getCapabilities().frameRate.max` on the phone first (iOS Safari support not confirmed), consider making it a setting.
- If the loop is slow, fix throughput first (stagger or skip the cheaper model, lower camera size, run detection in a worker).

## Files
New: `components/TrackerDebug.tsx`, `components/shared/trackerStats.ts` (+test). Edited: `components/FaceDemo.tsx`, `hooks/useTracker.ts`. Docs: `HANDOFF.md`.
