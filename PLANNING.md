# 🗺️ Puppeteer Lab: Roadmap and Next Steps

_Rewritten 2026-09-06 after the second teardown. The goal is [NORTH_STAR.md](NORTH_STAR.md); this file is the ordered, gated path toward it. Designs live in [docs/tdd/](docs/tdd/). Decisions live in [docs/adr/](docs/adr/). The per-demo `demos/*/PLANNING.md` files are unranked idea backlogs, not commitments ([ADR-0001](docs/adr/0001-demo-first-test-bed.md))._

## How to read this

- **Now / Next / Later.** Items under Now are sequenced; pick from the top unless a demo date changes the order (see "If a demo date is close").
- Each item carries a size (**S** = one session or less, **M** = two or three sessions, **L** = four or more), the TDD it comes from, and a **binary gate**.
- An item is Done when its gate is green **and** the host-verification line (real Chrome, real webcam) is written in `HANDOFF.md`. The in-app preview browser has no camera and no WebGL; it only proves mount.
- Every item must serve Track, Drive, or Save. If it does not, it goes to the backlog.

## 🎯 The demo-day bar

What must be true before the tour is shown to friends. Each line maps to an item below.

- [ ] Runs from `npm run preview` with the network off, all five demos. (TDD-004)
- [ ] Every hub card claim is true and camera-verified. Today two are not: "scrub through takes" and the "Games" title. (TDD-003 P1, housekeeping)
- [ ] Global Smoothing visibly changes the drawn line in Air Canvas and the skeleton in Hand Telemetry. (TDD-001 P1)
- [ ] A take recorded in Motion Recorder opens in Blender and plays. (TDD-002 P3)
- [ ] README opens with a GIF and a three-command quick start. (README item)
- [ ] `LICENSE` exists. (housekeeping)

## ▶️ Now (in order)

| # | Item | Size | From | Gate |
|---|---|---|---|---|
| 1 | **Landmark-level smoothing** inside `useMediaPipe`, paired by side, so the Global Smoothing slider acts on what every demo draws | S | [TDD-001](docs/tdd/TDD-001-tracker-core.md) P1 | New `smoothLandmarks` test pins the endpoints; host: Air Canvas `RAW` vs `MAX` visibly differ. Closes teardown F1. |
| 2 | **Scrubber** in `RecorderControls` (pause on drag, seek, resume), binary-search frame lookup, hub card copy updated in the same commit | S | [TDD-003](docs/tdd/TDD-003-motion-recorder-upgrade.md) P1 | `findFrameIndex` test; host: scrubbed position and audio agree by ear. Closes F2. |
| 3 | **Vendor MediaPipe** WASM and models into `public/mediapipe/`, one `assets.ts` with a CDN env override | S | [TDD-004](docs/tdd/TDD-004-offline-first-assets.md) P1 | With DevTools Network offline after first load, all five demos initialize tracking. |
| 4 | **Housekeeping batch**: add `LICENSE` (Apache-2.0 to match the headers); delete the `types.ts` JSX `any` augmentation (tsc passes without it); fix the stale "lives in DebugView" comment in `lineReliability.ts`; hub card title "Games" becomes "Tempo Strike"; throttle the camera-rate `setMetrics` / `setBlendshapes` readouts to 10 Hz | S | Teardown F6, F10, F11, F12, F13 | tsc, test, build, smoke green; React Profiler shows sidebar commits at or under 10 per second while tracking. |

## ⏭️ Next

| # | Item | Size | From | Gate |
|---|---|---|---|---|
| 5 | **`TrackedFrame` + `useTracker`**: one frame shape, `useMediaPipe` and `useFaceTracker` become adapters, face folds into the same loop, then consumers move and the adapters are deleted. Run as a `phased-rebuild`. | M | [TDD-001](docs/tdd/TDD-001-tracker-core.md) P2 to P4 | Per-phase gates in the TDD; final: no `lastResultsRef` / `handPositionsRef` / `faceResultRef` left in the tree; all five demos host-verified. |
| 6 | **Recording schema v3** with measured fps and a v2 migration shim, worker serialization, then the **Blender importer** | M | [TDD-002](docs/tdd/TDD-002-recording-schema-and-export.md) P1 to P3 | Round-trip and migration tests; a 30 s face take exports with no long task over 100 ms; host: a real take opens in Blender 4.x and the empties move. Screenshot committed. |
| 7 | **Motion Recorder trail + skeleton replay** (needs items 5 and 6) | S + S | [TDD-003](docs/tdd/TDD-003-motion-recorder-upgrade.md) P2, P3 | 50 fps or better with a 60 s take buffered; a new take replays as a moving hand; a v2 file still shows spheres. |
| 8 | **Tailwind at build time**, **synthesized 140 BPM beat** for Tempo Strike, **smoke probe** that fails on any CDN URL in `dist/` | S | [TDD-004](docs/tdd/TDD-004-offline-first-assets.md) P2 to P4 | Hub screenshot before/after identical; Tempo Strike starts offline; CI red when a CDN URL is reintroduced. |
| 9 | **README**: GIF of the tour, three-command quick start, a "how to verify" section (gates plus the host checklist) | S | Teardown Newcomer lens; `project-setup` kit | A friend who has never seen the repo runs it from the README alone. |

## 🔭 Later (only after Now and Next, or when someone asks)

- **Folder moves and naming unification** (`core/`, `demos/<name>/` with code beside docs, one id per demo). Pure rename commit, done last so moves never tangle with behavior diffs. Teardown F13.
- **Armature bake** in the Blender importer; **Unity player script** if a friend on Unity asks. TDD-002 P5 and the Unity note.
- **Pose** as a third modality, as the proof that `useTracker` generalizes. Only after item 5.
- **`tsconfig` strict.** Scope it after item 5 removes most of the `any`s; a big lift before that.
- **Split the 682 KB vendor chunk.** Already lazy-loaded; low priority.
- **A hands + face puppet demo.** Replaces a tour stop; the tour does not grow to six.

## ⏱️ If a demo date is close

Reorder Now to 3, 2, 4, 1. Offline first (nothing else matters if tracking cannot start on their wifi), then the two visible lies, then the slider. Item 1 stays valuable but is architectural progress, not demo insurance.

## 🗃️ Idea backlogs (not scheduled)

`demos/air-canvas/PLANNING.md`, `demos/tempo-strike/PLANNING.md`, `demos/motion-recorder/PLANNING.md`, `demos/face-telemetry/PLANNING.md`, `demos/hand-telemetry/PLANNING.md`. These hold MIDI/OSC routing, BVH/GLTF transposers, Spatial Pong, Marionette IK, a mimic mask, a collaborative canvas, and more. None are scheduled. To promote one, move it into Now or Next here with a reason, a size, and a gate.

## ✅ Done (brief)

- **2026-09-04**: imported from the AI Studio export; public repo; teardown #1 and its fixes (audio and kinematics exports, Gemini key removed from the bundle); drei bump; Line Reliability for Air Canvas; DebugView split into Air Canvas + Hand Telemetry on a shared engine; shared `SmoothingControl`; CI (typecheck, test, build, smoke); `resolveHands` partial-handedness fix; tsc clean; README `worldZ` fix; demos code-split.
- **2026-09-06**: teardown #2 ([docs/TEARDOWN-2026-09-06.md](docs/TEARDOWN-2026-09-06.md)); `NORTH_STAR.md`; ADR-0001; TDD-001 through TDD-004; this roadmap; stale demo docs fixed.
