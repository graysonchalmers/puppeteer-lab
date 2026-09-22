# 2026-09-04 (late, cont.) - Shared SmoothingControl, CI + smoke, resolveHands fix, types + README + code-split

_Migrated verbatim from the inline HANDOFF.md session log on 2026-09-22._

- Picked up (baton = HANDOFF.md, git clean, level with origin). Grayson chose deferred items 2 + 3 + 4, then two more quality rounds, then wrap.
- Item 2: extracted the byte-identical "Global Smoothing Filter" panel into shared `components/shared/SmoothingControl.tsx` + pure tested `smoothing.ts` (`smoothingToLerp`, `SMOOTHING_PRESETS`); both demos reuse it, dropped unused `Waves` imports. Added the partial-handedness `resolveHands` test, which exposed a latent bug. Commit `6c26e08`.
- Item 3 (project-setup, scoped to CI + smoke only): `.github/workflows/ci.yml` (npm ci -> test -> build -> smoke, Node 20) + `scripts/smoke.mjs` (bundle integrity + secret-leak guard). Commit `522b811`. First CI run green in 21s.
- resolveHands bug FIX on Grayson's go: unlabelled hand takes the free side (falls back to index 0 = right only when neither/both open). Flipped `it.fails` to `it`, added the symmetric case. 22 tests green. Commit `7c22927`, pushed.
- Round 1: removed `types.ts` `canvas: any` (TS2717 collision with React's `<canvas>`); `tsc --noEmit` now clean, so CI gained a Typecheck step + `npm run typecheck`. Commit `69ffc02`.
- Round 2: fixed README `worldZ` snippet drift (old "fake depth from height"; real code is `worldZ = z * 8` hand-size deviation). Commit `96dbb1c`.
- Round 3: code-split the 5 demos with `React.lazy` + `Suspense`; initial bundle ~1.27MB -> ~163KB, per-demo chunks emitted. Browser-verified: hub renders, a demo fetches its chunk on click and mounts via Suspense, no errors. Commit `8c6f889`.
- Item 4: retired dead `.env.local` (only held `GEMINI_API_KEY=PLACEHOLDER_API_KEY`, gitignored, unread by vite.config) to `_to_delete`.
- All 6 commits pushed to `origin/main`, CI green each time. Commons log: `_agent-commons\log\2026-09-04-claude-code-puppeteer-lab-smoothing-extract-ci.md`.
