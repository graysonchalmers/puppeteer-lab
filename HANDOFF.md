# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-22 17:10 CT_

## 🎯 Current state
The Face Puppet overhaul is **shipped**: pushed (`origin/main` at `68ddfa6`, code at `9d3e455`) and live on [mocap.graysonchalmers.com](https://mocap.graysonchalmers.com) (stamp `⚡ CLICK · 9d3e45 · 2026-09-22`). Face Puppet is now a faceted low-poly head (fixed 210-vertex / 336-triangle topology from MediaPipe's canonical face, one gray ramp, original eyes), a One Euro-smoothed face with a Face Smoothing slider, a scale-invariant ratio + hysteresis mouth (seam when closed), low-poly hands tracked in the same loop as the face (TDD-001 Phase 3) and recorded even when the face drops, plus two new exports: **Video** (real-time MP4/WebM with the take's voice, mic start offset corrected) and **Pack** (zip: video + v3 `recording.json` + audio). Gate green: typecheck, 140/140 tests, build, smoke. Verified only camera-less, from synthetic takes (`tools/make-synthetic-take.mjs`); nothing is camera- or mic-verified yet.

## 📌 Where we stopped
Everything committed, pushed, and deployed; tree clean. Waiting on Grayson's real-webcam check of the live Face Puppet. The live site was checked by HTTP status only (the in-app browser was denied opening it).

## ▶️ Next concrete step
**Host-verify Face Puppet on the live site (real Chrome, camera + mic):**
0. **Teeth + brows (2026-09-22 follow-up, deployed to mocap at `e43cbfa`, stamp `🐫 AROUND · e43cbf`):** raise ONE brow; if the other puppet brow moves, flip `BROW_SIDES_SWAPPED` (`components/face/puppetState.ts`). Lips parted with teeth together shows a white bite block; dropping the jaw shows two rows with a dark gap (tune `TEETH_APART_ABOVE` / `TEETH_TOGETHER_BELOW` on `jawOpen`). Tune the Brow Boost slider default (0.5) and `BROW_BOOST_MAX`. Head is trimmed to 191 verts / 298 tris.
1. Mouth: no flicker at the open/close boundary; closed shows a seam. Retune `MOUTH_OPEN_ABOVE` / `MOUTH_CLOSE_BELOW` (`components/face/mouthState.ts`) if needed.
2. Face Smoothing slider: LIGHT jitters a little, HEAVY lags a little, default feels calm.
3. Face + hands loop holds 30 fps or better; hands keep moving when a hand covers the face.
4. Record with voice, Export -> Video (tab in front): MP4 plays on a phone with audio in sync.
5. Export -> Pack: unzips to `puppet.mp4`, `recording.json`, `audio.*`; `recording.json` loads back via Load JSON and plays.
6. Export a 10-20 s real take (Export -> Full) into the repo root so the mouth thresholds can be tuned on a real face.

Alternatives: (a) run the still-open 2026-09-16 checklist first (Air Canvas Global Smoothing RAW vs MAX direction, Hand Telemetry confidence slider 0.1-0.9, Motion Recorder scrub/audio, offline `npm run preview` with the adapter off, footer stamp, 10 Hz sidebars, item 6 long-task + real Blender import, Air Canvas pinch tie-line tuning; details in `handoff-log/2026-09-16-*.md`) since those are older and equally unverified; (b) move on to TDD-001 Phase 4 (other demos read `frameRef`, delete `useMediaPipe` adapter), which has no camera dependency to start but builds on unverified ground.

## ❓ Open questions
- In-app playback (shared `useRecorder`) still has the pre-existing voice-leads-lips offset; the Video export corrects it using the recorded `audio.offsetMs`. Fix playback too (touches every demo) or leave it?
- Mouth thresholds (0.08 open / 0.05 close) are tuned only on synthetic data.
- Deferred by ruling: stroke widths don't scale when an export is downscaled from a stage wider than 1280 px; `useTracker` shared refs across effect runs; an export can still hang if a browser starts recording and never fires `onstop`.
- TDD-001 pinch gating: smoothed landmarks (Option A, current) or raw for onset (B)? Decide on camera (see the 2026-09-16 checklist). Convergence at MAX is ~360 ms at 60 Hz, not the ~100 ms the TDD guessed.
- Exported recordings now carry landmarks smoothed at whatever the slider was during capture (documented in `useRecorder.ts`). Fine for a test bed; say so in TDD-002's schema (`capture.smoothing` field) when it lands.
- Parked from final review (see log): two hands mislabelled the same side smooth against each other for a frame (fix in TDD-001 P2 `buildFrame`); keyboard scrubbing does not pause and `step=16` is coarse (TDD-003 P4); CDN URL pin `0.10.9` vs npm pin could drift (CDN mode is opt-in); scrub state machine has no automated tests (needs `@testing-library/react`).
- `v0.0.0` prefix in the stamp comes from `package.json` version; bump or drop the field if it bothers.
- Loading a `puppeteer-lab/kinematics`-schema file back into the app via `loadData` silently produces an unusable buffer instead of a clear error: `migrateV2` (`recordingSchema.ts`) only special-cases `schema === 'puppeteer-lab/recording'`, so a kinematics file falls through to the bare passthrough (`return json.frames as FrameData[]`), leaving frames shaped `{t, hands, face}` instead of `FrameData`. Nothing renders, `hasData` may be misleadingly true, and the "Loaded N frames" alert still fires. Ruled out of scope for the item 6 fix wave (2026-09-16 final review, Finding 2b): the kinematics format was designed export-only, "the file for animation tools" per TDD-002, and was never required to round-trip -- TDD-002's own test plan only specifies loading the FULL file back into the app. Fixing it properly would need `extractFramesFromV3` to infer the `partial` hand flag from null-ness (since `buildKinematics` drops that flag entirely when it builds the kinematics frame shape), not just a schema-string check in `migrateV2`.
- `capture.smoothing` in the v3 recording envelope is deferred (Face Puppet overhaul spec deviation 2): it needs plumbing through `SerializeRequest` and the worker for a field nothing reads yet.
- A left-only hand is labelled `right` in v3 recording files (Face Puppet overhaul spec deviation 1, inherited from Hand Telemetry's existing convention -- `FrameData.landmarks` reuses the existing full-hands field rather than adding a `{side, landmarks}[]` shape, and index 0 is always read as the right hand regardless of which side was actually captured).

## 🗂️ Changed this session
- Branch: `main` · spec `e6c03d0`, plan `15e9445`, tasks `e40eb88..9132894`, final-review fix wave `4f5e8cc..9d3e455`, HANDOFF `68ddfa6`; all pushed.
- New: `components/shared/oneEuro.ts`, `facePolicy.ts`, `download.ts`; `components/face/mouthState.ts`, `faceTopology.ts` (generated), `lowPoly.ts`, `handMesh.ts`, `captureFrame.ts`, `exportPack.ts`, `exportVideo.ts`; `tools/gen-face-topology.mjs`, `tools/make-synthetic-take.mjs`, `tools/data/canonical_face_model.obj`; deps `fflate` (runtime), `delaunator` (dev). Removed `hooks/useFaceTracker.ts`.
- Modified: `hooks/useTracker.ts` (face + combined paths), `hooks/useRecorder.ts` (export seam, audio offset, camera size), `components/shared/buildFrame.ts`, `trackerTypes.ts`, `recordingSchema.ts` (`channelsFor`, `audio.offsetMs`), `components/face/FaceMeshRenderer.ts` (rewritten), `components/FaceDemo.tsx`, `components/RecorderControls.tsx` (additive export props), docs.
- Decisions (+ why): Canvas 2D over Three.js (camera-less screenshot proof, eyes untouched); mouth approach A per Grayson; hands reuse `FrameData.landmarks` (v3 already round-trips them); audio offset fixed in export only (playback lives in the recorder every demo shares); deployed before host verification on Grayson's go.

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
