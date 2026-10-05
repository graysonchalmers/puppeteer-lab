# PUPPETEER LAB
### Webcam hand mocap: track it, drive things with it, save it out

**Puppeteer Lab** is a test bed that proves a plain webcam is enough to motion-capture your hands (and face) in the browser, drive objects with the result, and record the performance for use elsewhere. No gloves, no depth camera, no install beyond `npm`. It exists to show game-dev friends what zero-hardware tracking can do and to be a place to try ideas. The goal and the bar for "done" are in [NORTH_STAR.md](NORTH_STAR.md).

## The five demos (the tour, in order)

1. **Hand Telemetry**: what the camera sees. Skeleton, confidence gate, inter-hand distances, smoothing, a pinch-grabbable 3D cube, and a landmark recorder.
2. **Air Canvas**: drive a 2D thing. Pinch to draw glowing lines, grab and move them with the other hand, dwell to undo or clear, with a Line Reliability control that bridges tracking dropouts.
3. **Tempo Strike**: drive 3D things in a game loop. Your hands become two sabers; slice beats in time with the music; velocity scores.
4. **Motion Recorder**: save it out. Record hand motion with microphone audio, replay it in a 3D void you can orbit, export as JSON or WebM. Scrub with the timeline. (Skeleton replay is still on the roadmap.)
5. **Face Puppet**: same pattern, different model. A stylized puppet driven by 478 landmarks and 52 blendshapes, with recorded voice replay.

## Start here

- [NORTH_STAR.md](NORTH_STAR.md): what this is, who it is for, what done looks like.
- [PLANNING.md](PLANNING.md): the ordered, gated roadmap and the demo-day checklist.
- [docs/tdd/](docs/tdd/): technical design docs for each workstream (tracker core, recording schema and export, recorder upgrade, offline assets).
- [docs/adr/](docs/adr/): decisions and why.
- [docs/TEARDOWN-2026-09-06.md](docs/TEARDOWN-2026-09-06.md): the latest adversarial review, with evidence.
- [HANDOFF.md](HANDOFF.md): where the last session stopped and the next concrete step.

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in desktop Chrome, allow the camera (and the microphone for the recorder demos), and the app opens on Face Puppet (the menu lists the other demos). Tracking initializes in a few seconds. The MediaPipe WASM and models ship with the build (`npm install` vendors them); Tailwind and the Tempo Strike song still load from CDNs, so the app is not fully offline yet.

## How to verify

```bash
npm run typecheck
npm test
npm run build
npm run smoke
```

CI runs the same four steps on every push. They prove types, the pure math (hand assignment, smoothing, line reliability), the bundle, and that no secret leaks into `dist/`. They cannot prove tracking: the automated browsers have WebGL but only a fake camera (no face). Anything hand-driven is verified by a person in real Chrome and the result is written in `HANDOFF.md`.

## Technical Guide

This guide explains how the tracking layer works so you can replicate it in your own application.

### 1. Core Technology

*   **Library:** `@mediapipe/tasks-vision`
*   **3D Renderer:** `@react-three/fiber` (R3F) & `@react-three/drei` with Three.js (v0.167)
*   **Runtime Framework:** React 18 (paired with R3F for stable reconciler execution)
*   **Model:** Hand Landmarker (detects 21 3D landmarks per hand) & Face Landmarker (478 landmarks + blendshapes)
*   **Delegate:** GPU (WebGL) for high-performance inference.


### 2. Architecture

The tracking logic lives in one React hook (`hooks/useTracker.ts`, which emits a `TrackedFrame`); `hooks/useMediaPipe.ts` is a thin adapter the older hand demos still read through. This separates the computer vision logic from the UI and Game Loop.

#### Data Flow

1.  **Webcam Input:** A hidden HTML `<video>` element streams the camera feed.
2.  **Inference Loop:** A `requestAnimationFrame` loop passes video frames to the MediaPipe `HandLandmarker`.
3.  **Coordinate Mapping:** Normalized 2D coordinates (0-1) are converted to 3D World coordinates.
4.  **State Updates:** Data is written to a Mutable Ref (`useRef`) to avoid triggering React re-renders 60 times a second.
5.  **Game Loop:** The 3D scene reads from this Ref to update the Saber positions.

### 3. Implementation Details

#### Initialization (`hooks/useTracker.ts`)

The WASM and the `.task` models are vendored into `public/` by `npm install` (`scripts/vendor-assets.mjs`; paths in `hooks/mediapipeAssets.ts`). The hand and face landmarkers load in `VIDEO` mode, GPU delegate first with a CPU fallback, while the camera permission prompt is already up.

#### The Detection Loop

A `requestAnimationFrame` loop detects **once per new camera frame** (it skips ticks where `video.currentTime` has not advanced) and writes one `TrackedFrame` to a ref, so React never re-renders per frame. Face landmarks go through a One Euro filter (lips filtered lighter, so speech survives). When both models run and their cost no longer fits a 30 fps frame, the hands run on alternate ticks and the face keeps full rate. `?debug` or the DEBUG toggle shows the live numbers.

#### Coordinate Mapping (2D to 3D)

MediaPipe returns coordinates normalized from 0.0 to 1.0.
*   `x`: 0 (left) to 1 (right)
*   `y`: 0 (top) to 1 (bottom)

To map this to a 3D Three.js scene (where 0,0 is the center of the screen):

1.  **Mirroring:** We subtract `x` from `0.5` so moving your physical right hand moves the virtual hand on the right side of the screen.
2.  **Scaling:** Multiply by your game world dimensions (e.g., 5 units wide).
3.  **Inverting Y:** 3D space usually has +Y as "up", but screen space has +Y as "down".

```typescript
const mapHandToWorld = (x: number, y: number, z: number = 0): THREE.Vector3 => {
  const GAME_X_RANGE = 5; 
  const GAME_Y_RANGE = 3.5;
  const Y_OFFSET = 0.8; // Adjust based on camera height

  // (0.5 - x) handles centering and mirroring
  const worldX = (0.5 - x) * GAME_X_RANGE; 
  
  // (1.0 - y) flips the axis so Up is Up
  const worldY = (1.0 - y) * GAME_Y_RANGE - (GAME_Y_RANGE / 2) + Y_OFFSET;

  // Depth: `z` is the hand's deviation from its baseline size (positive = closer,
  // negative = farther). Scale it up so movement toward/away reads in the world.
  const worldZ = z * 8;

  return new THREE.Vector3(worldX, Math.max(0.1, worldY), worldZ);
};
```

#### Velocity Calculation

To detect "slashes" vs "holding still", we calculate velocity manually:

```typescript
const delta = (now - lastTimestamp) / 1000; // Time in seconds
velocity = (currentPosition - lastPosition) / delta;
```

We smooth the position using Linear Interpolation (`lerp`) to reduce camera jitter:

```typescript
currentPos.lerp(newTargetPos, 0.6); // 0.6 = snap quickly, 0.1 = very smooth/laggy
```

### 4. Visual Debugging (`components/WebcamPreview.tsx`)

It is crucial to have a 2D overlay to verify tracking.
1.  Draw the video frame to a canvas.
2.  Draw the landmarks provided by `results.landmarks`.
3.  Note: The Canvas usually needs `ctx.scale(-1, 1)` to match the mirrored game logic.

### 5. Tips for Replication

1.  **Lighting:** MediaPipe struggles in low light. Ensure your app warns the user.
2.  **Performance:** Always run the detector in a `useEffect`. Never put the detection logic directly in the React render body.
3.  **Handedness:** MediaPipe's "Right" hand label refers to the *user's* physical right hand. In a mirrored "selfie" view, this appears on the right side of the screen.
4.  **Landmarks:** Index 8 is the Index Finger Tip. Index 0 is the Wrist. Use Index 8 for "saber" or "pointer" logic.

## Resources

*   [MediaPipe Hand Landmarker Docs](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
*   [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)

## Roadmap

The ordered plan with gates is [PLANNING.md](./PLANNING.md). The per-demo `demos/*/PLANNING.md` files are unranked idea backlogs, not commitments.
