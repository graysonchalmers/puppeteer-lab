# 2026-09-22 (evening): teeth, brows, boosts, idle pause, and the Three.js Face Puppet

## What happened
1. **Teeth, brows, fewer polygons** (`7553985`, `e43cbfa`).
   - Teeth: a closed seam, a white bite block when the lips part with the teeth together, and tooth rows once the jaw opens (jawOpen hysteresis).
   - Flat stylized brows.
   - Brow Boost: brows and forehead displaced along the face's up axis, render-time only; downward travel is damped so a frown never crosses the eye.
   - Topology trimmed 336 → 298 triangles.
   - One `stepPuppetState` feeds both the stage and the export.
2. **Brow sides flipped** (`c64c115`). Grayson verified on camera that MediaPipe's brow blendshape sides follow image position, not the subject; a test now pins the mapping.
3. **Jaw Boost** (`8430d07`).
   - Teeth now part continuously (`teethGap`) instead of on/off, because speech reads only 0.05-0.2 jawOpen.
   - `boostJaw` drops the lower lip and chin.
   - Rescaled 1.6x in `a48b7b0` (default 0.75 = old 120%) after Grayson found 100% "good but wanted more".
4. **Idle auto-pause** (`a48b7b0`).
   - After 60 s with no input, every demo's camera and trackers shut down; tracked hands count as input so hands-only demos don't pause.
   - An overlay says so; a click or key resumes.
   - Recording and export hold it awake.
   - Bug caught before shipping: releasing the tracker on pause would clear the pause, so the overlay clears it on unmount instead.
5. **Three.js Face Puppet.**
   - Brainstormed in five questions:
     - renderer: Three.js;
     - mesh: both, with a toggle plus a crease slider;
     - eyes: self-lit with a fixed glint;
     - hands: capsules plus a palm pad;
     - video preprocessing: split out as its own job.
   - Spec `afdf13e`, plan `a91cf7f` (9 tasks), executed Subagent-Driven with a per-task review; an Opus final review; one fix wave.

## Rulings made during execution (cost if wrong)
- FULL-mesh lip flag = triangle centroid inside the LIPS_OUTER polygon. The dense mesh has an unlabeled middle lip ring, so LOW's all-vertices-in-set rule flagged 0 triangles. If wrong, only the lip band width on FULL changes.
- FULL mouth hole via the shared `isHoleTri` comes out a hair wider; accepted.
- The WebGL-failure sentinel and pre-blink gaze rays were folded into Task 8.
- A lost WebGL context mid-export records black frames; the spec's Risks section was corrected rather than adding abort logic.
- Small per-frame allocations in `PuppetScene` are parked; the spec only forbade allocation in the geometry update.
- The plan's iris texture was a 2:1 ellipse on an equirect texture whose u and v share one scale, so the iris came out tall. It is now a circle.
- Hands use 16 segments, not 20; the palm pad covers the finger metacarpals.

## Verification
- Gate: tsc, 175/175 tests, build + smoke.
- Screenshots from the dev build with the synthetic takes:
  - Low vs Full
  - crease 0/35/90
  - blinks: open / partial / snapped shut
  - teeth
  - capsule hands
- One real video export ran to completion (download intercepted, `.mp4`).
- Final-review fixes:
  - zero-size stage guard, since drawImage of a 0-sized WebGL canvas threw and killed the rAF loop
  - fallback text offset
  - stage context disposed on unmount
  - aspect-true blink fallback
- Deployed `3f7fae5` to mocap: secret gate clean, badge in, 14/14 assets, HTTPS 200.

## Ruled out / learned
- Edge detection on the video feed: MediaPipe was trained on natural images, so it would likely hurt tracking. Auto brightness/contrast is the candidate instead.
- A hidden in-app browser pane gets no requestAnimationFrame frames. Pump `computer screenshot` calls (scale 0.1) between capture steps; a real-time export only advances while pumped. WebGL 2 works in the pane (an older note said it didn't; memory corrected).
