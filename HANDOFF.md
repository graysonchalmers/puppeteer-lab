# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-16 ~06:30 ET_

## 🎯 Current state
Public GitHub repo, `main`. Roadmap **Now items 1 through 4 are code-complete and gate-green** (item 4 housekeeping landed in `bcbde1d`: `LICENSE` Apache-2.0, `types.ts` JSX `any` augmentation deleted, stale `lineReliability.ts` comment fixed, hub card "Games" is now "Tempo Strike", `HandTelemetry`/`FaceDemo` sidebar readouts throttled to 10 Hz). Roadmap Now is empty; Next starts with item 5 (`TrackedFrame` + `useTracker`, M, `phased-rebuild`). Earlier the same day: items 1, 2, 3 were code-complete and gate-green (typecheck, 31 tests, build, smoke), plus the portfolio build stamp: landmark-level smoothing (the Global Smoothing slider now acts on what every demo draws), a recorder scrubber with pause/seek/resume and a Stop-to-live button in all three recorder demos, MediaPipe WASM + models vendored under `public/mediapipe/` so tracking starts offline (WASM regenerated on `postinstall`, gitignored; the two `.task` models committed, ~11.5 MB), and a commit-derived build stamp in the hub footer. Docs from 2026-09-06 (North Star, roadmap, ADR-0001, four TDDs, teardown #2) are committed. Executed Subagent-Driven from `docs/superpowers/plans/2026-09-16-now-items-1-3.md` after an adversarial grill of the three TDD phases (grill catches: smoothing anchor is `predictWebcam`, old fingertip lerps would double-smooth, "pause" needed a ref not `isPlaying=false`, `vite/client` types needed for `import.meta.env`).

## 📌 Where we stopped
All commits on `main` and pushed; CI should be green (check). Ledger/workspace deleted. **Nothing hand-driven has been camera-verified**: the preview browser has no camera/WebGL, so items 1 to 3 are proven by gates and mount only.

## ▶️ Next concrete step
**Host verification in real Chrome** (`npm run dev`, allow camera + mic), then tick the demo-day bar in `PLANNING.md`:
1. Air Canvas: set Line Reliability to RAW first, then compare Global Smoothing RAW vs MAX while drawing a slow circle. Expect visible jitter difference. Note pinch-release lag at MAX (TDD-001 Option A vs B call).
2. Hand Telemetry: skeleton and sidebar numbers both calm at SMTH.
3. Motion Recorder: record a take with voice, Play, drag the scrubber (audio should follow within ~50 ms by ear), release (resumes), click Stop (live view, Record enabled). Also scrub from stopped, then Play (resumes from scrubbed time). Export Audio + Kinematics still produce data (unverified since 2026-09-04).
4. Offline: `npm run build; npm run preview`, disable the network adapter (not DevTools Offline, which also blocks the lazy chunks), hard reload, open all five demos.
5. Footer shows the build stamp (`npm run stamp` prints the same one).
6. Hand Telemetry / Face Puppet sidebars still update (at 10 Hz now); React Profiler shows sidebar commits at or under 10 per second.
Then roadmap item 5 (`TrackedFrame` + `useTracker`, TDD-001 P2 to P4, M) via `phased-rebuild`; or item 6 (schema v3 + Blender importer) if the Blender demo matters more than the refactor.

## ❓ Open questions
- TDD-001 pinch gating: smoothed landmarks (Option A, current) or raw for onset (B)? Decide on camera (step 1 above). Convergence at MAX is ~360 ms at 60 Hz, not the ~100 ms the TDD guessed.
- Exported recordings now carry landmarks smoothed at whatever the slider was during capture (documented in `useRecorder.ts`). Fine for a test bed; say so in TDD-002's schema (`capture.smoothing` field) when it lands.
- Parked from final review (see log): two hands mislabelled the same side smooth against each other for a frame (fix in TDD-001 P2 `buildFrame`); keyboard scrubbing does not pause and `step=16` is coarse (TDD-003 P4); CDN URL pin `0.10.9` vs npm pin could drift (CDN mode is opt-in); scrub state machine has no automated tests (needs `@testing-library/react`).
- `v0.0.0` prefix in the stamp comes from `package.json` version; bump or drop the field if it bothers.

## 🗂️ Changed this session
- Branch: `main` · commits `d0abbed` (docs), `a69d3cd` (smoothing), `21f319a` (scrubber), `8c863b1` + `2a38fcf` (vendor assets + atomic download), `68627b9` (build stamp), `121eacc` (final-review fix wave: `isPaused` + `stopPlayback`, CDN flag parse, git-less stamp fallback, `stamp` script), plus this handoff/plan commit.
- New: `hooks/useRecorder.test.ts`, `hooks/mediapipeAssets.ts`, `scripts/vendor-assets.mjs`, `scripts/build-stamp.mjs` + `scripts/build-stamp/` (verbatim from Tool-3dViewer, plus a git-less fallback), `vite-env.d.ts`, `public/mediapipe/models/*.task`, `docs/superpowers/plans/2026-09-16-now-items-1-3.md`.
- Modified: `hooks/useMediaPipe.ts`, `hooks/useFaceTracker.ts`, `hooks/useRecorder.ts`, `components/shared/smoothing.ts` + test, `components/RecorderControls.tsx`, `components/MotionRecorder.tsx`, `components/telemetry/HandTelemetry.tsx`, `components/FaceDemo.tsx`, `components/DemoHub.tsx` (footer stamp), `vite.config.ts`, `package.json` (`postinstall`, `build`, `stamp`), `.gitignore`, `scripts/smoke.mjs` (vendored-asset + stamp probes), `PLANNING.md` (kimodo/motion-bricks idea under Later).
- Decisions (+ why): pause is a ref with `isPlaying` kept true so consumers keep showing playback frames while scrubbing (otherwise the sphere jumps to the live hand under the thumb); a Stop button is the one-click exit from paused playback (final review found scrub-from-stopped stranded the Record button); models committed, WASM not (18 MB regenerable vs 11.5 MB that a clone needs offline); build stamp adopted per the 2026-09-14 portfolio SOP since the build was touched.

---

## 🕓 Session log
### 2026-09-16 (cont.) - Roadmap item 4 housekeeping batch
- Grayson: "run item 4, the housekeeping batch + wrap and push". One implementer subagent from an inline brief, diff reviewed directly by the controller (6 files, mechanical). Commit `bcbde1d`: `LICENSE` (Apache-2.0, matches the SPDX headers), `types.ts` JSX `any` block + unused React import removed (tsc still clean, so R3F's own types were always enough), `lineReliability.ts` header now points at `AirCanvas.tsx drawFrame`, hub Tempo Strike card titled and labelled by name, `setMetrics`/`setBlendshapes` gated to 100 ms. Gates green (typecheck, 31 tests, build, smoke). CI on the previous push was green.
- Wrap-up: this handoff, `PLANNING.md` (item 4 to Done, LICENSE ticked on the demo-day bar), commons log `_agent-commons\log\2026-09-16-claude-code-puppeteer-lab-item4-housekeeping.md`, pushed.

### 2026-09-16 (early) - Grill, plan, and ship roadmap items 1-3 + build stamp (Subagent-Driven)
- Grayson replied "1 + 2 + 3 + 4" to the 2026-09-06 menu: commit docs, then smoothing, vendor assets, scrubber, and grill the TDDs. Committed docs `d0abbed`, pushed.
- Grill (subagent, read-only, against real code): all three phases GO-WITH-CHANGES. Catches folded into the plan: smoothing must live in `predictWebcam` (where `lastResultsRef` is assigned) and the two `lerpVectors` in `processResults` must go or alpha compounds; absent side resets `prev`; rebuild the result object; "pause" cannot be `isPlaying=false` (consumers switch to live feed), so a `pausedRef`; scrub-from-stopped must enter paused playback; `duration<=0` loop spam guard; `import.meta.env` needs `vite/client` types; WASM is 4 files/18 MB (gitignore, regenerate), models ~11.5 MB (commit); offline gate must use `vite preview` + adapter off since DevTools Offline blocks lazy chunks.
- Plan `docs/superpowers/plans/2026-09-16-now-items-1-3.md` (4 tasks). Subagent-Driven: fresh implementer + reviewer per task; Task 3 had one fix round (atomic model download + content-length check); final whole-branch review (Opus) found one must-fix (scrub-from-stopped left `isPlaying+paused` with Record disabled and no exit) fixed in `121eacc` with `isPaused` state + `stopPlayback` + Stop button; four lows fixed in the same wave; four parked with rulings (above).
- Gates green at HEAD: typecheck, 31 tests, build, smoke (now also asserts the six vendored files and the stamp in a JS asset). Dev-server network check: all `/mediapipe/...` requests from localhost 200, zero CDN requests.
- Commons log: `_agent-commons\log\2026-09-16-claude-code-puppeteer-lab-now-items-1-3-shipped.md`. Idea file: kimodo/motion-bricks note recorded under Later (resolution line appended).

### 2026-09-06 (early) - Teardown #2 against the stated goal, North Star, roadmap, four TDDs (docs committed 2026-09-16 as `d0abbed`)
### 2026-09-06 (early) - Teardown #2 against the stated goal, North Star, roadmap, four TDDs
- `/pickup` (baton = HANDOFF.md, git clean, level with origin, gates green) then `/teardown`. Grayson's framing this session: a demo for game-dev friends ("you can run motion capture on your hands and use that to control other objects, or save that out") and a test bed; asked for next steps, TDDs, and North Star docs.
- Read every source file (about 6,000 lines across 32 files), all docs, both prior commons logs, the split spec. Verified claims rather than trusting them: `grep seekPlayback` (no caller), `git ls-files` (no LICENSE), tsc without the JSX augmentation (passes), dist chunk sizes, runtime CDN URLs.
- Findings, ranked: 🔴 F1 Air Canvas Global Smoothing is a no-op (`AirCanvas.tsx:47` reads `lastResultsRef` raw; smoothing applies only to `handPositionsRef`); 🔴 F2 hub card promises a scrubber (`DemoHub.tsx:436`) with no UI; 🔴 F3 North Star was AI product copy. 🟡 F4 two copy-pasted tracker hooks, engine covers 2 of 5 demos, three rAF loops, two skeleton tables; F5 four runtime CDNs; F6 camera-rate `setMetrics`/`setBlendshapes`; F7 face export is 40 MB+ pretty-printed on the main thread; F8 Motion Recorder is the on-mission demo and the weakest; F9 export undocumented, no importer; F10 stale docs; F11 no LICENSE with Apache headers. 🔵 F12 JSX `any` catch-all is dead; F13 three naming systems; F14 per-demo roadmaps are wish lists; F15 `DEMO_CHART` mutable singleton; F16 steelmans that survived (Tempo Strike, Telemetry, superpowers docs, CI).
- Wrote: `docs/TEARDOWN-2026-09-06.md` (Rebuild Question, findings, verdict table, v2 sketch, one change first = F1 fix), `NORTH_STAR.md` (three verbs Track/Drive/Save, five-stop tour, done-test, principles, non-goals), `docs/adr/0001-demo-first-test-bed.md`, `docs/tdd/TDD-001` (tracker core + `TrackedFrame`, 5 phases), `TDD-002` (schema v3, worker export, Blender importer), `TDD-003` (scrubber, trail, skeleton replay), `TDD-004` (vendor MediaPipe, build-time Tailwind, synthesized beat, smoke probe), `PLANNING.md` (Now/Next/Later with gates, demo-day bar, reorder rule if a date is close), README reframe, `demos/motion-recorder/README.md` fix.
- Gates re-run: typecheck clean, 22 tests green, build + smoke OK (code unchanged).
- Not committed (no request). Commons log: `_agent-commons\log\2026-09-06-claude-code-puppeteer-lab-teardown-2-northstar-tdds.md`.

### 2026-09-04 (late, cont.) - Shared SmoothingControl, CI + smoke, resolveHands fix, types + README + code-split
- Picked up (baton = HANDOFF.md, git clean, level with origin). Grayson chose deferred items 2 + 3 + 4, then two more quality rounds, then wrap.
- Item 2: extracted the byte-identical "Global Smoothing Filter" panel into shared `components/shared/SmoothingControl.tsx` + pure tested `smoothing.ts` (`smoothingToLerp`, `SMOOTHING_PRESETS`); both demos reuse it, dropped unused `Waves` imports. Added the partial-handedness `resolveHands` test, which exposed a latent bug. Commit `6c26e08`.
- Item 3 (project-setup, scoped to CI + smoke only): `.github/workflows/ci.yml` (npm ci -> test -> build -> smoke, Node 20) + `scripts/smoke.mjs` (bundle integrity + secret-leak guard). Commit `522b811`. First CI run green in 21s.
- resolveHands bug FIX on Grayson's go: unlabelled hand takes the free side (falls back to index 0 = right only when neither/both open). Flipped `it.fails` to `it`, added the symmetric case. 22 tests green. Commit `7c22927`, pushed.
- Round 1: removed `types.ts` `canvas: any` (TS2717 collision with React's `<canvas>`); `tsc --noEmit` now clean, so CI gained a Typecheck step + `npm run typecheck`. Commit `69ffc02`.
- Round 2: fixed README `worldZ` snippet drift (old "fake depth from height"; real code is `worldZ = z * 8` hand-size deviation). Commit `96dbb1c`.
- Round 3: code-split the 5 demos with `React.lazy` + `Suspense`; initial bundle ~1.27MB -> ~163KB, per-demo chunks emitted. Browser-verified: hub renders, a demo fetches its chunk on click and mounts via Suspense, no errors. Commit `8c6f889`.
- Item 4: retired dead `.env.local` (only held `GEMINI_API_KEY=PLACEHOLDER_API_KEY`, gitignored, unread by vite.config) to `_to_delete`.
- All 6 commits pushed to `origin/main`, CI green each time. Commons log: `_agent-commons\log\2026-09-04-claude-code-puppeteer-lab-smoothing-extract-ci.md`.

### 2026-09-04 (late) - Line Reliability feature, housekeeping, then the DebugView split
- Picked up, then brainstormed a feature Grayson raised (make the Air Canvas line reliable). Classified bounded, built TDD: new pure `components/aircanvas/lineReliability.ts` (densify sparse points, velocity-predicted `bridgeGap` across dropouts with a plausibility gate, `resampleAndSmooth`, `relaxToward` easing, `reliabilityParams` slider mapping) + 11 vitest tests. Strokes became two-buffer (raw + easing display); the brittle commit-on-drop capture became a grace-window state machine; added one "Line Reliability" slider. Commit `b59ae71`.
- Housekeeping (teardown Kill list): renamed package `hand-tracking-demo-v08` -> `puppeteer-lab`; retired unreferenced `metadata.json` (AI Studio artifact with the misleading Gemini flag) to `_to_delete`. Commit `dc3f0c4`.
- Split `DebugView.tsx` (architectural): brainstorm -> spec (`docs/superpowers/specs/2026-09-04-debugview-split-design.md`) -> plan (`docs/superpowers/plans/2026-09-04-debugview-split.md`) -> subagent-driven execution, 7 tasks, fresh implementer + task review each, final Opus whole-branch review. Result: shared engine (`resolveHands` pure+tested, `useHandRenderLoop`), minimal `AirCanvas`, full `HandTelemetry`, DebugView deleted, hub at 5 cards, naming unified, docs renamed. Commits `1e78580..54b0d30`; final review found one stale-docs blocker (renamed folder kept old content), fixed in `5cf86a8`. Browser-verified: 5 cards, both demos mount, no app errors.
- Pushed all 12 commits to `origin/main`.
- Commons log: `_agent-commons\log\2026-09-04-claude-code-puppeteer-lab-line-reliability.md`.

### 2026-09-04 (evening) - Teardown, then fixed two broken exports + disarmed Gemini bundle leak
- Ran `/pickup` (baton = HANDOFF.md, git clean, level with origin) then `/teardown` as queued.
- Teardown report (saved to scratchpad, sent to Grayson, NOT committed): verdict "fundamentally sound, keep nearly everything." Headline findings, all evidence-backed:
  - 🔴 Audio export threw `ReferenceError: audioBlobRef is not defined` (`useRecorder.ts`): ref used, never declared.
  - 🔴 Kinematics export ("mocap for Blender/Maya/Unity") read a non-existent `f.handLandmarks` and omitted `leftHand`/`rightHand`, so Motion Recorder's world-space mocap was silently dropped.
  - 🟡->🔴 `vite.config.ts` inlined `GEMINI_API_KEY` into the public client bundle via `define` (armed on deploy).
  - 🟡 `DebugView.tsx` is two products fused (NASA-style diagnostic panel + consumer "Air Canvas" demo) = root of the 6-names-for-one-feature chaos (mode `debug` / `DebugView` / folder `data-visualizer` / hub label "Air Canvas").
  - 🔵 misc: README `worldZ` snippet drifted from code; `tsconfig` has no `strict`; `metadata.json` + `hand-tracking-demo-v08` name are AI Studio leftovers.
- Fixed all three (bugs + Gemini) on Grayson's go. Verified: typecheck clean bar one pre-existing unrelated error (`types.ts:115` `canvas: any`, build ignores it); `npm run build` passes; placeholder key confirmed absent from the built bundle.
- Committed as `161bd29`, then pushed along with the handoff (`328d635`) once Grayson said "push it".
- Follow-on: looked into the moderate Dependabot alert GitHub flagged on push. It was `uuid` <11.1.1 (GHSA-w5hq-g745-h8pq), transitive via `@react-three/drei@9.112.0`. Real risk near zero (exploit needs a custom undersized `buf`; our code never calls uuid), but the fix was a non-major bump to drei 9.122.0. Applied, verified (`npm audit` clean, build passes, hub renders zero-error), committed `5e4f207`, pushed. Repo in sync.
- Commons log: `_agent-commons\log\2026-09-04-claude-code-puppeteer-lab-teardown-and-export-fixes.md`.

### 2026-09-04 (earlier) - Import, local verify, public GitHub repo
- Found `puppeteer-lab.zip` (211 KB) in Downloads, extracted to `C:\Projects-local\Tool-PuppeteerLab`.
- `npm install` (151 pkgs, clean), Vite dev on :3000, hub renders, zero console errors.
- `git init` + initial commit; created PUBLIC repo `graysonchalmers/puppeteer-lab`, renamed branch to `main`, pushed (HTTPS via gh credential helper after SSH publickey failed).
- Node-process cleanup requested: diagnosed as NOT a pileup (0 provably orphaned; bulk is 47 live MCP servers). Only stopped my own puppeteer-lab dev server.
- Verified no `.env.local` / `node_modules` / secrets in the tracked tree (40 files).
