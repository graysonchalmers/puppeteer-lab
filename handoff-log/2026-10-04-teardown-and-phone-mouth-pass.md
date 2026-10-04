# 2026-10-04 - Teardown #3 + phone mouth/perf pass (pushed and live)

**Ask (Grayson):** pickup, teardown, and a performance pass: on the phone the mouth barely moves unless movements are big, feels low frame rate; "maybe default the boosts all turned up".

**Teardown:** five lens subagents (Strategist+Reach, UX on the live site, Engineer+Red team, Architect+Simplifier, Maintainer+Newcomer+Economist). Report `docs/TEARDOWN-2026-10-04.md`. Headline: plumbing healthy; product drifted to a phone-first face puppet with no ADR; nothing measures use; Track tuning frozen since 09-22 while effort went to looks/mesh.

**Root cause of the complaint (three stacked attenuators):**
1. Mouth gate read only the lip gap on smoothed landmarks (open > 0.08); teeth and Jaw Boost were gated off below it.
2. Face One Euro (0.5 Hz / beta 40 / dCutoff 1, absolute coords) passed ~0.34 of 4 Hz lip motion at 30 fps (0.27 at 15); MediaPipe also smooths internally (lens-sourced from the 0.10.9 graph), blendshapes are computed from unsmoothed landmarks.
3. Cost policy halved the face, not the hands, under load; tracker detected every rAF even without a new camera frame.

**Fixes:** jawOpen second open path (0.06/0.03, calibrated on the 09-22 take: resting jawOpen 0.005-0.02); lips-only lighter filter (6x minCutoff, dCutoff 2; per-landmark temp arrays removed); hands alternate under load; `currentTime` dedupe with a frozen-clock fallback; boosts 100%; SPEAKING readout on the jaw gate; overlay labels.

**Caught before push:** the advisor review found that the dedupe made the interval-based policy latch ALT on for every 30 fps camera (interval floor = camera period ~33 ms, off threshold 22 ms unreachable). Policy now reads model cost. Also found in new-headless Chromium: fake camera `currentTime` stays 0 forever, which would have stalled tracking; added the 500 ms fallback (verified: loop 60, no ALT at 12 ms cost on the real GPU).

**Ruled out / deferred:** lowering the global smoothing slider (whole-face jitter); `numFaces: 2` to disable MediaPipe smoothing (runs the detector every frame); requestVideoFrameCallback, worker, tasks-vision upgrade, render-only-on-new-frame, FaceDemo split (teardown verdicts for later).

**Proof:** `.proof/2026-10-04-mouth/mouth-before-after.png` (live old vs local new, same real take, same frames: brows lift more, teeth part at 11.6 s). Live overlay read via Playwright after deploy.

**Gates:** tsc, 555 tests, facedemo 27/27, orbit 11/11, phone-check 97/97 on 4 of 6 runs (one mic-track miss, untouched path).

**Deploy:** pushed `0af7fd6..48bace3`; static redeploy to apps-01 (`/var/www/mocap`, backup `index.html.bak-20261004171951`, stale assets pruned, root:root a+rX); live verified.
