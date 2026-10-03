# 2026-10-03 (later): pushed main and redeployed the static site

Continues `2026-10-03-take-cleanup-and-orbit.md`. At Grayson's request (`/go-live`) pushed `main` (`225ac42..9032c24`, 24 commits, clean fast-forward) and redeployed the static site to mocap.graysonchalmers.com.

## What was done
Fresh `npm run build`; secret gate on `dist/assets` (`sk-or-`, `AIza`) empty; attribution badge script injected into `dist/index.html`; tar over ssh to `/tmp/mocap-up`; new hashed assets copied in first, `index.html` swapped last (backup `/var/www/mocap/index.html.bak-20261003092722`), stale assets removed, `root:root` + `a+rX`. No Caddy change, no API container change (nothing under `server/` changed), uploads still off.

## Verified live
200 on `/`, live bundle `index-DrayA6Vn.js` equals the local build, every local asset 200, `/api/health` 200, `/api/config` uploads off, `/t/<id>` 200. A Playwright run against the live site with only `GET /api/takes/*` mocked passed 8/8 (Clean up and Orbit present and off, Clean up fills a 200 ms gap and reports it, an Orbit drag moves the camera, no page errors or failed assets). Proof: `.proof/2026-10-03-live/` (gitignored); stills sent to Grayson.

## Why mocked
Uploads are off, so no real shared link exists; the live viewer only renders for a saved take.

## Also recorded
`_agent-commons/state/apps-01-server.md` (2026-10-03 entry), project memory `deploy-live.md`, `HANDOFF.md`.
