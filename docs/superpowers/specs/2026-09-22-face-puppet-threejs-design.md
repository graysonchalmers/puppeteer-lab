# Face Puppet on Three.js: design

_2026-09-22. Brainstormed with Grayson (architectural path). Status: approved in chat section by section, pending review of this written spec. Supersedes the "Renderer tech: Canvas 2D" decision in `2026-09-22-face-puppet-overhaul-design.md`._

## Goal

Improve how the puppet looks and moves, keeping it stylized and in grays:

1. **Smooth shading with creases.** Soft across cheeks, forehead and jaw; hard where the surface turns sharply (nose, eye sockets, lip line). The crease angle is a slider.
2. **Three-point studio lighting** on a matte gray surface.
3. **Real eyeballs.** Self-lit balls behind the lid openings that the lids cover when they close. The iris never shrinks.
4. **Blink Boost.** Real blinks close fully; squints stay squints.
5. **Better hands.** Tapered capsule fingers and a palm with volume.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Renderer | Plain Three.js (already a dependency, `three@0.167.1`), driven imperatively. Not R3F: the stage loop and the video export both need on-demand renders into canvases they own. |
| Mesh density | Both, with a **Mesh: Low / Full** toggle so Grayson can compare on camera and lock one in later. Low = today's trimmed 298 triangles. Full = MediaPipe canonical ~900 triangles with the same holes cut. |
| Creases | **Crease Angle** slider, 0–90°, default 35°. 0 looks faceted like today, 90 is nearly all smooth. |
| Eyes | Option A: self-lit (unlit material) with a fixed painted glint. Not lit by the studio lights, no reflections. |
| Hands | Option A: tapered capsule fingers plus a solid rounded palm pad. No forearm. |
| Video preprocessing | Out of scope. Its own job after this ships. |

## 1. Architecture

- `drawPuppet(ctx, frame, w, h, opts)` keeps its signature. Internally it renders a `PuppetScene` (WebGL) and `drawImage`s the result onto `ctx`. Then it draws the 2D overlays (gaze rays, mocap dots) on top.
- One `PuppetScene` per target canvas size, kept in a `WeakMap` keyed by the 2D canvas: the stage gets one, and a video export gets its own at export size. `FaceDemo.tsx` and `exportVideo.ts` need little or no change. `renderTakeToVideo` still records the 2D canvas via `captureStream`.
- Camera: `OrthographicCamera` looking straight at the face, using the same contain-fit, X-mirrored mapping as `fitProjection`. The face lands where it does today and the overlays line up. Landmark z uses the same `z * drawW` scale as today.
- Unchanged: `puppetState.ts` (mouth open, jaw, brows, `teethGap`), `boostBrows`, `boostJaw`, the One Euro landmark filter, recording and export. The pipeline per frame is **raw landmarks → boosts (brows, jaw, blink) → scene update → render**. Boosts return copies and never touch recorded data.
- `FaceMeshRenderer.ts` (Canvas 2D) is replaced by `PuppetScene` plus small modules that each have one job and can be tested on their own:
  - `faceGeometry` (positions and normals from landmarks)
  - `creaseGroups` (smoothing groups from the neutral face and an angle)
  - `eyes` (eyeball placement, gaze, texture)
  - `mouthParts` (cavity, teeth rows, closed-lip fill and seam, brows)
  - `handRig` (capsule segments, palm pad)
- If WebGL context creation fails, show a clear message on the stage instead of a blank canvas.

## 2. Face mesh, creases, lighting, mouth and brows

**Meshes.** `tools/gen-face-topology.mjs` emits two fixed tables into `faceTopology.ts`:
- **LOW:** the current trimmed subset (191 vertices, 298 triangles).
- **FULL:** the canonical model's own faces, with any triangle spanning the lid or lip openings removed, using the same `spans` rule as today.

Each table has a per-triangle lip flag. Vertex indices are MediaPipe landmark indices, so both meshes read the same landmark array.

**Geometry.** Non-indexed `BufferGeometry` (three corners per triangle, so each corner can carry its own normal). Positions update in place each frame (`needsUpdate`), with no per-frame allocation. Lip triangles are a step darker via vertex color.

**Crease groups.** Computed from the neutral canonical face (`tools/data/canonical_face_model.obj`, the same geometry the topology generator reads), whenever the mesh or the Crease Angle changes:
- For each triangle corner, the list of triangles sharing that vertex whose neutral face normals are within the crease angle of this triangle's normal.

Per frame, each corner's normal is the normalized sum of the **live** face normals of its group. Groups come from the neutral face, so an edge never pops between smooth and hard as the face moves. (At 0° every group is the triangle itself, which gives flat shading.)

**Material.** `MeshStandardMaterial`, mid-gray, roughness about 0.75, metalness 0, vertex colors on.

**Lights** (all neutral white):
- **Key:** directional, upper left, in front. The strongest.
- **Fill:** directional, lower right, about 0.25 of the key.
- **Rim:** directional, behind and above, tracing the silhouette against `#090A0C`.
- **Ambient:** low, so shadows never go fully black.

Exact intensities are tuned on the synthetic take.

**Mouth** (logic unchanged; drawing moves to 3D):
- **Closed:** a lip-colored fill of the inner-lip polygon, plus the dark seam line through the paired midpoints.
- **Open:** a dark self-lit cavity fill recessed behind the lips, with two off-white self-lit tooth rows between the cavity and the lips.
  - Row height follows `teethGap` exactly as today: `half * (1 - gap) + apartRow * gap`.
  - When the gap is under 0.1, a bite seam is drawn.

**Brows.** A flat dark self-lit fill of the brow band polygon, offset slightly toward the camera so it never z-fights the skin. It uses the boosted landmarks, as now.

## 3. Eyes and Blink Boost

**Eyeball** (one per eye):
- A sphere centered on the eye-contour centroid, with radius from the corner-to-corner eye width.
- It is pushed back from the lid surface so the face mesh around the opening sits in front. Closing lids then cover it through normal depth testing.
- Radius and set-back are tuned on the synthetic take so the ball never pokes through the cheek or brow.

**Look.** `MeshBasicMaterial` (self-lit) with a generated `CanvasTexture`:
- off-white sclera
- dark iris with a thin blue rim
- black pupil

The glint is a small separate self-lit dot, fixed at the upper left of each eye. It does not rotate with the ball, so it always reads as the key light.

**Gaze.** The ball rotates so the iris faces MediaPipe's iris landmark (468, 473) relative to the eye center. The rotation is clamped so the iris never rolls out of view.

**Blink Boost** (new slider, 0–1, default 0.5):
- **Input:** the `eyeBlinkLeft` / `eyeBlinkRight` blendshapes.
  - Side mapping follows the camera-verified brow mapping. `BROW_SIDES_SWAPPED` is renamed `BLENDSHAPE_SIDES_SWAPPED` and covers brows and blinks.
  - Fallback for takes with no blendshapes: lid aperture (upper-to-lower lid gap over eye width), mapped to 0..1.
- **Smoothing:** a light EMA (alpha about 0.7), so quick blinks survive.
- **Boost:** `closure = clamp(blink * (1 + boost * BLINK_GAIN))`, then a snap with hysteresis:
  - closure above about 0.8 snaps to fully closed
  - it releases below about 0.6
- **Lids:** each upper-lid landmark moves toward its paired lower-lid landmark (the paired `*_EYE_UPPER` / `*_EYE_LOWER` tables) by `closure`. They meet about 20% of the way up from the lower lid. The lower lid rises slightly with closure.
- **Where it lives:** a render-time landmark copy (`boostBlink`) alongside `boostBrows` / `boostJaw`. Recordings keep raw landmarks.

## 4. Hands, controls, performance, testing, shipping

**Hands.**
- **Fingers:** 20 finger segments (5 fingers × 4 bones, wrist to tip) as one `InstancedMesh` of a unit `CapsuleGeometry`.
  - Each instance's transform comes from its two landmarks: position at the midpoint, rotation along the bone, length equal to the bone.
  - Radius is set per finger and tapers from the knuckle toward the tip. The thumb is thickest and the pinky thinnest.
  - Radius scales with hand size on screen (wrist to middle-finger knuckle).
- **Palm:** a rounded pad (a scaled, squashed sphere or rounded box) oriented by:
  - the wrist → middle-knuckle axis
  - the index-knuckle → pinky-knuckle axis
  - their cross product as the palm normal

  Thickness is about a third of the palm width.
- **Depth and look:** hand z uses the face's scale. Hands always render in front of the face, as today. Same gray material and lights as the face.

**Controls** (Face Puppet sidebar):
- sliders: Face Smoothing, Brow Boost, Jaw Boost, Blink Boost (new), Crease Angle (new)
- a Mesh Low / Full toggle (new)

Blink, Crease and Mesh pass through `PuppetOptions`, like the existing boosts.

**Performance.**
- One scene for the stage, plus one for the duration of a video export (disposed afterwards).
- No per-frame allocation in the geometry update.
- Crease groups are recomputed only when the mesh or the angle changes.
- Target: 30 fps or better with face and hands tracking.

**Testing.**
- **Unit tests** (Vitest, no WebGL):
  - `creaseGroups`: 0° gives singleton groups; 90° gives shared groups across the smooth neutral cheek; groups are symmetric (if A smooths with B then B with A).
  - `boostBlink`: closure math, the snap and its hysteresis, no mutation of the input, pairing of upper and lower lids.
  - `eyes`: center, radius and gaze clamp.
  - `handRig`: segment midpoint, length and direction; palm normal orientation.
  - Both topologies: no triangle bridges a lid or lip opening; indices are 0..467.
- **Synthetic take:** `tools/make-synthetic-take.mjs` gains `eyeBlinkLeft`/`eyeBlinkRight` blendshapes and a blink phase (it already has jaw and brow phases, and hands with `--hands`).
- **Screenshot proof** in the built-in browser, which now has WebGL 2, from the synthetic takes:
  - Low vs Full
  - Crease Angle at 0 / 35 / 90
  - eyes open, half-closed and blinking shut
  - hands
- **A real Video export** rendered and played once, not just typechecked.
- **Gate:** typecheck, all tests, build, smoke.

**Shipping.**
- `writing-plans` next, then Subagent-Driven execution (a fresh subagent per task, two-stage review between tasks).
- Commits go straight to `main`. Deploy to mocap.graysonchalmers.com after the gate is green.
- Grayson then verifies on camera and picks: Low or Full, the crease angle, and the Blink, Brow and Jaw Boost defaults.

## Out of scope

- Video preprocessing (auto brightness/contrast before tracking). Its own job next.
- Per-person calibration (neutral-face capture).
- Self-shadowing and shadow maps.
- Environment reflections in the eyes.
- A forearm on the hands.

## Risks

- **Eyeball poking through the face** at extreme head turns. Mitigation: set-back and radius tuned conservatively; tested with the synthetic take's ±12° yaw.
- **Full mesh cost on low-end GPUs.** It is about 900 triangles, trivial for WebGL. The Low toggle stays as a fallback either way.
- **The video export now depends on WebGL.** A lost context mid-export surfaces through the existing `draw`-throws path in `exportVideo.ts` (it aborts cleanly).
