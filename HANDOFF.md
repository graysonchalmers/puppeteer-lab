# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-06 ~03:40 ET_

## 🎯 Current state
Public GitHub repo, `main` level with `origin/main` at `22e77bf` **plus an uncommitted documentation set from this session** (see Changed). Code is unchanged since 2026-09-04: hub of 5 demos, shared engine for 2 of them, CI green (typecheck, 22 tests, build, smoke). This session ran the second teardown against a goal Grayson stated for the first time (a **demo for game-dev friends and a test bed**: track hands with a webcam, drive objects, save it out) and wrote the documentation layer that was missing: `NORTH_STAR.md`, `PLANNING.md` rewritten as the gated roadmap, `docs/adr/0001`, four TDDs, the teardown report, a README reframe, and a fix to the stale Motion Recorder doc.

Teardown verdict: core is sound, keep nearly everything. Three demo-visible defects found with evidence: the Global Smoothing slider does nothing in Air Canvas (it is wired to a ref that demo never reads), the hub promises a timeline scrubber that has no UI, and the old docs described a product rather than the goal. Full report: `docs/TEARDOWN-2026-09-06.md`.

## 📌 Where we stopped
Docs written, gates re-run green on the unchanged code, working tree **not committed** (Grayson had not asked for a commit). Commons log written. Nothing else in flight.

## ▶️ Next concrete step
1. Review and commit this session's docs (`git add -A; git commit; git push`, direct to `main` as usual).
2. Then roadmap item 1: **landmark-level smoothing** in `hooks/useMediaPipe.ts` (TDD-001 phase 1, S). Lerp each of the 21 landmarks against the previous frame's same-side landmarks using the slider's factor before publishing `lastResultsRef`; add `smoothLandmarks.test.ts` pinning the endpoints. Host-verify in real Chrome: Air Canvas `RAW` vs `MAX` visibly differ. Closes teardown F1.

Alternatives (from `PLANNING.md`): item 2 scrubber (S, closes F2, `seekPlayback` already exists) or item 3 vendor MediaPipe assets (S, do this first if a demo date is inside two weeks).

## ❓ Open questions
- Commit these docs as one commit or split (docs vs README)? Suggest one: "Docs: North Star, roadmap, ADR-0001, TDD-001..004, teardown #2".
- TDD-001 pinch gating: smoothed landmarks (default, Option A) or raw for onset (Option B)? Decide on camera after item 1 lands.
- TDD-004: commit the ~12 MB of `.task` models or gitignore + `postinstall`? TDD proposes commit; ADR-0001 accepts the size.
- Still unverified on a real webcam from 2026-09-04: Line Reliability reconnect behaviour and the two export buttons. Fold into the item 1 host check.

## 🗂️ Changed this session
- Branch: `main` · 0 commits · working tree has 9 new/modified files, uncommitted.
- New: `NORTH_STAR.md`, `docs/TEARDOWN-2026-09-06.md`, `docs/adr/0001-demo-first-test-bed.md`, `docs/tdd/TDD-001-tracker-core.md`, `docs/tdd/TDD-002-recording-schema-and-export.md`, `docs/tdd/TDD-003-motion-recorder-upgrade.md`, `docs/tdd/TDD-004-offline-first-assets.md`.
- Rewritten: `PLANNING.md` (product pitch replaced by the ordered roadmap and demo-day bar), `demos/motion-recorder/README.md` (stale "to be created" claims removed).
- Edited: `README.md` (test-bed framing, five demos, Start here, Getting started, How to verify; Technical Guide untouched), `HANDOFF.md`.
- No code changed. One experiment: removed the `types.ts` JSX `any` augmentation, ran `tsc --noEmit` (exit 0), restored the file; recorded as teardown F12 (Kill).
- Decisions (+ why): North Star is "demo-first test bed" (ADR-0001) because Grayson stated it and the product framing had steered two sessions toward diagnostic polish over the recorder. Per-demo `PLANNING.md` files demoted to idea backlogs rather than deleted (additive, Grayson's call to prune). Teardown report committed into `docs/` this time (the 2026-09-04 one lived only in a scratchpad and was lost to the next session) because it is the evidence base for the TDDs. Docs left uncommitted because no commit was requested.

---

## 🕓 Session log
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
