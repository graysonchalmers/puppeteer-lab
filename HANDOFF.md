# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-10-04 19:05 CT (final wrap-up: slider memory + doc fixes pushed and live at 8f46e98)_

## 🎯 Current state
`main` is pushed and **live** at [mocap.graysonchalmers.com](https://mocap.graysonchalmers.com): `main@8f46e98`, stamp `v0.0.0 🐠 LEAVE · 8f46e9 · 2026-10-04`, bundle `index-DaNVior9.js`, static redeploy 2026-10-04 19:04 (backup `index.html.bak-20261004190422`; the earlier `48bace3` deploy's backup is `index.html.bak-20261004171951`). Verified live: 200, bundle equals local, 40/40 files 200, `/api/health` 200, uploads off, badge present. API container (`mocap-api`) untouched since 2026-09-30, **uploads OFF** (no `CONTACT_EMAIL`).

Shipped this session (Face Puppet speech on the phone; cause and numbers in `docs/TEARDOWN-2026-10-04.md`):
- **Mouth gate** (`components/face/mouthState.ts`): opens on lip ratio > 0.08 **or** raw `jawOpen` > 0.06; closes only when both are shut (< 0.05, < 0.03). Calibrated on Grayson's 2026-09-22 take: 0/236 resting frames open, speaking frames held shut 26/275 -> 0.
- **Lip filter** (`components/shared/oneEuro.ts` `fast` points, wired in `hooks/useTracker.ts` `LIP_FILTER`): lips at 6x minCutoff and dCutoff 2; 4 Hz gain 0.34 -> 0.68 at 30 fps (sim). Head filter unchanged.
- **Cost policy** (`components/shared/facePolicy.ts`): under load the **hands** alternate, the face runs every tick; "load" = `handMs + faceMs` (on > 33 ms, off < 22 ms), not tick interval.
- **One detection per camera frame** (`video.currentTime` dedupe); turns itself off for a stream whose `currentTime` is frozen 500 ms, so tracking cannot stall.
- **Boost defaults 100%** (Brow, Jaw, Blink) in Face Puppet and the share viewer; SPEAKING readout uses the jaw gate.
- **Slider memory** (`components/face/facePrefs.ts`): Face Smoothing and Brow/Jaw/Blink boosts persist per browser in localStorage (`puppeteerlab.face`), so phone tuning survives Safari evicting the tab. Verified: set, reload, value kept.
- **Docs:** README tracking section rewritten to `useTracker` (vendored assets, dedupe, cost policy); stale facts in NORTH_STAR fixed (deleted `useFaceTracker` path, importer exists, preview has WebGL) without changing the goal (that still needs ADR-0002); Blender doc notes Pack exports are a zip. Unused `RecordingSession` type removed.
- **DEBUG overlay** now reads `hand N fps ALT` (ALT = hands halved); `loop` counts real camera frames.

Gates (`48bace3`, rechecked on `8f46e98`: facedemo 27/27, phone 97/97, 557 tests): tsc clean, 555 tests (`recordingSchema` 'under 100ms' timing flake, passes alone), facedemo-check 27/27, orbit-check 11/11, phone-check 97/97 on 4 of 6 runs (misses: once under parallel browser load, once the mic-track check `{"video":1,"audio":0}`, an async path this change does not touch: watch it).

## 📌 Where we stopped
Deployed; waiting on Grayson's phone. Nothing in any gate or harness exercises the lip filter or the dedupe with a real face (playback uses already-filtered landmarks; no agent camera).

## ▶️ Next concrete step
1. **Grayson on the phone:** Face Puppet, DEBUG on (Controls drawer), talk normally. Report `loop`, `hand N fps` + whether `ALT` shows, `hand`/`face` ms, and whether speech reads. If too twitchy: lower Jaw Boost or raise Face Smoothing; if lips jitter, drop `LIP_FILTER.minCutoffScale` (6 -> 4).
2. Alternative: **ADR-0002 + rewrite NORTH_STAR / README / PLANNING** to the phone-first face puppet (draft North Star in the teardown, ⚠️ CONFIRM marks). One hour, fixes the drift every session reads.
3. Alternative: **phone tuning UX**: half-height Controls sheet with Jaw/Smoothing first, a message on an empty take (sliders now persist).

## ❓ Open questions
- North Star: confirm phone-first, audience = anyone with the URL, measure use first (teardown draft).
- Is the mic-track phone-check miss a new flake or pre-existing? (Check against `0af7fd6` if it recurs.)
- `CONTACT_EMAIL` and uploads on; server quota has no retention (about 7 IPs fill 10 GB), default `IP_SALT` is public: fix before uploads go on.
- 60 fps camera: does the phone grant it (`cam N fps`), and does `loop` keep up?
- Carried: Tailwind CDN + song URL still block the offline north-star test; render loop re-steps puppet state every rAF (stage/export EMA drift, recording stores duplicate frames); `useMediaPipe` adapter on 4 demos; FaceDemo.tsx 805 lines; browser gates not in CI; iOS Safari opus audio, touch Orbit near the 100 s cleanup cap.

## 🗂️ Changed this session (2026-10-04)
- Branch `main` (direct-to-main convention). Commits `73dbda8`, `48bace3` + this wrap-up. Files: `hooks/useTracker.ts`, `components/shared/{oneEuro,facePolicy,trackerStats}.ts` (+tests), `components/face/{mouthState,puppetState}.ts` (+tests), `components/{FaceDemo,TakeViewer,TrackerDebug}.tsx`, `docs/TEARDOWN-2026-10-04.md`.
- Decisions (+ why): gate on raw `jawOpen` because MediaPipe computes blendshapes from unsmoothed landmarks (cleaner than the twice-smoothed lip gap); lips-only lighter filter instead of a lower global slider (global would add whole-face jitter on the neon look); hands yield under load because the face drives the puppet; policy reads model cost because with the dedupe a 30 fps camera always ticks ~33 ms apart (the interval rule would have latched ALT on forever: caught in review before push); boosts at max per Grayson (known side effects: teeth go to fully apart almost at once; blink snaps shut on 125 vs 99 of 768 frames).

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
