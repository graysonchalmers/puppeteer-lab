# 2026-09-29: phone port (layout + camera), grilled, built subagent-driven, deployed

## What happened
1. **Pickup.** `docs/PHONE_PORT.md` (written the same day, "not built") said the phone version was unusable: at 390px the Face Puppet stage collapsed to 0px tall.
2. **Grill (6 questions).** Face Puppet only; rear camera in; rear frames normalized at the tracker (later reversed, see below); full-screen stage + bottom bar + Controls drawer; Playwright gate then deploy to mocap then test on the iPhone; measure phone performance before changing defaults.
3. **Plan** (7 tasks) then Subagent-Driven execution with a per-task review: `mirrorFrame`, pure helpers, Playwright gate written first (failed on the bug), phone layout, `useTracker` (facing, CPU fallback, errors, retry), Face Puppet camera UI, docs and gate.
4. **Final whole-branch review (Opus)** found a Critical: rear-camera data was being mirrored, recording a subject's anatomy backwards. Fixed by keeping data raw and mirroring only the live view.
5. **Deploy exposed a bug the gates could not see:** the deploy-time attribution badge covered the phone Controls button. Fixed with a reserved 48px strip, a gate hit-test with a stand-in badge (proved to bite: RED with the old layout), redeployed, verified with the real badge at 390x844 and 390x667.

## Rulings made during execution (cost if wrong)
- Ruling 1: Tasks 1-2 ran sequentially, not parallel (wall clock only).
- Ruling 2: pushed the branch; did not merge/push `main` (deploy was authorized by Grayson).
- Ruling 3: rewrote the co-author trailer on two local commits (message only, trees identical).
- Ruling 4: gate touch-scroll switched to real touch events (a gate defect, not a layout one).
- Ruling 5: split Task 7 so the final review came before the public deploy.
- Ruling 6: rear data stays raw, live view mirrors. **My grill Q3 framing was wrong** (raw geometry is identical front and rear); the intent (no schema change, rear take equals front take of the same performance) is kept and better met.
- Ruling 7: idle pause still ignores a visible face (open question).
- Ruling 8: no `vh` fallback for `dvh`.
- Ruling 9: one residual code minor parked (flip locked after a failed camera open); doc-only corrections done.
- Ruling 10: Task 8 (badge strip) added after deploy.

## Verification
- Gate: typecheck clean, 204 tests, smoke OK, `npm run phone-check` 26/26 (Chromium touch + WebKit + desktop).
- Live: HTTP 200, stamp matches, real-badge hit-test passes, drawer opens on the live site, desktop 320px sidebar unchanged. Screenshots in `.proof/2026-09-29-phone-port/` (gitignored).
- Two-fake-camera flip verified in Chromium (front to rear to front). No real phone, no real face.

## Ruled out / learned
- The gate's fake camera has no face, so it can't verify hand sides, blinks or fps of real tracking.
- `Input.synthesizeScrollGesture` does not scroll here; real touch events do. Chrome resolves `touch-action` up to the nearest scroll container, so `touch-action: none` on the root does not block the drawer.
- Anything injected at deploy time (badge) is invisible to local gates: reserve space for it and simulate it in the gate.
