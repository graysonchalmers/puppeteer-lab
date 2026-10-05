# 🌟 Puppeteer Lab: North Star

_Rewritten 2026-10-04 from the third teardown's draft, accepted by Grayson. Read this at every pickup. Decision record: [ADR-0002](docs/adr/0002-phone-first-face-puppet.md), which supersedes [ADR-0001](docs/adr/0001-demo-first-test-bed.md)._

## One sentence

Puppeteer Lab is a **phone-first face puppet**. Open a link, allow the camera, and within a minute your face (and hands) drive a stylized puppet you can **record with voice, replay and share as a link**.

## Who it is for

- **Anyone with the URL** ([mocap.graysonchalmers.com](https://mocap.graysonchalmers.com)), on a phone first. No install, no account.
- **Grayson**, as a lab: a place to try tracking ideas without setting up a new project each time.
- **Anyone who wants to lift the tracker core.** The repo stays public; the core (`useTracker`, `components/shared/`) should stay liftable.

## The three verbs (unchanged), in priority order for the phone

| Verb | Means | Today's proof |
|---|---|---|
| **Track** | Turn a camera frame into face (and hand) landmarks and blendshapes that keep **speech-sized motion** without jitter, at the phone's camera rate | `hooks/useTracker.ts`, `components/shared/` (One Euro with lighter lips, cost policy), `components/face/mouthState.ts` |
| **Drive** | Make the puppet read clearly: mouth, brows, blinks, head, hands | Face Puppet (`components/face/`, `PuppetScene`), boosts |
| **Save** | Record with voice, replay, clean up, share as a link, export | `hooks/useRecorder.ts`, schema v3, Clean up / Orbit, share links (`server/`), Video/Pack export |

**Track comes first.** If the puppet does not read on a mid-range phone, no look, mesh or playback feature matters.

## What "done" looks like (the north-star test)

A stranger on a mid-range phone opens the link and:

- (a) allows the camera and sees the puppet follow their face within a minute,
- (b) records a 20-second take with voice whose **mouth and expressions read clearly** without exaggerating, at a **steady 30 fps or better** (DEBUG `loop`),
- (c) taps Save & get link, and
- (d) opens that link on a desktop and watches the take play.

**Status (2026-10-04):** (a) works. (b) is unproven: the mouth/responsiveness pass is live at `48bace3` and waits on real-phone numbers. (c) and (d) need uploads on, which needs a server retention rule and `CONTACT_EMAIL` first. Nothing passes this test end to end yet. The gap is [PLANNING.md](PLANNING.md).

## The lab path (kept working, frozen)

Hand Telemetry, Air Canvas, Tempo Strike, Motion Recorder and the Blender importer (`tools/blender_import_recording.py`). They prove the tracker core on desktop Chrome and stay green in the gates. They get fixes and shared-core refactors, not new features. Their old acceptance check (clone, two commands, export a take, open it in Blender, on hotel wifi) lives in PLANNING as the lab check.

## Principles

- **Phone first.** Design, tune and verify Face Puppet on a real phone (iPhone Safari). Playwright WebKit for automated phone proofs; Chromium hides Safari-only bugs.
- **Track before looks.** No new look, mesh or rendering work ahead of an open tracking or responsiveness item.
- **Measure before adding.** Count visits, takes started and takes saved (cookieless, no camera/audio/landmark data) before growing features.
- **One frame shape.** Every consumer reads the same `TrackedFrame`. Two representations of a hand is how a slider once ended up wired to nothing.
- **Raw stays raw.** Clean up and other playback layers never mutate recorded frames; exports and uploads are the raw take.
- **Consent is a tap.** Nothing leaves the device without an explicit Save & get link; camera video never leaves it at all.
- **Offline by default (target).** Models and WASM ship with the build; Tailwind and the Tempo Strike song still load from CDNs, a known gap.
- **Show, don't claim.** Nothing is claimed in the UI or docs until it works on the device it is for. Automated browsers have WebGL but no real face on camera; they prove layout and playback, not live tracking.
- **Pure math is tested.** Keep the tracking, mouth, cleanup and schema logic pure so vitest covers it; the camera path is verified on a device.

## Non-goals (for now)

- Not real-time, multi-user or collaborative. One-way share links are in; rooms, live streaming and co-editing are out.
- No accounts, no feed, no social layer.
- Not an npm package. If someone asks to lift the core, that is the trigger to publish it, not before.
- No new hand demos and no new lab features (ADR-0002).
- Not MIDI, OSC, BVH or FBX until a specific person needs a specific one.
- Not full-body pose yet.

## How this document is used

- **Read at pickup.** If a session's plan does not make the phone puppet track or read better, help Save/share, or help learn whether anyone uses it, stop and ask why.
- **The roadmap** is [PLANNING.md](PLANNING.md) (ordered, gated).
- **Designs** are in [docs/tdd/](docs/tdd/). **Decisions** are in [docs/adr/](docs/adr/).
- **The session baton** is [HANDOFF.md](HANDOFF.md) (written by `wrap-up`, read by `pickup`).
- **Idea backlogs** are the per-demo `demos/*/PLANNING.md` files: unranked, not commitments.

Change this document only when the goal changes, and record why in a new ADR that supersedes ADR-0002.
