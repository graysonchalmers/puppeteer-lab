# 2026-09-30 (later): share links deployed dark to apps-01, and where to go next

Continues `2026-09-30-share-links.md` (same day, earlier in the session). That file covers the design, build and reviews; this one covers the deploy and the handoff thinking.

## What happened
Grayson said "deploy share links to apps-01" after the merge. Two things had to be asked or decided first:
- **`CONTACT_EMAIL`** (the public removal address): he chose "use a placeholder, keep uploads off". So the whole stack went live **dark**: container up, routes wired, uploads return 503 `uploads-disabled`, `/api/config` says `uploadsEnabled:false`, the Save button stays hidden. Turning it on later is one env edit plus a container recreate.
- **Port:** the planned 3016 was already listening on the box (a Tailscale-bound `llama-tiny` and something on loopback), so the compose file moved to `127.0.0.1:3017` (commit `4b06e56`).

## What was done on the box (all verified)
1. Recon over ssh: docker ps, memory (834 MB available of 1.9 GB), disk (25 GB free), the existing Caddy block, port scan.
2. `git archive --format=tar HEAD:server` piped over ssh (LF-clean, not the CRLF working copy) into `/home/grayson/apps/mocap-api`; `/home/grayson/mocap-data` created (uid 1000).
3. `.env.local` created **on the box** with `openssl rand` values for `ADMIN_TOKEN` and `IP_SALT` and an empty `CONTACT_EMAIL`, mode 600, never printed (only key names with values masked were shown). Reasoning: Grayson would otherwise have had to paste secrets; generating on the box keeps them out of chat and shell history. He reads the admin token himself when he wants the pull script.
4. `sudo docker compose up -d --build`: the first ever build of this image succeeded; health 200; 59 MiB used of 512.
5. Caddy: backup, Python replace of the exact old mocap block (asserted to match exactly once), `caddy validate`, `systemctl reload`. New shape: `encode gzip`, `handle /api/*` reverse proxy, `handle /t/*` with `rewrite * /index.html`, default static.
6. Static site: `npm run build`, secret grep on `dist/assets` empty, badge script injected, uploaded via tar, `index.html.bak-20260930093048` kept, assets dir cleared, chown root and chmod a+rX.
7. Live verification: `/api/health`, `/api/config`, `POST /api/takes` (503), `/api/admin/takes` (401), `/t/<id>` in a real browser shows the not-found state, live bundle name matches local, badge present.

## Decisions (and why)
- Dark launch instead of waiting: the backend costs nothing idle and the Save button hides itself, so shipping everything now makes "turn on" a one-line change. The one wrinkle: the start-card copy already mentions "Save & get link" while the button is hidden. Accepted; true either way.
- Did not enable uploads to test live: it would expose the button with a bogus contact address, and the archive is never deleted, so a test take would live forever. The flow is proven by `share-check` against the same code.
- Did not create the `MOCAP_ADMIN_TOKEN` env var or a scheduled task: those change Grayson's machine, so they are offered, not done.

## Not done / where the next person starts
See `docs/SHARE_LINKS_ROADMAP.md` (ordered list with reasoning) and `HANDOFF.md`. In one line: set `CONTACT_EMAIL`, do one real save on a phone, measure a big upload with `docker stats`, pull the archive and back it up, then decide what to do with the data before building email or anything else.

## Files
Committed to `main` (`4b06e56`, `e510600`, plus this wrap-up commit): `server/compose.yaml`, `docs/SHARE_LINKS.md`, `docs/SHARE_LINKS_ROADMAP.md`, `HANDOFF.md`, this file. Outside the repo: `_agent-commons/state/apps-01-server.md`, `_agent-commons/log/2026-09-30-claude-code-puppeteerlab-share-links-plan.md`, project memory `share-links.md` and `deploy-live.md`.
