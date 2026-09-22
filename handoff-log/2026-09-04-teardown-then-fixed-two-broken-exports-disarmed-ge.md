# 2026-09-04 (evening) - Teardown, then fixed two broken exports + disarmed Gemini bundle leak

_Migrated verbatim from the inline HANDOFF.md session log on 2026-09-22._

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
