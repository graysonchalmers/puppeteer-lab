# Share links (server storage)

Face Puppet's **Save & get link** uploads a take to a small API and returns `/t/<id>`, a page that plays the take back and offers the JSON for **24 hours**. Every saved take is kept in a private archive and never deleted by the app. Decisions and rationale: `docs/superpowers/specs/2026-09-30-share-links-design.md`. Thinking, trade-offs and the ordered to-do list: `docs/SHARE_LINKS_ROADMAP.md`.

## Pieces
| Piece | Where |
|---|---|
| API (Node 22, no npm deps) | `server/` (`app.mjs` routes, `store.mjs` files, `validate.mjs`, `rateLimit.mjs`, `config.mjs`) |
| Client | `hooks/useSaveLink.ts` (state, owned by FaceDemo so a phone rotation keeps the link), `components/SaveLink.tsx` (view), `components/TakeViewer.tsx`, `components/shared/takeApi.ts`, `takeShape.ts`, `appRoute.ts` (`isTakePath`, `resolveTakeId`) |
| Container | `server/Dockerfile`, `server/compose.yaml` (loopback port 3017, bind mount `/home/grayson/mocap-data`) |
| Pull to this PC | `scripts/Pull-Takes.ps1` -> `data/takes/` (gitignored) |
| Gate | `npm run share-check` (real server + vite preview + Chromium + WebKit) |

## API
`GET /api/health`, `GET /api/config`, `POST /api/takes` (JSON, optional `Content-Encoding: gzip`), `GET /api/takes/:id` (`?download=1`), `GET /api/admin/takes`, `GET /api/admin/takes/:id/file` (bearer `ADMIN_TOKEN`). Error codes are in `server/app.mjs`. Take files are streamed, never buffered whole; at most `MAX_CONCURRENT_UPLOADS` uploads are read at once and the next gets `503 busy` with `Retry-After: 5`.

## Environment (`server/.env.local` on the box, never committed, never echoed)
`CONTACT_EMAIL` (**required**: uploads are refused while it is empty; shown in the disclosure), `ADMIN_TOKEN` (enables the admin endpoints), `IP_SALT` (**set it**: without it IP hashes use the public default salt and the server warns at startup), and optional overrides `MAX_TAKE_BYTES` (50 MB), `MAX_UPLOADS_PER_IP_DAY` (30), `LINK_TTL_HOURS` (24), `QUOTA_MB` (10240), `MAX_CONCURRENT_UPLOADS` (1; one 50 MB take costs about 200 MB of heap to parse and the compose `mem_limit` is 512m).

Under compose, `PORT` (8787), `HOST` and `DATA_DIR` (`/data`) are fixed in `compose.yaml` (`environment` wins over `env_file`): do not set them in `.env.local`. They matter only for `npm run server` locally.

## Data layout
`<DATA_DIR>/takes/<id>.json.gz` (the recording) and `<id>.meta.json` (`id, createdAt, rawBytes, storedBytes, frames, durationMs, hasAudio, channels, ipHash`). The IP is stored only as a salted hash.

The bind mount must be writable by the container user (`node`, uid 1000) **before the first start**, or every save returns 500: on the box, `mkdir -p /home/grayson/mocap-data` then `sudo chown 1000:1000 /home/grayson/mocap-data`.

## Things to remember
- The take contains face/hand motion and optionally the user's voice. The disclosure beside the button says so; keep it in step with what is stored.
- The client IP is read from `X-Forwarded-For`, trusted only because the container port is bound to `127.0.0.1` behind Caddy. The rate limiter is in memory (a restart resets it).
- To remove a take on request: delete `<id>.json.gz` and `<id>.meta.json` from the data dir on the box, and from `data/takes/` here if it was pulled. Then restart the container: the stored-bytes total (quota) is cached in memory and only recounted at startup.
- Local testing: `npm run server` defaults to `./data`, which is also where `Pull-Takes.ps1` puts pulled takes (`data/takes/`). Point the local server elsewhere, e.g. in PowerShell `Push-Location C:\Projects-local\Tool-PuppeteerLab; $env:DATA_DIR = "$env:TEMP\mocap-data"; npm run server; Pop-Location` (outside the repo), so test takes never mix with real ones.
- `Pull-Takes.ps1` writes `<id>.meta.json` first (UTF-8, no BOM) and moves `<id>.json` into place last, so a present `<id>.json` means the pull of that take finished.
- Not built yet: email the link (phase 2, Resend, link only), self-serve delete, the other four demos, audio-offset sync in the viewer.

## Deploy checklist (Task 7, needs Grayson's go-ahead)
- [ ] Caddy: `handle /api/*` (NOT `handle_path`, which strips `/api` and breaks every route) reverse-proxies to `127.0.0.1:3017`.
- [ ] Caddy: `/t/*` serves the SPA's `index.html` (`try_files {path} /index.html` in the static `file_server` block, or a rewrite), so a shared link opens the viewer instead of a 404.
- [ ] `server/.env.local` on the box has `CONTACT_EMAIL`, `ADMIN_TOKEN` and `IP_SALT` (and not `PORT`/`DATA_DIR`).
- [ ] Port 3017 is free on the box before `docker compose up`.
- [ ] `/home/grayson/mocap-data` exists and is owned by 1000:1000 (see Data layout).
- [ ] `docker compose build` verified on the box: Docker was not available where this was built, so the image has never been built.
- [ ] Measure one max-size (50 MB) upload inside the container (`docker stats`) before announcing; raise `mem_limit` to ~1g if you want `MAX_CONCURRENT_UPLOADS=2`.
- [ ] After start: `GET /api/health` and `/api/config` through Caddy, one real save from a phone, the link opens, `Pull-Takes.ps1` pulls it.

## Deploy record
2026-09-30: deployed to apps-01 dark (uploads off). Container `mocap-api-mocap-api-1`, `127.0.0.1:3017`, app dir `/home/grayson/apps/mocap-api`, data `/home/grayson/mocap-data`, `.env.local` with generated `ADMIN_TOKEN`/`IP_SALT` and empty `CONTACT_EMAIL`. Caddy: `handle /api/*` -> container, `handle /t/*` -> SPA index, default -> static. To enable uploads set `CONTACT_EMAIL` in `.env.local` and `sudo docker compose up -d --force-recreate`. To update the API: `git archive --format=tar HEAD:server | ssh grayson@<host> 'tar -x -C /home/grayson/apps/mocap-api'` then `sudo docker compose up -d --build` (keeps `.env.local`).
