# 2026-10-03 (late night): 60 fps camera request and `cam N fps` overlay line, pushed and live

Follows `2026-10-03-debug-overlay-and-60fps-idea.md`, which ended with Grayson's idea (record at the highest frame rate the phone offers) logged but not started. He then asked for the concrete change and, once it was verified locally, to commit, push, redeploy and verify live.

## What was done
- `hooks/useTracker.ts`: `getStream` video constraints now include `frameRate: { ideal: 60 }` next to the 640x480 ideals. The `OverconstrainedError` fallback (retry with plain `video: true`) is unchanged. `statsRef.current.cameraFps` is set from `vTracks[0].getSettings().frameRate` right after the camera opens (also after a front/rear flip), 0 when the browser does not report it.
- `components/shared/trackerStats.ts`: new `cameraFps` field (default 0), test updated. `components/TrackerDebug.tsx`: a new line `cam N fps` (`cam n/a` when 0), under the loop/draw line.
- Verified locally in headless Chromium with a fake camera: `getUserMedia` is called with `frameRate: { ideal: 60 }`; with the first call stubbed to reject `OverconstrainedError` the second call is `{ video: true }` and the camera still comes up with Record enabled. The overlay shows `cam 20 fps` there (the fake device's limit), so **60 fps is unproven on any real device**. Gates: tsc, 550 tests, smoke, phone-check 97/97, facedemo-check 27/27, orbit-check 11/11.
- Committed `7e4d9bb`, pushed (`ee1f6c5..7e4d9bb`), redeployed static (stamp `v0.0.0 🐛 CANNON · 7e4d9b · 2026-10-03`, bundle `index-XDei_cTU.js`, secret gate empty, badge injected, backup `index.html.bak-20261003161604`, 22 stale assets pruned, API untouched, uploads off).
- Verified live: 200, bundle equals local, 40/40 files 200, `/api/health` 200, uploads off, `/t/<id>` 200, stamp present, and a Playwright run on the live URL: constraint sent, fallback works, overlay shows `cam 20 fps` on desktop and phone layouts, zero page errors (proof `.proof/2026-10-03-live5/`, gitignored).

## Caveat and what to read on the phone
A take stores one frame per tracker tick, so 60 fps from the camera only improves capture precision if the tracker loop keeps up; if `loop` stays low the extra camera frames are unused and could add cost. On the phone: `cam 30` means the phone does not offer 60 through the browser; `cam 60` with a low `loop` means throughput is the limit (stagger or skip the cheaper model, lower camera size, worker). If 60 hurts smoothness, make it a setting or lower the request.

## Files
`hooks/useTracker.ts`, `components/TrackerDebug.tsx`, `components/shared/trackerStats.ts` (+test), `HANDOFF.md`.
