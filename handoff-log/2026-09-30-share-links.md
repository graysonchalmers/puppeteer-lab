# 2026-09-30: share links (save a take to the server, 24 h link, private archive)

## What happened
Grayson, after testing on his phone: "record, save the animation to the server, get a link, email it, keep every take for me." Picked up from the stale handoff (default-permissions work was already merged and deployed), grilled the design in 9 questions, wrote spec + plan, executed Tasks 1-6 with Subagent-Driven Development (implementer + task review per task), then a whole-branch review (opus) and one fix wave with a scoped re-review, and a tiny follow-up. Task 7 (deploy) was held for Grayson. Merged to `main` and pushed on his "merge and wrap up".

## Decisions (and why)
1. Upload only on an explicit tap with a disclosure line, never automatic: the take holds face/hand motion and optionally voice, retained forever.
2. One stored file per take, two access paths: private archive kept forever, public link `/t/<id>` for 24 h then "expired". Ids are 128 random bits.
3. Email is phase 2, link only, via Resend. No SMS, no QR. Reason: audio makes files multi-MB; a mail form is a spam relay; a provider needs DNS + a key.
4. Caps (Grayson chose the looser preset): 50 MB, 30 uploads per IP per day. Added after the final review: 1 concurrent upload, `mem_limit: 512m`, 180 s request timeout, streamed reads.
5. Hosting: one small Docker container on apps-01 behind Caddy, same origin as the site, bind-mounted takes dir. Pull-down via `GET /api/admin/takes` + `Pull-Takes.ps1`.
6. Link page has playback + download + expiry (Grayson chose it over a bare download).
7. Removal by contact line; Grayson deletes by hand. `CONTACT_EMAIL` decided later, and the server refuses uploads until it is set.

## What the reviews caught (worth remembering)
- Final review, Critical: one IP could run the 2 GB shared box out of memory (about 210 MB extra RSS per 50 MB upload, unlimited concurrency, public GETs buffered whole files, no `mem_limit`). Fixed with an in-flight cap (503 `busy`), streamed responses, `mem_limit`. The re-review then found the cap of 2 plus 512m could still crash-loop, so the default became 1.
- Important: the start-card copy did not match the spec; rotating a phone unmounted the Save controls and orphaned an in-flight upload (a second tap archived a second copy), fixed by lifting state into `hooks/useSaveLink.ts`; the phone Save flow had never been exercised (WebKit iPhone section + rotation check added to share-check).
- Cheap minors fixed: odd request targets returned 500, `.gitignore` `data/` was unanchored, `/t/` truncated links fell through to the full app, Pull-Takes wrote a BOM and the meta after the json.

## Ruled out / not done
- Rejected as a blocker: iOS focus zoom on the read-only URL input (`index.html` already sets maximum-scale=1); left `text-[11px]`.
- Deferred: IPv6 bucketing, rate-limit slot on failed attempts, Download re-fetching, dev proxy noise, viewer polish.
- Not done: Task 7 deploy; email; anything on a real phone; `docker build` (Docker not installed on this machine).
- Static-only redeploy skipped on purpose: the new start-card copy references a button that would not exist live.

## Verification
typecheck clean; 321+ tests; smoke OK; phone-check 97/97 (needed several runs on a machine short of RAM, no assertion loosened); share-check 28/28 (real server + preview build, Chromium desktop Save->link->viewer->download, WebKit iPhone Save + rotation, admin list, `Pull-Takes.ps1` under Windows PowerShell 5.1). Proof shots in `.proof/2026-09-30-share-links/` (gitignored): 01-05.

## Files
See HANDOFF.md "Changed this session". Per-task reports and the SDD ledger lived in `.superpowers/sdd/2026-09-30-share-links/` (git-ignored scratch).
