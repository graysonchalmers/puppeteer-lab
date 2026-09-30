# Share links (server storage)

Face Puppet's **Save & get link** uploads a take to a small API and returns `/t/<id>`, a page that plays the take back and offers the JSON for **24 hours**. Every saved take is kept in a private archive and never deleted by the app. Decisions and rationale: `docs/superpowers/specs/2026-09-30-share-links-design.md`.

## Pieces
| Piece | Where |
|---|---|
| API (Node 22, no npm deps) | `server/` (`app.mjs` routes, `store.mjs` files, `validate.mjs`, `rateLimit.mjs`, `config.mjs`) |
| Client | `components/SaveLink.tsx`, `components/TakeViewer.tsx`, `components/shared/takeApi.ts`, `takeShape.ts`, `appRoute.ts` (`resolveTakeId`) |
| Container | `server/Dockerfile`, `server/compose.yaml` (loopback port 3016, bind mount `/home/grayson/mocap-data`) |
| Pull to this PC | `scripts/Pull-Takes.ps1` -> `data/takes/` (gitignored) |
| Gate | `npm run share-check` (real server + vite preview + Chromium + WebKit) |

## API
`GET /api/health`, `GET /api/config`, `POST /api/takes` (JSON, optional `Content-Encoding: gzip`), `GET /api/takes/:id` (`?download=1`), `GET /api/admin/takes`, `GET /api/admin/takes/:id/file` (bearer `ADMIN_TOKEN`). Error codes are in `server/app.mjs`.

## Environment (`server/.env.local` on the box, never committed, never echoed)
`CONTACT_EMAIL` (**required**: uploads are refused while it is empty; shown in the disclosure), `ADMIN_TOKEN` (enables the admin endpoints), `IP_SALT`, and optional overrides `MAX_TAKE_BYTES` (50 MB), `MAX_UPLOADS_PER_IP_DAY` (30), `LINK_TTL_HOURS` (24), `QUOTA_MB` (10240), `PORT`, `DATA_DIR`.

## Data layout
`<DATA_DIR>/takes/<id>.json.gz` (the recording) and `<id>.meta.json` (`createdAt, rawBytes, storedBytes, frames, durationMs, hasAudio, channels, ipHash`). The IP is stored only as a salted hash.

## Things to remember
- The take contains face/hand motion and optionally the user's voice. The disclosure beside the button says so; keep it in step with what is stored.
- The client IP is read from `X-Forwarded-For`, trusted only because the container port is bound to `127.0.0.1` behind Caddy. The rate limiter is in memory (a restart resets it).
- To remove a take on request: delete `<id>.json.gz` and `<id>.meta.json` from the data dir on the box, and from `data/takes/` here if it was pulled.
- Not built yet: email the link (phase 2, Resend, link only), self-serve delete, the other four demos, audio-offset sync in the viewer.
