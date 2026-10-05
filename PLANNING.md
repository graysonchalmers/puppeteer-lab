# 🗺️ Puppeteer Lab: Roadmap and Next Steps

_Rewritten 2026-10-04 after the third teardown ([TEARDOWN-2026-10-04](docs/TEARDOWN-2026-10-04.md)). The goal is [NORTH_STAR.md](NORTH_STAR.md); this file is the ordered, gated path toward it. Decisions: [ADR-0002](docs/adr/0002-phone-first-face-puppet.md). Designs: [docs/tdd/](docs/tdd/). The per-demo `demos/*/PLANNING.md` files are unranked idea backlogs._

## How to read this

- **Now / Next / Later.** Pick from the top of Now unless Grayson reorders.
- Each item has a size (**S** = one session or less, **M** = two or three, **L** = four or more), a source, and a **binary gate**.
- An item is Done when its gate is green **and** it is verified on the device it is for: a real phone (iPhone Safari) for Face Puppet, real desktop Chrome for the lab path. Write the verification line in `HANDOFF.md`.
- Every item must serve the north-star test (Track, Drive, Save on the phone) or measurement. Otherwise it goes to Later or a backlog.

## 🎯 The north-star bar

- [ ] A 20 s phone take reads clearly (mouth, brows, blinks) at a steady `loop` of 30 fps or better. (Now 1)
- [ ] Tuning on the phone is possible without hiding the face. (Now 2)
- [ ] Visits, takes started and takes saved are counted. (Now 3)
- [ ] Save & get link works on the live site, and the link plays on a desktop. (Next 5)
- [x] Face Puppet is the default route with a tap-to-start camera card. (2026-09-30)
- [x] Slider tuning survives a reload. (2026-10-04, `8f46e98`)

## ▶️ Now (in order)

| # | Item | Size | From | Gate |
|---|---|---|---|---|
| 1 | **Verify the mouth/responsiveness pass on the phone** (live at `48bace3`): read DEBUG (`loop`, `hand N fps` + `ALT`, `hand`/`face` ms) face-only and with a hand in view; talk normally. Tune `LIP_FILTER.minCutoffScale`, `JAW_OPEN_ABOVE` or the boost defaults from what is seen. | S | Teardown 2026-10-04 findings 1–4 | Screenshots from Grayson's phone in `HANDOFF.md`; speech visibly moves the mouth; `loop` ≥ 30 face-only. If `loop` < 30: open a throughput item (lower camera size, skip the palm detector when no hand is in view, `numHands: 1`). |
| 2 | **Phone tuning UX**: half-height Controls sheet (face stays visible), Jaw Boost and Face Smoothing first; a clear message when a take recorded no face. | S | Teardown UX findings | WebKit 390x844 shot: face visible with the sheet open; recording with no face shows a message, not FRAMES 0; phone-check green. |
| 3 | **Measure use**: cookieless analytics on the live site (the kit's Umami via `badge.js`, or the share server), three events: visit, take started, take saved. No camera, audio or landmark data. | S | ADR-0002 decision 5 | Events visible in the dashboard from a real phone session; a network check shows no camera/audio/landmark payload. |
| 4 | **Render, step puppet state and record only on a new tracker frame.** The stage and the export step the jaw EMA at one rate; recording stops storing duplicate frames (halves take size at 60 Hz). | S–M | Teardown engineering (FaceDemo render loop) | A test pins stage/export state agreement at mixed render rates; a 10 s take at 60 Hz render / 30 fps camera stores ~300 frames, not ~600; facedemo-check green. |

## ⏭️ Next

| # | Item | Size | From | Gate |
|---|---|---|---|---|
| 5 | **Uploads on, safely**: server retention or quota-recovery rule (today ~7 IPs can fill 10 GB forever), a private `IP_SALT`, a public `CONTACT_EMAIL`, then switch uploads on; one live end-to-end save opened on a desktop; `docker stats` during a big upload; one `scripts/Pull-Takes.ps1`. | S | Teardown red team; [SHARE_LINKS_ROADMAP](docs/SHARE_LINKS_ROADMAP.md) | A filled quota recovers without manual action (test); live save → desktop playback verified; north-star (c)+(d) pass. |
| 6 | **Split `components/FaceDemo.tsx`** (805 lines) into capture, export, orbit and panel hooks/components, with tests on the extracted logic. | M | Teardown architect | No behavior change: facedemo-check, orbit-check, cleanup-check, phone-check green; FaceDemo.tsx under ~300 lines. |
| 7 | **Browser gates in CI** (phone, facedemo, orbit, cleanup, share) with WebKit for phone shots. | M | Teardown red team | CI runs them on push; a deliberate layout break turns CI red. |
| 8 | **Offline remainder**: Tailwind at build time, synthesized Tempo Strike beat, smoke probe that fails on any CDN URL in `dist/`. | S | [TDD-004](docs/tdd/TDD-004-offline-first-assets.md) P2–P4 | Face Puppet and all lab demos start with the network off after first load; CI red when a CDN URL returns. |

## 🧪 Lab path (kept working, not feature work)

| # | Item | Size | From | Gate |
|---|---|---|---|---|
| L1 | **Finish the one frame shape**: move Hand Telemetry, Air Canvas, Tempo Strike and Motion Recorder from the `useMediaPipe` adapter to `TrackedFrame`, delete the adapter and `HandPositions`. Type `FrameData` and drop THREE objects from the take buffer. | M | [TDD-001](docs/tdd/TDD-001-tracker-core.md) P4–P5, teardown | No `lastResultsRef` / `handPositionsRef` left; all lab demos verified in desktop Chrome. |
| L2 | **Lab check** (ADR-0001's old north-star test): clone, `npm install`, `npm run dev`, wave a hand, record with voice, export, open in Blender, with the network off. | S | ADR-0001 | Done once Next 8 lands; written in `HANDOFF.md`. |

## 🔭 Later (only after Now and Next, or when someone asks)

- **Tracker throughput, structurally**: `requestVideoFrameCallback`, MediaPipe in a Worker, a tasks-vision upgrade from 0.10.9, an A/B with MediaPipe's internal face smoothing off (`numFaces: 2`), dropping the unused facial transformation matrix. Only if Now 1 shows throughput is still the limit.
- **Recorder trail + skeleton replay** for Motion Recorder ([TDD-003](docs/tdd/TDD-003-motion-recorder-upgrade.md) P2–P3). Lab path; only on request.
- **Armature bake** in the Blender importer; a Unity player script if someone on Unity asks (TDD-002 P5).
- **Pose** as a third modality.
- **Generated motion as input** (idea 2026-09-15): kimodo.cpp and motion-bricks.cpp from github.com/localai-org as a second frame source, in schema v3.
- **Look or mesh work** (another look, a nose-curvature vertex re-pick, a full-mesh re-pick): only with no open Track item (ADR-0002 decision 3).
- **Folder and naming unification** (`face-telemetry` / `FaceDemo` / "Face Puppet"); archive finished `docs/superpowers/plans`; regen-and-compare test for `faceTopology.ts`; park unused `meshOpt.mjs` paths.
- **`tsconfig` strict**, after L1 removes most `any`s. **Split the vendor chunk.**

## 🗃️ Idea backlogs (not scheduled)

`demos/air-canvas/PLANNING.md`, `demos/tempo-strike/PLANNING.md`, `demos/motion-recorder/PLANNING.md`, `demos/face-telemetry/PLANNING.md`, `demos/hand-telemetry/PLANNING.md`. To promote one, move it into Now or Next here with a reason, a size and a gate, and say how it serves the North Star.

## ✅ Done (brief)

- **2026-09-04**: imported from the AI Studio export; teardown #1 and its fixes; shared engine; CI (typecheck, test, build, smoke); demos code-split.
- **2026-09-06**: teardown #2; ADR-0001; TDD-001 to TDD-004; first roadmap.
- **2026-09-16**: landmark smoothing, scrubber, vendored MediaPipe, housekeeping, build stamp; recording schema v3 + worker serialization + Blender importer; `TrackedFrame`/`useTracker` Phase 2.
- **2026-09-22**: Face Puppet overhaul (One Euro face smoothing, ratio+hysteresis mouth, low-poly head, Video/Pack export); TDD-001 Phase 3 (face in `useTracker`, `useFaceTracker` deleted); Three.js renderer.
- **2026-09-29**: phone layout + rear camera; phone-check gate.
- **2026-09-30**: Face Puppet default route + tap-to-start camera card; share links (`server/`, `/t/<id>` viewer, private archive), deployed dark, uploads off.
- **2026-10-02/03**: take Clean up + Orbit; neon look; normals fix; Flip then Even face mesh with hard-edge smoothing; tracker DEBUG overlay; 60 fps camera request.
- **2026-10-04**: teardown #3; mouth/responsiveness pass (jawOpen mouth gate, lips-only lighter filter, hands yield under load on model cost, one detection per camera frame, boosts 100%) live at `48bace3`; slider memory + doc fixes live at `8f46e98`; ADR-0002, this roadmap and the North Star rewritten.
