# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-04 ~23:55 ET_

## 🎯 Current state
Live as a PUBLIC GitHub repo, in sync with `origin/main` at `8c6f889`. Zero-hardware webcam tracking + recording framework (React 18 + R3F + Three 0.167 + `@mediapipe/tasks-vision`), hub of **5 demos** on the shared engine in `components/shared` (`resolveHands` + `useHandRenderLoop`). This session added a quality layer on top of the DebugView split: **CI is live and green** (typecheck -> tests -> build -> smoke on every push/PR), the Global Smoothing panel is one shared component, the last TypeScript error is gone (`tsc --noEmit` clean and gated in CI), a real `resolveHands` bug is fixed, README matches the code, and the demos are code-split so the initial bundle dropped from ~1.27MB to ~163KB. `npm test` = 22 green. Working tree clean, all pushed.

## 📌 Where we stopped
Six commits shipped and pushed (`3f0a6f7..8c6f889`), CI green on each. Wrap-up done. Nothing in flight on disk.

## ▶️ Next concrete step
Real-webcam click-test in actual Chrome, still the only unverified surface (the in-app preview has no camera and no WebGL, so MediaPipe cannot init there): `npm run dev`, open `http://localhost:3000`, allow camera + mic, then (a) in **Air Canvas** draw a line, wave your hand out of frame mid-stroke, confirm it reconnects and relaxes smooth (Line Reliability at BAL/SMTH); and (b) record in **Motion Recorder** and click Export Audio + Export Kinematics, confirm real data. Alternatives:
- Further split the 682KB `useMediaPipe`/Three vendor chunk (the one remaining >500KB warning; it is lazy-loaded now, not in the initial load, so lower priority).
- tsconfig `strict` assessment: real value but a big lift given heavy `any` usage across `types.ts` and the hooks; scope before diving in.
- Bump CI actions/node when GitHub finalizes the Node 20 runtime deprecation (currently a benign annotation only).

## ❓ Open questions
- None pressing. The Node 20 CI annotation is informational (GitHub forces the actions onto Node 24; not fixable from our config, not failing).

## 🗂️ Changed this session
- Branch: `main` · 6 commits pushed (`3f0a6f7..8c6f889`), repo level with `origin/main`.
- Files: `components/shared/{smoothing.ts, SmoothingControl.tsx, smoothing.test.ts}` (new), `components/shared/resolveHands.ts` + `.test.ts`, `components/aircanvas/AirCanvas.tsx`, `components/telemetry/HandTelemetry.tsx`, `types.ts`, `App.tsx`, `README.md`, `.github/workflows/ci.yml` (new), `scripts/smoke.mjs` (new), `package.json`. `.env.local` retired to `_to_delete`.
- Decisions (+ why): CI scoped to CI + smoke only (no deploy: a getUserMedia app needs HTTPS, separate skill; no doc scaffolding: this repo maintains its own baton). Smoke guards the teardown's real secret-leak finding, not just build existence. `resolveHands` partial-handedness fix (an unlabelled hand takes the free side) was surfaced as a decision, not silently applied, since it changes behavior. `canvas: any` removed from the JSX augmentation because it collided with React's real `<canvas>` type (TS2717); R3F uses the capitalised `<Canvas>` component. Demos code-split with `React.lazy` because all five statically imported dragged the whole Three/MediaPipe stack into the initial chunk.

---

## 🕓 Session log
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
