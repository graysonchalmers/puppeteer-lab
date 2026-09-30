# Share links: save a take to the server, get a 24 h link

_2026-09-30. Decided in a grilling round with Grayson; this file is the record. Implementation plan: `docs/superpowers/plans/2026-09-30-share-links.md`._

## Goal
A phone user records in Face Puppet, taps **Save & get link**, and gets a URL they can open or send to their desktop, so nothing has to be saved on the phone. Every saved take is also kept forever on the server as data for Grayson.

## Decisions
| # | Decision | Why |
|---|---|---|
| 1 | **Upload only on an explicit tap**, with a disclosure line beside the button. Nothing uploads automatically. | A take holds face/hand motion and optionally the user's voice; keeping it forever needs a visible opt-in. |
| 2 | **One stored file per take, two access paths.** Private archive (never deleted by the app). The public link `/t/<id>` serves the same file for 24 h, then answers "expired" while the file stays. | Simplest; no duplication. The id is 128 random bits, so links are unguessable. |
| 3 | **Email is phase 2**, via Resend, link only (no attachment), fixed template, rate-limited per IP and per address. v1 has Copy and the phone share sheet. No SMS, no QR. | Audio makes files multi-MB; a spam relay is the main abuse risk; a mail provider needs DNS and a key. |
| 4 | **Caps:** 50 MB per take (decompressed), 30 uploads per IP per 24 h, schema validation before saving, storage quota stop. All env-configurable. | Grayson chose the looser preset. |
| 5 | **Hosting:** one small Docker container on apps-01 (zero npm deps), same origin as the site: Caddy sends `/api/*` to it and serves the SPA for `/t/*`. Takes on a bind-mounted host dir. | Same pattern as the other 7 Docker apps; no CORS. |
| 6 | **Pull-down:** `GET /api/admin/takes` (bearer token) + `scripts/Pull-Takes.ps1` fetches new takes into `data/takes/` (gitignored). Nightly scheduling is Grayson's call. | Server is the only copy until pulled. |
| 7 | **Link page** shows a playback preview (the Face Puppet renderer) plus a Download button and the expiry time. | Grayson chose the richer page over a bare download. |
| 8 | **Removal:** a contact line in the disclosure; Grayson deletes by hand. No self-serve delete in v1. | Keeps "never auto-delete" honest and still gives people a way out. |
| 9 | **Contact address = `CONTACT_EMAIL` server env, not decided yet.** While it is unset the server refuses uploads (503), so the feature cannot go live without a real address. | Grayson said "decide later". |

## Non-goals (v1)
Email, SMS, QR, self-serve delete, accounts, kinematics/other-schema uploads, the other four demos (Face Puppet only), audio-offset sync in the viewer (matches in-app playback).

## Copy that changes
`components/CameraPanels.tsx` "Your video and voice stay on this device." becomes true only if nothing is uploaded, so it now says the video stays on the device and that voice and motion leave only if the user taps Save & get link.
