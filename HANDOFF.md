# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-30 (CT)_

## 🎯 Current state
- **Live** ([mocap.graysonchalmers.com](https://mocap.graysonchalmers.com)): `main@c089f16`, Face Puppet as the default load with the tap-to-start camera+mic permission flow (deployed 2026-09-30). Static site only, no API.
- **Merged to `main`, NOT deployed: share links v1** (spec `docs/superpowers/specs/2026-09-30-share-links-design.md`, plan `docs/superpowers/plans/2026-09-30-share-links.md`, ops doc `docs/SHARE_LINKS.md`).
  - Face Puppet gets **Save & get link**: an explicit tap uploads the take (v3 recording JSON: face/hand motion + optional voice) to a small Node 22 server (`server/`, zero npm deps) and returns `/t/<id>`. The link page (`components/TakeViewer.tsx`) plays the take back, offers a JSON download, and shows the 24 h expiry. After 24 h the link says "expired"; the file stays in a private archive forever (never deleted by the app).
  - Caps: 50 MB per take (decompressed), 30 uploads per IP per day, ONE concurrent upload (`MAX_CONCURRENT_UPLOADS`, 503 `busy`), schema validation, storage quota, `mem_limit: 512m`. Uploads are refused (503) until `CONTACT_EMAIL` is set on the server, so the feature cannot go live without a real removal address.
  - Pull to this PC: `scripts/Pull-Takes.ps1` (admin token in `MOCAP_ADMIN_TOKEN`) into `data/takes/` (gitignored).
  - The button hides itself when there is no API, so the merged client is harmless on the current static site.
- **Gates at the last full run:** typecheck clean, 321+ tests, smoke OK, `npm run phone-check` 97/97 (flaky under low RAM: fixed-wait drawer/mic checks; passes on re-run), `npm run share-check` 28/28 (real server + vite preview, Chromium desktop flow, WebKit iPhone Save + rotation, pull script). Docker was not installed where this was built: **the image has never been built.**

## 📌 Where we stopped
Merged and pushed; **Task 7 (deploy to apps-01) is deliberately not done**. It needs Grayson: the `CONTACT_EMAIL` decision, him pasting `ADMIN_TOKEN` / `IP_SALT` / `CONTACT_EMAIL` into `.env.local` on the box, and a Caddy change on the shared server. A static-only redeploy was skipped on purpose: the new start-card copy mentions Save & get link, which would not exist on the live site. **Nothing has run on a real phone** (WebKit under Playwright only).

## ▶️ Next concrete step
1. **Deploy share links (plan Task 7, checklist in `docs/SHARE_LINKS.md`)** with Grayson present: pick `CONTACT_EMAIL`; `mkdir` + `chown 1000:1000 /home/grayson/mocap-data`; tar-over-ssh `server/` to `/home/grayson/apps/mocap-api`; `docker compose up -d --build` (first ever build); Caddy `handle /api/*` (not `handle_path`) + SPA fallback for `/t/*`; redeploy the static site; measure one max-size upload with `docker stats`; then run `Pull-Takes.ps1` once. Offer, do not create, a nightly scheduled task for the pull.
2. Alternative: **real-iPhone run** first (start card, one prompt, Record without a prompt, backgrounding, plus Save & get link, Copy, Share sheet, `?debug` numbers still owed from 2026-09-29).
3. Alternative: **Phase 2 email** (Resend, link only, fixed template, per-IP and per-address limits). Needs an account, verified sender DNS and an API key; plan it after v1 is live.

## ❓ Open questions
- **`CONTACT_EMAIL`** (public removal address): undecided.
- **Is about 2 minutes enough?** The 50 MB cap is roughly at most 150 s of a Face Puppet take (real frames carry about 52 blendshapes plus hands, so the true ceiling is shorter). The client refuses oversize takes with a plain message before uploading. Raise the cap or thin the frames if it bites.
- Nightly pull: register the scheduled task, or pull by hand?
- Real-phone unknowns: iOS Safari decoding an `audio/webm;codecs=opus` take in the viewer, clipboard permission, iOS `audio.currentTime` before metadata, camera/mic behaviour on backgrounding (carried over).
- Phone polish bundle (carried over): `inert` on the closed drawer, visible face counting as activity for idle pause, 390x667 short-viewport case, phone defaults from real fps. Also from 2026-09-22: mesh LOW/FULL, poke-through at strong turns, playback voice offset.

## 🗂️ Changed this session (2026-09-30)
- Branch `claude/animation-recording-server-storage-1562d2`, fast-forwarded into `main`.
- New: `server/` (config, validate, rateLimit, store, app, index, Dockerfile, compose, tests), `components/SaveLink.tsx`, `hooks/useSaveLink.ts`, `components/TakeViewer.tsx`, `components/shared/takeApi.ts`, `takeShape.ts` (+tests), `scripts/share-check.mjs`, `scripts/Pull-Takes.ps1`, `docs/SHARE_LINKS.md`.
- Edited: `App.tsx` (routes `/t/*` to the viewer), `appRoute.ts`, `RecorderControls.tsx` (`footer` slot), `FaceDemo.tsx`, `CameraPanels.tsx` (start-card copy), `vite.config.ts` (`/api` proxy for dev and preview), `vitest.config.ts`, `scripts/phone-check.mjs` (regex `/stays? on this device/i`), `.gitignore`.
- Decisions (+ why): upload only on an explicit tap with a disclosure line (face+voice retained forever needs visible opt-in); one file, two access paths (private archive + 24 h public link); email is phase 2 and link-only (audio makes attachments huge, spam-relay risk); same-origin container behind Caddy (no CORS, same pattern as the other Docker apps); default 1 concurrent upload because a 50 MB take costs about 200 MB of heap and the shared box is 2 GB; SaveLink state lives in `useSaveLink` in FaceDemo so a phone rotation (which remounts the controls) cannot lose or duplicate an upload; `CONTACT_EMAIL` gates uploads server-side.
- Traps: `phone-check` and the machine RAM (kill stray node/vite, run the stale-only reaper); `share-check` binds 8791/4174 and refuses busy ports; the client IP comes from `X-Forwarded-For` (trusted only behind loopback + Caddy); the rate limiter is in memory (restart resets it).
- Deferred minors (not blocking): IPv6 /64 bucketing (no AAAA today), rate-limit slot burned by failed attempts, Download re-fetches the take, viewer keeps base64 audio in state and ignores devicePixelRatio, aria polish, dev proxy log noise.

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
