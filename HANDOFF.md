# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-10-03 (CT)_

## 🎯 Current state
Everything on `main` is pushed and live at [mocap.graysonchalmers.com](https://mocap.graysonchalmers.com) (`main@9032c24`, static redeploy 2026-10-03). The API container (`mocap-api-mocap-api-1`) is up from the 2026-09-30 dark launch and untouched since: `/api/*` and `/t/*` routed, **uploads OFF** (no `CONTACT_EMAIL`).

- **Take Clean up + Orbit (new, live).** Two switches in the share viewer and Face Puppet playback, both off by default. Spec `docs/superpowers/specs/2026-10-02-take-cleanup-and-orbit-design.md`, plan `docs/superpowers/plans/2026-10-02-take-cleanup-and-orbit.md`, user doc `docs/TAKE_CLEANUP_AND_ORBIT.md`.
  - **Clean up** (remembered per viewer): resamples a take, fills dropouts up to 300 ms, zero-phase smoothing; raw frames, exports and share upload stay raw. Takes over 100 s (`MAX_GRID_SLOTS = 6000`) are skipped. The badge counts dropout events in source time (1.75 x dt threshold, calibrated on a real take).
  - **Orbit**: drag / wheel / pinch / double-tap or Reset; yaw +-75, pitch +-40, zoom 0.5-2; capture-pose perspective camera, hands placed by size-based depth (`handDepth.ts`, plausible not metric). Pitch is deliberately `Euler(-pitch, yaw)`, pinned by `orbitCamera.test.ts`.
- **Share links v1** (deployed dark): Face Puppet "Save & get link" uploads a v3 take to `server/` (Node 22, zero deps) and returns `/t/<id>` (24 h public link, private archive forever). Caps: 50 MB, 30 uploads/IP/day, 1 concurrent upload, `mem_limit 512m`. Ops doc `docs/SHARE_LINKS.md`, roadmap `docs/SHARE_LINKS_ROADMAP.md`. Pull archive: `scripts/Pull-Takes.ps1` (`MOCAP_ADMIN_TOKEN`).
- **Gates (last runs):** typecheck clean, 427 tests, smoke, `phone-check` 97/97, `share-check` 28/28, `cleanup-check` 7/7, `orbit-check` 11/11, `facedemo-check` 21/21 (the last three are new; browser gates build first and need network). `components/shared/recordingSchema.test.ts` "under 100ms" is a pre-existing load-sensitive flake: run it alone, run the node-hog reaper first.

## 📌 Where we stopped
Cleanup + orbit built, reviewed, pushed and deployed; live check passed 8/8 with a mocked take (uploads are off, so no real shared link exists to open). Not verified: a real iPhone (touch drag/pinch/double-tap, memory near the 100 s cap, a ~1 s synchronous clean), and depth quality on a real take with both a face and hands.

## ▶️ Next concrete step
1. **Real-iPhone pass on the live site** (start card, one prompt, import or record a take, Clean up, Orbit with touch). It is the biggest open check for the new work and also covers the carried-over phone unknowns.
2. Alternative: **pick `CONTACT_EMAIL` and switch uploads on** (set it in `/home/grayson/apps/mocap-api/.env.local` on the box, then `cd /home/grayson/apps/mocap-api; sudo docker compose up -d --force-recreate`), then one live end-to-end save, phone open, `docker stats` during a big one, and one `Pull-Takes.ps1`. After that real links exist to open Clean up / Orbit on.
3. Alternative: **clean the deferred items** (list below), best first: recompute-on-Stop stall, `trackHands` free-slot rule.

Roadmap with reasoning for the share-link work: `docs/SHARE_LINKS_ROADMAP.md`.

## ❓ Open questions
- **`CONTACT_EMAIL`** (public removal address): undecided.
- Is about 2 minutes enough for a take? (50 MB cap is roughly <= 150 s of Face Puppet; cleanup itself stops at 100 s.)
- Nightly pull: scheduled task or by hand? (`MOCAP_ADMIN_TOKEN` is not set on the PC.)
- Deferred from the cleanup/orbit final review (full list in `handoff-log/2026-10-03-take-cleanup-and-orbit.md`): `trackHands` lacks the spec's free-slot rule for a lone hand; hands always draw over the face in orbit and can pass behind the camera at zoom 0.5; cleanup recomputes after every recording Stop when the remembered pref is ON (consider computing only while playing); smoother segment tails keep a few px of lag; pointer hook gaps (`setPointerCapture` try/catch, 3-pointer pinch, right-click drag); the orbit gates use a mouse, not touch.
- Carried over: iOS Safari decoding `audio/webm;codecs=opus` in the viewer, clipboard permission, camera/mic on backgrounding, phone polish bundle (`inert` closed drawer, 390x667 short viewport, phone defaults from real fps), mesh LOW/FULL, poke-through at strong turns, playback voice offset.

## 🗂️ Changed this session (2026-10-02 to 2026-10-03)
- Branch `main` only (direct-to-main, repo convention). 24 commits after `225ac42` pushed as `9032c24`, plus docs commits.
- New: `components/shared/{series,handTracks,cleanTake,cleanupPrefs}.ts`, `hooks/{useCleanedFrames,useOrbitInput,useTakeDepth}.ts`, `components/PlaybackOptions.tsx`, `components/face/{handDepth,orbitState,orbitCamera}.ts`, `scripts/{cleanup-check,orbit-check,facedemo-check}.mjs`, `scripts/lib/viewer-harness.mjs`, docs (+ tests).
- Edited: `components/{TakeViewer,FaceDemo,RecorderControls}.tsx`, `components/face/{PuppetScene,FaceMeshRenderer,handRig}.ts`, `package.json`.
- Decisions (+ why): cleanup is a playback layer, never mutates raw, exports/upload stay raw; `MAX_GRID_SLOTS` 6000 not 12000 (memory); size-based hand depth (focal length cancels in the hand/face size ratio); orbit front pose = the capture camera (not a fixed 35 degrees) so hands reproject exactly; pitch sign negated for three.js Euler; gap badge counts source-time events (first cut counted 21 resampling holes on a clean real take); the browser gates are separate scripts on a mocked `/api/takes/<id>`, not part of `phone-check`; the static deploy copied new assets first and swapped `index.html` last.
- Traps: see the flake above; `playwright` was declared but not installed (`npm install --ignore-scripts` fixed it); `phone-check` and the machine RAM (reaper: `. C:\Projects-local\_agent-commons\tools\Stop-NodeHogs.ps1; Invoke-NodeHogReaper -Force`); the client IP comes from `X-Forwarded-For` (trusted only behind loopback + Caddy).

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
