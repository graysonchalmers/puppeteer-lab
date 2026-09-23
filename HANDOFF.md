# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-22 20:50 CT_

## 🎯 Current state
Face Puppet now renders with **Three.js** and is live on [mocap.graysonchalmers.com](https://mocap.graysonchalmers.com) (stamp `🌈 ISLAND · 3f7fae · 2026-09-22`, code at `3f7fae5`, `origin/main` in sync).

What's in it:
- **Face:** crease-angle smooth shading with a Crease Angle slider (default 35°), a Mesh LOW (298 tris) / FULL (840 tris) toggle, and key/fill/rim studio lighting.
- **Eyes:** self-lit eyeballs that the lids cover, plus Blink Boost, where real blinks snap shut.
- **Mouth:** 3D teeth that part continuously, with Jaw Boost (default 0.75, rescaled 1.6x).
- **Brows:** stylized, with Brow Boost; the left/right sides were verified on camera and flipped.
- **Hands:** capsule fingers and a palm pad.
- **Idle auto-pause:** after 60 s with no input the camera and trackers stop, with a click-to-resume overlay. It never pauses while recording or exporting.

Checks: typecheck clean, 175/175 tests, build + smoke OK. Proof so far is synthetic screenshots plus one real video export that ran to completion. Nothing since the brow flip has been checked on a real camera.

## 📌 Where we stopped
Everything is committed, pushed and deployed, and the tree is clean. Waiting on Grayson's on-camera check of the Three.js puppet.

## ▶️ Next concrete step
**On-camera tuning on the live site (real Chrome, webcam):**
1. Pick Mesh LOW or FULL and a Crease Angle. After that, lock them in or remove the toggle.
2. Tune the Blink, Brow and Jaw Boost defaults (0.5 / 0.5 / 0.75): blinks close fully, squints stay partial, and speech parts the teeth.
3. At a strong head turn, check that the eyeballs never poke through and that no dark sliver appears near the silhouette. The per-triangle normal flip in `faceGeometry.ts` is the suspect.
4. Confirm face + hands tracking holds 30 fps or better.
5. Idle auto-pause: the webcam light goes off after 60 s and comes back on resume.
6. The older checks from the Face Puppet overhaul (mouth flicker, Video/Pack exports on a phone) are still unverified; see `handoff-log/2026-09-22-face-puppet-overhaul.md`.

Alternatives:
- **(a) Video preprocessing:** automatic brightness/contrast before tracking, for dim rooms. Grayson asked for it and it was deliberately split out; it touches `useTracker` for every demo.
- **(b) The older 2026-09-16 checklist** (Air Canvas, Hand Telemetry, Motion Recorder). It is equally unverified but lower value right now.

## ❓ Open questions
- LOW vs FULL mesh, and the crease default: decide on camera, then drop the toggle or keep it.
- If the eyeballs poke through or a silhouette sliver appears at strong turns, the fix is either orienting normals per mesh instead of per triangle, or retuning `EYE_SETBACK`.
- Parked from the Three.js final review:
  - small per-frame allocations in `PuppetScene` (hands/mouth); profile before optimizing.
  - a lost WebGL context mid-export records black frames rather than aborting (accepted, noted in the spec).
  - the fixed 64×3 dynamic buffers truncate silently if the topology ever grows.
- Idle auto-pause fires after 60 s even while you perform live without touching anything (only recording holds it). Should a visible face count as activity too?
- Carried over:
  - In-app playback still has the voice-leads-lips offset (export is corrected).
  - Mouth thresholds were tuned only on synthetic data.
  - `capture.smoothing` is deferred.
  - A left-only hand is labelled `right` in v3 files.
  - A kinematics file loaded back fails silently.
  - Keyboard scrubbing does not pause.
  - The CDN pin could drift.
  - Details for these are in the prior `handoff-log/` entries.

## 🗂️ Changed this session
- Branch: `main`. Brow flip `c64c115`, Jaw Boost `8430d07`, idle pause and jaw rescale `a48b7b0`, spec `afdf13e`, plan `a91cf7f`, Three.js tasks `9b3ab26..1588085`, final-review fixes `3f7fae5`, HANDOFF `65e0492`. Everything is pushed and deployed.
- New files:
  - `components/face/puppetState.ts`, `projection.ts`, `creaseGroups.ts`, `faceGeometry.ts`, `eyes.ts`, `handRig.ts`, `PuppetScene.ts`
  - `components/shared/idle.ts`, `components/IdleOverlay.tsx`
- Rewritten: `FaceMeshRenderer.ts`.
- Removed: `lowPoly.ts`, `handMesh.ts`.
- Decisions (+ why):
  - **Three.js over Canvas 2D.** Real smooth shading and lights need it. It's plain three, not R3F, because both the stage and the export render on demand.
  - **Crease groups built from the neutral canonical face.** That way edges never flicker between hard and smooth as the face moves.
  - **Self-lit eyes with a fixed glint.** They read in any lighting.
  - **Boosts stay render-time only.** Recordings keep the raw data.
  - **Brow and blink sides follow image position.** Verified on camera.
  - **Video preprocessing split out.** So a tracking regression can be attributed to one change.

---
📜 Full session history: `handoff-log/` (one dated file per session, oldest to newest)
