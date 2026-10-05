# 0002: Puppeteer Lab is a phone-first face puppet; the hand demos become the lab path

Status: accepted (2026-10-04, Grayson). Supersedes [ADR-0001](0001-demo-first-test-bed.md).

## Context

ADR-0001 (2026-09-06) made the project a desktop, demo-first test bed: a five-stop tour for game-dev friends who clone the repo, with Face Puppet as stop 5 ("same pattern, different model").

The work since then went somewhere else, at Grayson's direction:

- **Face Puppet became the front door.** He called it "the premiere example" (2026-09-30). The app opens on it by default (`appRoute.ts`), with a tap-to-start permission card.
- **The project went phone-first.** It has a phone layout and rear camera (2026-09-29), a phone-check gate, and he uses it on his iPhone.
- **Takes can be shared.** Share links ship a public `/t/<id>` viewer and a private archive (`server/`, deployed dark 2026-09-30).
- **The looks, mesh and playback layers are all Face Puppet work.** Neon look, Flip then Even mesh, Clean up and Orbit.
- **The hand demos stopped moving.** From 2026-09-17 to 2026-10-04 they got zero commits. Face, take, share and tools paths took about 60% of commits.

The 2026-10-04 teardown ([TEARDOWN-2026-10-04.md](../TEARDOWN-2026-10-04.md)) found three related problems:

- **The docs contradicted the product.** NORTH_STAR listed "networked" as a non-goal and "desktop primary", and PLANNING had not changed in 137 commits.
- **The goal changed without an ADR.** It was edited in place (`e860dfc`), against ADR-0001's own rule.
- **Phone tracking quality had been neglected while looks got the effort.** The trigger was Grayson saying the phone puppet "barely sees my mouth move".

Nothing measures use. The only user on record is Grayson. The repo had 0 views in the 14 days before the teardown.

## Decision

1. **The goal is the one in [NORTH_STAR.md](../../NORTH_STAR.md):** a phone-first face (and hands) puppet. Open a link, allow the camera, and within a minute your face drives a stylized puppet you can record with voice, replay and share.
2. **The audience is anyone with the URL,** not only friends who clone the repo. The live site is the product surface. The repo stays public and liftable.
3. **Track quality on the phone comes before look or mesh work.** No new look, mesh or rendering work goes ahead of an open tracking or responsiveness item in [PLANNING.md](../../PLANNING.md).
4. **The hand demos and the Blender export are the "lab" path.** Hand Telemetry, Air Canvas, Tempo Strike, Motion Recorder and the importer stay working and tested. They get fixes and the shared-core refactors, but no new features unless this ADR is superseded.
5. **Measure use before adding features.** Visits, takes started and takes saved get counted, privacy-respecting and with no personal data, before any new feature work beyond the current PLANNING Now list. The take archive exists to learn what people do with the puppet.
6. **One-way sharing is in scope.** A person can upload one take and get a link others view. Real-time, multi-user or collaborative features remain out. Uploads stay an explicit tap and stay off until the server has a retention/quota rule and a public `CONTACT_EMAIL`.
7. **Verification moves to the phone.** "Camera-verified" now means on a real phone (Grayson's iPhone, Safari) for Face Puppet, and in real desktop Chrome for the lab path. Automated proofs for phone layout use Playwright WebKit.

Carried over from ADR-0001 unchanged:
- one frame shape (`TrackedFrame`);
- offline by default as the target;
- show, don't claim;
- per-demo `demos/*/PLANNING.md` files remain unranked backlogs.

## Considered options

- **Keep ADR-0001 and pull work back to the tour.** Rejected. It describes a product nobody is working on, and it would reverse two months of owner-directed work.
- **Split into two repos** (face puppet app + hand lab). Rejected for now. Both share `useTracker`, `components/shared`, the recorder and the schema. A split would duplicate the core or force a package, and ADR-0001's non-goals rule out publishing one.
- **Drop the hand demos.** Rejected. They work, they are the clearest proof of the tracker core, and freezing them costs little. They are the lab, not dead weight.
- **Phone-first face puppet with a frozen lab path (chosen).**

## Consequences

- ✅ Sessions check plans against a goal that matches what is being built. "Does this make the phone puppet track or read better, or help us learn whether anyone uses it?" is the one-line gate.
- ✅ The responsiveness work (2026-10-04, `48bace3`) is the first item under the new rule, not an exception to it.
- ⚠️ The ADR-0001 north-star test (clone, two commands, export to Blender on hotel wifi) is no longer the success test. It survives as the lab path's acceptance check in PLANNING.
- ⚠️ The new success test needs uploads on to open a take's link on a desktop, so it cannot pass until the server rule and `CONTACT_EMAIL` land.
- ⚠️ Measuring use means adding analytics to a site that has none. It must stay cookieless and must not record camera, audio or landmark data.
- ⚠️ Lab-path features in the backlogs (recorder trail, skeleton replay, the TDD-001 adapter removal) slow down. The adapter removal stays in PLANNING because it simplifies the shared core.
- ⚠️ If the goal changes again (a game wants the tracker, or the hand lab becomes the product), supersede this ADR and rewrite the North Star. Don't edit it in place.
