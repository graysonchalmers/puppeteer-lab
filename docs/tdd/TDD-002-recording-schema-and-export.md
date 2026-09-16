# TDD-002: Recording schema v3, compact export, and a Blender importer

| | |
|---|---|
| Status | Proposed (2026-09-06) |
| Serves | **Save** |
| Teardown findings | F7 (face export freezes the tab), F9 (undocumented format, no consumer) |
| Effort | M |
| Depends on | TDD-001 phase 2 for full-frame recording. Phases 1 and 3 here can start on today's `FrameData`. |
| Unblocks | TDD-003 (skeleton replay reads the same frames) |

## Problem

`useRecorder` writes three undocumented formats (`"2.0"`, `"2.0-kinematics"`, a webm) whose `FrameData` has five optional fields filled differently by each demo: Motion Recorder stores two fingertips, Hand Telemetry stores 21 raw landmarks plus fingertips, Face Puppet stores 478 landmarks plus blendshapes. The full export pretty-prints with `JSON.stringify(x, null, 2)` on the main thread and inlines base64 audio, so a 20-second face take is roughly 40 MB and a multi-second freeze. `fps` is hard-coded to 60. No tool named on the hub card can open any of it without hand-written parsing.

The North Star's done-test needs step (d): "open the export in Blender or Unity and see the motion play." Nothing today gets there.

## Goals

1. One versioned envelope. Every file says what it is and which app version wrote it.
2. Frames are the serializable subset of `TrackedFrame` (TDD-001), so what you record is what every demo saw.
3. Export never blocks the UI for more than about 100 ms; a 30-second face take stays under about 10 MB.
4. One real tool opens the export end to end: **Blender**, through `tools/blender_import_recording.py`.
5. Old `"2.0"` files still load (migrate on load).

## Non-goals

- BVH, FBX, or a Unity package. A Unity script is a stretch goal only if a friend on Unity asks (see "Unity note").
- Binary formats. Stay JSON in v3; a `.bin` sidecar is the documented escape hatch if sizes bite.
- Editing (trim, retime). The recorder records and replays.

## Design

### Schema v3 (full recording)

```jsonc
{
  "schema": "puppeteer-lab/recording",
  "version": 3,
  "createdAt": "2026-09-06T21:14:03.120Z",
  "source": { "app": "puppeteer-lab", "commit": "8c6f889", "demo": "motion-recorder" },
  "capture": {
    "fps": 58.7,                      // measured: frameCount / durationMs * 1000
    "durationMs": 20340,
    "frameCount": 1194,
    "video": { "width": 640, "height": 480 }
  },
  "world": {                          // how normalized -> world was computed, so importers can invert it
    "mapping": "mapHandToWorld@1",
    "xRange": 5, "yRange": 3.5, "yOffset": 0.8, "zScale": 8
  },
  "channels": ["hands"],              // any of "hands", "face"
  "frames": [
    {
      "t": 0,
      "hands": [
        {
          "side": "right",
          "score": 0.98,
          "landmarks": [[0.5123, 0.6011, -0.0021], ...],   // 21 x [x,y,z], normalized, 4 dp
          "world":     [[-0.061, 1.396, 0.08], ...]        // 21 x [x,y,z], world units, 3 dp
        }
      ],
      "face": null                      // or { "landmarks": [[...478]], "blendshapes": { "jawOpen": 0.12, ... } }
    }
  ],
  "audio": { "mimeType": "audio/webm;codecs=opus", "base64": "..." }   // or null
}
```

Compactness rules:

- Landmarks are `[x, y, z]` triples, not `{x, y, z}` objects (about 40% smaller).
- Normalized values rounded to 4 decimals (0.1 px at 1080p), world values to 3 decimals.
- `JSON.stringify(obj)` with no indentation.
- `rawLandmarks`, `tip`, `velocity`, and `pinch` are **not** stored: they derive from `landmarks` and `world` and the importer recomputes what it wants.

Size math (so nobody guesses):

| Take | Per frame | 60 s at 60 fps |
|---|---|---|
| Two hands | 2 x 21 x 2 arrays x ~18 bytes = ~1.5 KB | ~5.4 MB |
| Face | 478 x ~24 bytes + 52 blendshapes x ~20 bytes = ~12.5 KB | ~45 MB |
| Face, landmarks every 2nd frame | ~6.5 KB average | ~23 MB |

Face is the problem. v3 adds `face.landmarkStride` (default 2 for face takes: store landmarks on even frames, blendshapes every frame). Blendshapes are what the puppet mostly needs; the importer interpolates landmarks. If 20 MB is still too much in practice, the escape hatch is a Float32 `.bin` sidecar referenced by `face.landmarksUri`, glTF-style. Not built until needed.

### Kinematics export (`puppeteer-lab/kinematics`, version 3)

Same envelope, but frames carry only `t`, per-hand `side` + `world`, and `face.blendshapes`. No normalized landmarks, no audio. This is the file for animation tools.

### Audio export

Unchanged: the recorded Blob as `.webm`. Also written next to the JSON by the Blender importer if the JSON embeds audio.

### Exporter pipeline

1. Build the envelope object on the main thread (cheap; it references the frame array).
2. Serialize in a Web Worker: `new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' })`; post the frames (structured clone), worker runs `JSON.stringify` and posts back a `Blob`. Fallback if workers are unavailable: chunked stringify on the main thread yielding with `setTimeout(0)` every 500 frames.
3. Trigger the download through an `<a download>` as today.
4. `capture.fps` is measured, never assumed.

### Loader and migration

- Read `schema`/`version`. If absent and `version === "2.0"` (or `"2.0-kinematics"`), run `migrateV2(json)`:
  - `leftHand`/`rightHand` become hands with `world` populated at index 8 only and `partial: true` on the hand; the rest of `world` and `landmarks` are `null`.
  - `landmarks` (Hand Telemetry v2 files) map to `hands[i].landmarks` with side from array order (v2 stored no handedness).
  - `faceLandmarks`/`blendshapes` map 1:1.
- The migrated object is a valid v3 in memory; replay and export from it work. Export from a migrated file writes v3.

### Blender importer (`tools/blender_import_recording.py`)

A single `bpy` script, run from Blender's Text Editor (or `blender --python tools/blender_import_recording.py -- take.json`):

1. Reads the JSON; checks `schema` and `version`.
2. Sets `scene.render.fps = round(capture.fps)` and `scene.frame_end = round(durationMs / 1000 * fps)`.
3. For each side present, creates an Empty `Hand.R` / `Hand.L` and 21 child Empties `Hand.R.00` ... `Hand.R.20` (small spheres for visibility).
4. For each frame, sets each child's `location` from `world[i]` and inserts a `location` keyframe at `round(t / 1000 * fps)`. Blender is Z-up; the app is Y-up: `(x, y, z) -> (x, -z, y)`.
5. If `channels` includes `face`, creates a `Face` empty with a custom property per blendshape and keyframes those (drivers can read them). Landmark empties for the face are optional (478 empties is heavy; default off).
6. If `audio` is present, writes `<name>.webm` next to the JSON and adds it as a Sound strip in the Sequencer at frame 1.

Stretch (separate phase): build an Armature with 20 bones along `HAND_CONNECTIONS` and bake the empties' motion onto it, so the take is a rigged hand a character rig can constrain to.

### Unity note

Not built. If a friend on Unity asks: the kinematics JSON is readable with `JsonUtility` (or a 5-line Newtonsoft mapping), and a 30-line `MonoBehaviour` that moves 21 spheres per hand per `Time.time` is the equivalent of the Blender script. Add `tools/UnityRecordingPlayer.cs` at that point, not before.

## Phases and gates

| Phase | Work | Effort | Gate (binary) |
|---|---|---|---|
| 1 | Envelope + compact serialization + measured fps; `migrateV2` on load; kinematics on the new shape | S | Unit tests: serialize then parse round-trips a synthetic 2-hand frame with rounding within tolerance; `migrateV2` maps all three v2 field patterns; a v2 file from the repo's own previous build loads and replays. Main-thread block for a synthetic 30 s hand take under 100 ms (`performance.now` around the call). |
| 2 | Worker serialization + fallback | S | A synthetic 30 s face take exports with no long task over 100 ms in DevTools Performance; the UI stays interactive during export. |
| 3 | Blender importer + a short doc with a screenshot | S | Host-verified: a real hand take recorded in Motion Recorder opens in Blender 4.x and the empties move when scrubbing the timeline. Screenshot committed under `docs/`. |
| 4 | Face stride + blendshape-only frames | S | 30 s face take under 25 MB; puppet replay in the app is visually unchanged. |
| 5 (optional) | Armature bake in the importer | M | The take drives a bone chain in Blender. |

## Test plan

Pure (vitest): envelope builder, rounding, `migrateV2`, kinematics projection, frame lookup helpers shared with TDD-003.

Host-verified: record, export full, export kinematics, export audio, load the full file back, replay with audio, open in Blender. Each gets a checkbox in `HANDOFF.md` when done.

## Risks

- **Worker + Vite.** The `new URL(..., import.meta.url)` pattern is the supported one; the build emits the worker as its own chunk. Verify `npm run build` and the smoke script still pass.
- **Data URL audio on load.** Loaded sessions play audio from a base64 data URL; seeking on data URLs is slower in some browsers than on blob URLs. Convert to a Blob on load (`fetch(dataUrl).then(r => r.blob())`) and use a blob URL. Small fix, do it in phase 1.
- **Coordinate handedness in Blender.** Easy to get mirrored. The importer draws an axis triad at the origin and the doc shows which way "toward the camera" points.

## Open questions

1. Embed audio in the JSON (one file to share) or always sidecar? Proposal: embed by default; a "sidecar audio" checkbox in the export menu later if files get unwieldy.
2. Should `commit` be baked in at build time (`vite define` from `git rev-parse --short HEAD`) or `"unknown"`? Proposal: bake it; it is one line in `vite.config.ts` and it makes bug reports about exports answerable.
