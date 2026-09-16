# 📹 Motion Recorder & 3D Replay

**Motion Recorder** captures hand motion and microphone audio over time and replays the take in a clean 3D void, away from the camera feed, so depth and jitter are easy to judge. It is stop 4 of the demo tour in [NORTH_STAR.md](../../NORTH_STAR.md): "record it, replay it, export it."

_Updated 2026-09-06. The previous version of this file predated the component and listed it as "to be created"._

## What works today

- **Record**: each hand's world-space fingertip position per frame (from `handPositionsRef`), plus microphone audio through `MediaRecorder`.
- **Replay**: loops the take with synchronized audio. Orbit and zoom with the mouse. Trail and speed dots draw for a finished or loaded take.
- **Export**: full session JSON (frames plus base64 audio), kinematics JSON (positions only), or the audio track as WebM.
- **Load**: reopen an exported session JSON.

## Not yet

Tracked in [TDD-003](../../docs/tdd/TDD-003-motion-recorder-upgrade.md) and [TDD-002](../../docs/tdd/TDD-002-recording-schema-and-export.md):

- **Scrubbing.** `useRecorder.seekPlayback` exists but has no UI; playback loops only. (Roadmap item 2.)
- **A trail while recording.** The buffer is private to the hook today.
- **Skeleton replay.** Takes hold two fingertips; the replay draws two spheres.
- **An importer for a 3D tool.** Blender first, via a `bpy` script; the export format gets a documented, versioned schema at the same time.

## Components

- Entry point: `components/MotionRecorder.tsx`
- Recorder state, playback, export, load: `hooks/useRecorder.ts`
- Transport UI: `components/RecorderControls.tsx` (shared with Hand Telemetry and Face Puppet)
- Tracking: `hooks/useMediaPipe.ts`

## Controls

- **Record** / **Stop** / **Play** (loops) / **Export** menu / **Load JSON** in the transport panel.
- **Trails** and **Speed** toggles on the 3D view.
- Drag to orbit, scroll to zoom.
