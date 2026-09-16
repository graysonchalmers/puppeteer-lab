# TDD-003: Motion Recorder: scrubber, live trail, skeleton replay

| | |
|---|---|
| Status | Proposed (2026-09-06) |
| Serves | **Save** (and stop 4 of the demo tour) |
| Teardown findings | F2 (scrubber promised, not built), F8 (on-mission demo is the weakest) |
| Effort | M overall; phase 1 (scrubber) is S and can land today |
| Depends on | Phases 1 and 2 need nothing. Phase 3 (skeleton replay) needs TDD-001 phase 2 and TDD-002 phase 1. |

## Problem

Motion Recorder is the demo that proves "save it out", and today it records two fingertips, replays them as two spheres, cannot scrub (the hub card says it can), and cannot draw a trail while recording because the buffer is private to `useRecorder` (the component says so in a comment block at [MotionRecorder.tsx:107-152](../../components/MotionRecorder.tsx)). `getPlaybackFrame` finds the current frame with `Array.find` every tick, which is linear in the take length.

## Goals

1. **Scrub**: drag to any time; audio follows; playback pauses while dragging and resumes from the new time.
2. **Trail while recording**: the path draws in as you move, so the recorder shows what it is capturing.
3. **A hand, not a dot**: replay 21 joints and 20 bones per hand in the 3D view.
4. Keep 60 fps with a 60-second take buffered (3600 frames).
5. Old two-point recordings still load and replay as spheres.

## Non-goals

- Editing (trim, split, retime), multiple takes, or a take library.
- Inverse kinematics or a rigged character in the app. That is the Blender importer's job (TDD-002).
- Changing Hand Telemetry's or Face Puppet's recorder UI beyond what the shared `RecorderControls` gains.

## Design

### `useRecorder` additions

- `bufferRef: RefObject<TrackedFrame[]>` exposed. Read-only by convention (documented in the hook's header comment).
- `getPlaybackTimeMs(): number` (a function on a ref, not state) for the scrubber to sample.
- `pausePlayback()`, `resumePlayback()`, and a fixed `seekPlayback(ms)`: seek sets `playbackStartTimeRef = now - ms`, sets `audio.currentTime = ms / 1000`, and if playback is paused leaves it paused.
- `loop: boolean` option (default `true`, as today). While the user is dragging the scrubber, looping is suppressed so the end of the take does not snap back to zero under the thumb.
- Frame lookup by binary search on `t` (frames are appended in time order). Returns the last frame with `t <= playbackTime`, or the first frame.
- `captureFrame(frame: TrackedFrame)` once TDD-001 phase 2 lands; until then it keeps today's `Omit<FrameData, 'timestamp'>` shape.

### Scrubber UI (in `RecorderControls`)

- `<input type="range" min={0} max={durationMs} step={16} />` under the transport buttons, plus a `mm:ss.t / mm:ss.t` readout.
- `onPointerDown`: remember whether it was playing, call `pausePlayback()`.
- `onInput`: `seekPlayback(value)`.
- `onPointerUp` / `onPointerCancel`: `resumePlayback()` if it was playing.
- Disabled while recording or when there is no data.
- The readout samples `getPlaybackTimeMs()` at 10 Hz in a tiny `<PlaybackClock>` component with its own interval, so the main loop never calls `setState`.
- Keyboard: left/right arrows nudge 100 ms; space toggles play. Cheap and good for demos.

### Scene

- `<HandSkeleton hand={TrackedHand | null} color />`: 21 instanced spheres (`<Instances>` from drei, already used for the speed dots) and 20 bone segments as one `<Line>` with `segments`. Uses one `HAND_CONNECTIONS` table imported from the shared render helpers (the duplicate in `WebcamPreview` goes away in TDD-001 phase 4).
- `<Trail side />`: a rolling window of the last 240 tip positions. During recording it reads the tail of `bufferRef.current`; during playback it reads frames up to `getPlaybackTimeMs()` so the trail "draws in" as you scrub. One `<Line>` whose points array is rebuilt at most once per frame from a preallocated `Float32Array`; never rebuild geometry for the whole take.
- Existing `MotionPath` (full path plus speed dots) stays for the stopped state and for loaded files.
- Two-sphere mode: if a hand's `world` is `partial` (migrated v2 file), draw the sphere at `world[8]` and skip the skeleton.

### Hub card

Until phase 1 lands, the card copy must say what exists: "Orbit and replay takes with synced audio." After phase 1: "Orbit, scrub, and replay takes with synced audio." The hub change ships in the same commit as the feature (North Star: show, don't claim).

## Phases and gates

| Phase | Work | Effort | Gate (binary) |
|---|---|---|---|
| 1 | Scrubber + pause/seek semantics + binary search + clock component + hub copy | S | Unit test: `findFrameIndex` for before-first, exact, between, after-last. Host-verified: scrub a take with voice; the sphere position and the audio agree by ear (well under 100 ms); releasing the thumb resumes from there; looping still works when not dragging. |
| 2 | `bufferRef` exposed + `<Trail>` during recording and playback | S | DevTools FPS meter stays at or above 50 fps with a 60 s take buffered while recording. |
| 3 | `<HandSkeleton>` + full-frame capture (after TDD-001 phase 2 and TDD-002 phase 1) | S | A newly recorded take replays as a moving hand; a v2 two-point file still loads and shows spheres. |
| 4 | Keyboard nudge, small polish (time readout, disabled states) | S | Host-verified checklist in `HANDOFF.md`. |

## Test plan

Pure: `findFrameIndex`, seek arithmetic (`playbackStartTimeRef` math), trail window extraction (last N frames with a side present).

Host-verified: record with voice, scrub, resume, export (TDD-002), reload, scrub again.

## Risks

- **Seeking a data-URL audio element** (loaded sessions) can be slow. TDD-002 phase 1 converts loaded audio to a blob URL; do that first if scrubbing a loaded file stutters.
- **`<Instances>` re-mounting** when the hand appears and disappears. Keep the instances mounted and toggle `visible`, as `RecorderScene` already does with the spheres.
- **Trail during recording competes with MediaPipe.** One `Float32Array` update per frame is cheap; if it is not, sample the trail at 30 Hz.

## Open questions

1. Should the scrubber live in the shared `RecorderControls` (Hand Telemetry and Face Puppet get it too) or only in Motion Recorder? Proposal: shared; all three demos replay with audio and all three benefit.
2. Show the trail for both hands or only the one drawing? Proposal: both, colored by side, as everything else is.
