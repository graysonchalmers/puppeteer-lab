# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-30 (CT)_

## 🎯 Current state
- **Live** ([mocap.graysonchalmers.com](https://mocap.graysonchalmers.com), stamp `🌴 LATIN · 9a7593 · 2026-09-29`, `main`): Face Puppet phone layout + front/rear camera + CPU fallback (2026-09-29). Opens on the demo hub. Grayson's first iPhone run: "mostly works"; the camera/microphone permission "seemed a little buggy".
- **Built, gated, NOT merged, NOT deployed** (branch `claude/default-permissions`, worktree `.claude/worktrees/default-permissions`):
  1. **Face Puppet is the default load** (desktop and phone). `?demo=<face|game|aircanvas|telemetry|recorder>` deep-links, `?demo=menu` is the old hub as an overview, `?debug` unchanged. A small "Demos" menu in Face Puppet's header switches demos (phone marks the other four "Desktop recommended"); the build stamp lives in that menu.
  2. **Permission flow rebuilt** (details: `docs/PHONE_PORT.md` last section, `handoff-log/2026-09-30-default-load-permission-flow.md`): nothing is requested on load; a start card explains and one tap sends ONE request for camera + (ticked by default) microphone; Record never asks again; per-error cards with the right next step; "Camera paused" one-tap resume; retry/resume/flip never stack streams. `hooks/cameraAccess.ts` holds the pure logic (33 tests).
- **Gate:** typecheck clean, 245 tests, smoke OK, `npm run phone-check` 97/97 (Chromium fake camera + stubbed rejections, WebKit layout/errors only, desktop). Proof: `.proof/2026-09-30-default-permissions/` (gitignored).

## 📌 Where we stopped
The branch is committed in its worktree only (not pushed). **Nothing has run on a real phone.** WebKit under Playwright has no camera and no `navigator.mediaDevices`, so iOS behaviour is reasoned (list in the handoff-log entry): prompt wording, whether a combined camera+mic request is one prompt, `mute`/`ended` on backgrounding, Settings paths, what `permissions.query` returns on Safari, the OS mic indicator.

## ▶️ Plan: what's next (in order)
1. **Grayson decides two things** (bottom of the handoff-log entry): mic ticked by default in the first prompt or not; whether the other four demos also get a tap-to-start (deep links to them currently prompt immediately).
2. **Merge to `main`, deploy** via the project's deploy path, then re-run the checklist on the iPhone: start card appears, one prompt, Record does not prompt, deny once then follow the blocked steps, background the app for 10 s and return (expect either nothing or the "Camera paused" card), `?debug` numbers (still owed from 2026-09-29).
3. Phone polish bundle (remaining): `inert` on the closed drawer, decide whether a visible face counts as activity for idle pause, 390x667 short-viewport case in `phone-check`, phone defaults from real fps.
4. Phone recording export (PHONE_PORT item 3), self-host Tailwind (item 4), the older owed items (Three.js tuning, video preprocessing), the other four demos on phones. Update the Web-GC card only after phones are verified.

## ❓ Open questions
- Mic default in the first prompt (see above); gating the other demos.
- Idle auto-pause and a visible face; hands-off / LOW-mesh phone defaults (need real numbers).
- Carried over from 2026-09-22: mesh LOW/FULL, poke-through at strong turns, playback voice offset.

## 🗂️ Changed this session (2026-09-30)
- New: `hooks/cameraAccess.ts` (+test), `appRoute.ts` (+test), `components/CameraPanels.tsx`, `components/DemoSwitcher.tsx`, `handoff-log/2026-09-30-default-load-permission-flow.md`.
- Edited: `hooks/useTracker.ts` (gated start, camera-before-models, mic kept aside, track watching, structured issues), `hooks/useRecorder.ts` (shared mic, stale-request guard), `hooks/cameraSupport.ts`, `components/FaceDemo.tsx`, `DemoHub.tsx`, `PhoneBar.tsx`, `RecorderControls.tsx`, `App.tsx`, `scripts/phone-check.mjs`, `docs/PHONE_PORT.md`.
- Decisions (+ why): mic asked with the camera because voice is first-class (NORTH_STAR test b, "Puppet + your voice"); mic track held muted so Stop/flip never re-ask and iOS never sees an audio request while the camera runs; never auto re-prompt when the fault is ambiguous (button instead); "video and voice stay on this device" not "nothing leaves" (Tailwind CDN + deploy badge exist).
- Traps: Playwright WebKit has no `mediaDevices` (gate installs a stand-in only for the stubbed section); the permissions-granted Chromium context skips the start card by design, so the explainer tests use an un-granted context (`--use-fake-ui-for-media-stream` still auto-accepts the tap); `tools/fixtures/` is gitignored, regenerate with `node tools/make-synthetic-take.mjs --hands`.

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
