# 0001: Puppeteer Lab is a demo-first test bed, not a product

Status: accepted (2026-09-06)

## Context

The repo was imported from an AI Studio export on 2026-09-04. Its `PLANNING.md` and `README.md` carried the generator's product pitch: "a zero-hardware spatial tracking and recording framework for games and media" with "Four Core Demos" and per-demo roadmaps listing MIDI/OSC routing, BVH/GLTF transposers, a collaborative WebRTC canvas, and three more games. Two full sessions of quality work were done against that framing.

On 2026-09-06 Grayson stated the actual purpose: a **demonstration for game-development friends** ("you can run motion capture on your hands and use that to control other objects, or save that out") and a **test bed** for trying such ideas. The 2026-09-06 teardown found that the product framing had steered effort toward diagnostic polish and away from the recorder and export, which are the parts the demo most depends on.

## Decision

1. Puppeteer Lab's goal is the one in [NORTH_STAR.md](../../NORTH_STAR.md): prove Track, Drive, and Save with a webcam, live and offline, to a game-dev audience, in ten minutes.
2. Work is prioritized by which of the three verbs it serves and by the demo tour order. The recorder and export (Save) are under-invested relative to their place in the tour and move ahead of any new Drive demo.
3. The five existing demos are the tour. New demo ideas replace a stop or go to the backlog; the tour does not grow.
4. Per-demo `PLANNING.md` files are demoted to unranked idea backlogs. The ordered, gated plan is the root `PLANNING.md`. Items in the backlogs are not scheduled unless the root plan references them.
5. Nothing is claimed on a hub card, in the README, or in a doc until it exists and has been camera-verified in real Chrome.
6. The app must run offline once built. CDN fetches are treated as a defect to remove (TDD-004), not a convenience to keep.

## Considered options

- **Keep the product framing** and keep polishing. Rejected: it produced two sessions of work on a diagnostic view while the on-mission recorder stayed the weakest demo, and it makes the repo read as five products.
- **Strip it down to a single "hand drives an object" demo.** Rejected: the five-stop tour is a good narrative for the audience, and the demos already exist and work. The cost is in the data model and the docs, not in the demo count.
- **Demo-first test bed (chosen).** Keep the demos, converge the core, invest in Save, document the goal so it stops drifting.

## Consequences

- ✅ Sessions have a stated target to check plans against; "does this serve Track, Drive, or Save?" is a one-line gate.
- ✅ The roadmap shrinks to what the tour needs. Effort estimates become honest because the scope is bounded.
- ✅ Friends can be told what the thing is in one sentence.
- ⚠️ Aspirational features in the per-demo backlogs will feel abandoned. They are not deleted; they are unranked. Anyone who wants one promotes it into the root plan with a reason.
- ⚠️ "Offline by default" adds roughly 12 MB of vendored models to the public repo. Accepted; a clone that works on hotel wifi is the point.
- ⚠️ If the goal changes (for example, a friend wants to ship this in a game), this ADR is superseded by a new one and the North Star is rewritten, not edited in place.
