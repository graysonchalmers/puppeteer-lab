# 2026-10-03: take cleanup layer and orbit camera (spec, plan, Phases 1 and 2)

## What happened
Grayson asked for two playback features: orbit around a recorded take, and an offline cleanup pass (smoothing plus gap fill). Brainstormed (architectural path), wrote the spec (`0428e73`) and plan (`ae27c46`), then executed all 11 tasks subagent-driven on `main` (implementer + spec/quality review + scoped re-review per task, a whole-branch review on the most capable model, one final fix wave and one scoped re-review). 22 local commits after `225ac42`, not pushed.

## Decisions (and why)
- Cleanup is a playback layer: raw frames are never mutated; export and share upload stay raw. Off by default.
- Size-based hand depth: face landmarks 234-454 (14.5 cm) vs hand 0-9 (9.5 cm), `r = 0.655 * faceSize / handSize` clamped [0.25, 1.3], 0.7 with no face; placement `(cx + r(x-cx), cy + r(y-cy), f(1-r) + r z)`. Default ortho view unchanged.
- Orbit front pose is the capture camera (distance f, fovY from stage height), not the spec's approximate 35 degrees.
- `MAX_GRID_SLOTS` 6000 (100 s), not the plan's 12000: memory estimate showed 12000 was not phone-safe.
- Pitch sign `Euler(-pitch, yaw, 0, 'YXZ')` (plan had +pitch, which lowers the camera); extracted `orbitCamera.ts` with a node test pinning it.
- Gap badge counts events in source time with a 1.75 x dt threshold (the first cut counted 21 resampling holes on a clean real take).
- Orbit gate lives in `orbit-check.mjs` and `facedemo-check.mjs` (viewer with a mocked `/api/takes/<id>`, and Face Puppet playback), not in `phone-check`.

## Traps
- `components/shared/recordingSchema.test.ts` "under 100ms" fails in parallel full runs when RAM is low (reproduced without our changes); run it alone. Reaper first: `. C:\Projects-local\_agent-commons\tools\Stop-NodeHogs.ps1; Invoke-NodeHogReaper -Force`.
- `playwright` was declared but not installed in `node_modules`; `npm install --ignore-scripts` fixed it (lockfile unchanged).
- Browser gates build first and need network (Tailwind CDN); proof lands in `.proof/<date>-*` (gitignored).

## Deferred (all in the SDD ledger, `.superpowers/sdd/2026-10-02-take-cleanup-and-orbit/progress.md`, git-ignored)
`trackHands` free-slot rule; hands over face in orbit; hands behind camera at zoom 0.5; recompute on Stop with pref ON; smoother tail lag; pointer hook: `setPointerCapture` try/catch, 3-pointer pinch, right-click drag; orbit gate has no hand-region diff and `handR[playIdx]` vs `handR[0]` is not caught; WebKit gate uses mouse not touch.

## Not verified
Real iPhone (touch input, memory near the cap, ~1 s synchronous clean), and depth quality on a real take with both a face and hands.
