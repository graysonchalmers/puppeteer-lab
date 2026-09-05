# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-04 23:15 ET_

## 🎯 Current state
Live as a PUBLIC GitHub repo, fully in sync with `origin/main`. Zero-hardware webcam tracking + recording framework (React 18 + R3F + Three 0.167 + `@mediapipe/tasks-vision`). The hub now holds **5 demos**: the old fused `DebugView` was split into a clean minimal **Air Canvas** (drawing) and a full **Hand Telemetry** (diagnostics), sitting on a new shared engine in `components/shared` (`resolveHands` + `useHandRenderLoop`). The Air Canvas line now survives tracking dropouts and smooths itself, driven by a new **Line Reliability** slider. The repo now has tests: `npm test` = 16 green (vitest: 11 lineReliability + 5 resolveHands). `npm run build` clean, hub renders zero console errors. Working tree clean, everything pushed.

## 📌 Where we stopped
Full session shipped and pushed (12 commits, `b761889..5cf86a8`): Line Reliability feature, housekeeping (package renamed to `puppeteer-lab`, dead `metadata.json` retired), and the DebugView split (subagent-driven, spec + plan + 8 commits, final Opus review clean). Wrap-up done.

## ▶️ Next concrete step
Real-webcam click-test in actual Chrome (the in-app preview has no camera, so nothing hand-driven is verified yet): `npm run dev`, open `http://localhost:3000`, allow camera + mic, then (a) in **Air Canvas** draw a line, wave your hand out of frame mid-stroke, and confirm it reconnects and relaxes smooth (Line Reliability at BAL/SMTH); and (b) the still-untested export fixes from the prior session, record in **Motion Recorder** and click Export Audio + Export Kinematics, confirm real data. Alternatives:
- Deferred backlog from the split's final review: extract a shared `<SmoothingControl>` (the Global Smoothing block + `1.0 - x*0.9` formula is duplicated across both demos); add a `resolveHands` test for partial handedness (handedness array shorter than the landmark list).
- `project-setup` retrofit: still no CI, no deploy, no smoke harness (though vitest now exists).

## ❓ Open questions
- `.env.local` `GEMINI_API_KEY` is still a placeholder and unused. `metadata.json` (which held the misleading Gemini capability flag) was retired to `_to_delete` this session. Keep the placeholder `.env.local` as harmless scaffolding, or remove it too?
- No CI / deploy. A `project-setup` candidate now that a test suite exists to gate on.

## 🗂️ Changed this session
- Branch: `main` · 12 commits pushed (`b761889..5cf86a8`), repo level with `origin/main`.
- New structure: `components/shared/` (resolveHands + useHandRenderLoop + gestureAnalysis), `components/telemetry/` (HandTelemetry + drawingHelpers + InteractiveObject), `components/aircanvas/` (AirCanvas + pinchTracer + lineReliability + tests). `components/DebugView.tsx` deleted. `types.ts`/`App.tsx`/`DemoHub.tsx` rewired to 5 demos. Docs: `demos/data-visualizer` -> `demos/air-canvas`, `demos/hand-telemetry` added. Spec + plan under `docs/superpowers/`.
- Decisions (+ why): Line Reliability lives in a pure, testable `lineReliability.ts` (forward-only cursor LERP in useMediaPipe cannot heal dropouts; back-smoothing needs a raw+display two-buffer stroke). Split chosen as TWO hub demos, not one decomposed screen (Grayson's call), so it is intentionally not behavior-preserving. Executed on `main` (repo norm) via subagent-driven development. The split incidentally fixed a latent audio bug (toggling an overlay used to silently kill the sound synth in the old DebugView).

---

## 🕓 Session log
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
  - 🟡→🔴 `vite.config.ts` inlined `GEMINI_API_KEY` into the public client bundle via `define` (armed on deploy).
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
