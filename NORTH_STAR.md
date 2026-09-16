# 🌟 Puppeteer Lab: North Star

_Written 2026-09-06 from Grayson's own framing. Read this at every pickup. Decision record: [ADR-0001](docs/adr/0001-demo-first-test-bed.md)._

## One sentence

Puppeteer Lab is a **test bed** that proves, live and offline, that a plain webcam is enough to **motion-capture your hands** (and face), **drive things** with the result, and **save the performance out** in a form another tool can open.

## Who it is for

- **Grayson**, as a lab: a place to try tracking ideas without setting up a new project each time.
- **Game-dev friends**, as a ten-minute demo: "look what you can do with zero hardware."
- **Anyone who wants to lift the tracker core** into their own project. Not a library yet; should be liftable.

## The three verbs

Everything in the repo serves one of these. A feature that serves none is backlog, not roadmap.

| Verb | Means | Today's proof |
|---|---|---|
| **Track** | Turn a webcam frame into hand (and face) landmarks with confidence, handedness, and world-space positions, smoothly | `hooks/useMediaPipe.ts`, `hooks/useFaceTracker.ts`, `components/shared/` |
| **Drive** | Make something respond to the tracked frame: a line, a saber, a puppet, a cube | Air Canvas, Tempo Strike, Hand Telemetry's cube, Face Puppet |
| **Save** | Record the frame stream with audio, replay it, export it, open it somewhere real | `hooks/useRecorder.ts`, Motion Recorder, Face Puppet replay |

## The demo tour (the order to show it in)

1. **Hand Telemetry**: "this is what the camera sees." Skeleton, confidence gate, distances, the sliders. Establishes trust.
2. **Air Canvas**: "drive a 2D thing." Pinch to draw, other hand grabs and moves it, dwell to undo. Shows gestures as input.
3. **Tempo Strike**: "drive 3D things inside a real game loop." Hands become sabers; velocity scores. The game-dev hook.
4. **Motion Recorder**: "record it, scrub it, export it, open it in Blender." The save verb, end to end.
5. **Face Puppet**: "same pattern, different model." Proves the pipeline generalizes.

## What "done" looks like (the north-star test)

A friend clones the repo, runs two commands, allows the camera, and within ten minutes has:

- (a) waved a hand and moved something on screen,
- (b) recorded a take with voice,
- (c) exported it, and
- (d) opened that export in Blender (or Unity) and seen the motion play.

On hotel wifi. With no step that requires Grayson in the room.

Nothing in the repo passes this test yet: (d) has no importer, and the app needs four CDNs to start. That gap is the roadmap in [PLANNING.md](PLANNING.md).

## Principles

- **Test bed, not product.** Demos are thin and disposable; the core is what accrues. No pricing page, no onboarding funnel, no "framework" language.
- **One frame shape.** Every consumer reads the same `TrackedFrame`. Two representations of a hand is how the smoothing slider ended up wired to nothing ([teardown F1](docs/TEARDOWN-2026-09-06.md)).
- **Demos are thin.** A demo is one way to consume the frame plus UI. Logic that two demos want lives in the core.
- **Offline by default.** Models, WASM, CSS, and audio ship with the build. A CDN is an optimization, not a dependency.
- **Show, don't claim.** Nothing goes on a hub card until it exists and has been camera-verified in real Chrome. The in-app preview browser has no camera and no WebGL; it can only prove mount.
- **Pure math is tested; the camera path is host-verified.** Keep the pure layer (`resolveHands`, smoothing, `lineReliability`, gestures) pure so vitest covers it. Keep a written host-verification checklist for the rest.
- **Export opens somewhere real.** An export format without an importer for at least one tool is a checkbox, not a feature.

## Non-goals (for now)

- Not an npm package. If a friend asks to lift the core, that is the trigger to publish it, not before.
- Not multi-user, networked, or collaborative.
- Not MIDI, OSC, BVH, or FBX until a specific person needs a specific one.
- Not mobile. Desktop Chrome with a webcam is the target.
- Not full-body pose yet. The tracker core should make it a one-file addition; that is the constraint, not the feature.
- Not more demos. Five is the tour. New ideas replace a stop or go to the backlog.

## How this document is used

- **Read at pickup.** If a session's plan does not serve Track, Drive, or Save, stop and ask why.
- **The roadmap** is [PLANNING.md](PLANNING.md) (ordered, gated).
- **Designs** are in [docs/tdd/](docs/tdd/) (one technical design doc per workstream).
- **Decisions** are in [docs/adr/](docs/adr/).
- **The session baton** is [HANDOFF.md](HANDOFF.md) (written by `wrap-up`, read by `pickup`).
- **Idea backlogs** are the per-demo `demos/*/PLANNING.md` files. They are unranked and are not commitments.

Change this document only when the goal changes, and record why in an ADR.
