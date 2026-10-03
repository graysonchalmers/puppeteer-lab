# Take cleanup and orbit view

Two playback options on the take viewer (`/t/<id>`) and in Face Puppet playback. Both are off by default and neither changes the recording. Design and rationale: `docs/superpowers/specs/2026-10-02-take-cleanup-and-orbit-design.md`. Build plan: `docs/superpowers/plans/2026-10-02-take-cleanup-and-orbit.md`.

## Clean up

Tracking has dropouts and jitter. **Clean up** smooths a take for playback:

1. **Resample** onto an even time grid (the raw frames arrive at uneven times).
2. **Fill gaps** where the face or a hand vanished, but only gaps up to **300 ms**.
3. **Zero-phase smoothing** (a forward and a backward pass, so motion is not delayed). The strength is adjustable.

What it does not do:

- **Raw is never changed.** Clean up is a view. The recording, its exports and share links stay raw.
- **100 s cap.** The grid holds at most 6000 slots (100 s at 60 fps), so a longer take is played unchanged and the badge says "Take too long to clean up".
- **A gap over 300 ms stays empty.** The badge reports how many gaps were filled and how many were too long to fill.
- **Baked-in lag stays.** If live filtering delayed the motion while recording, that lag is in the data and is not removed.

The switch is remembered across reloads.

## Orbit

**Orbit** swaps the flat front view for a perspective camera you can move around the puppet.

- **Drag** to rotate (desktop mouse or one finger).
- **Wheel** or **pinch** to zoom.
- **Double-tap** or **Reset view** to return to the capture pose.

Limits: yaw +/-75 degrees, pitch +/-40 degrees, zoom 0.5x to 2x. At rest the camera sits where the webcam was, so the first view matches the front view. While Orbit is on, the stage claims touch gestures (`touch-action: none`), so the page does not scroll under a drag; with it off, nothing about touch changes.

Only the front of the head was captured, so turning far shows the puppet's modeled shape, not a scan of the back of your head.

### Accuracy

Hand depth is estimated from apparent size (face width 14.5 cm, hand wrist-to-knuckle 9.5 cm) so it is a plausible 3D view, roughly +/-20 to 30 percent, not metric.

## Checks

`npm run cleanup-check` and `npm run orbit-check` are browser gates (build first, run last). Orbit's gate also records a drag-orbit video and repeats a drag in WebKit on the iPhone profile; proof lands in `.proof/<date>-orbit/` (gitignored). `npm run facedemo-check` covers the live app's own playback path (Face Puppet: import a take, Clean up on a short dropout, Orbit drag/reset/stop/off) the same way; proof lands in `.proof/<date>-facedemo/`.
