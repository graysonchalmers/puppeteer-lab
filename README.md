# PUPPETEER LAB
### Tracking and Recording for Games and Media

**Puppeteer Lab** is a zero-hardware spatial tracking and recording framework for games and media. Using standard webcams and browser-native computer vision, it enables developers and creators to control games, sketch in spatial air, puppeteer 3D characters, and record synchronized mocap and audio without specialized hardware.

## The Four Core Demos

1. **Air Canvas & Hand Tracking**: Draw in 3D air with right-hand pinches, move lines or hold-to-delete with your left hand, emit gravity sparks, and use air-touch Undo and Clear buttons.
2. **Games (Tempo Strike)**: Fast-paced 3D spatial gaming where your hands become dual laser sabers to slash beats.
3. **Motion Recorder & 3D Replay**: Record physical 3D hand motion and audio synchronously, scrub the timeline in 3D, and export mocap data for Blender, Maya, and Unity.
4. **Face Puppet & Expressions**: Stylized 3D character puppet that mirrors your head movements, eye gaze, and 52 facial blendshapes in real time.

## Technical Guide

This guide explains how the tracking layer works so you can replicate it in your own application.

### 1. Core Technology

*   **Library:** `@mediapipe/tasks-vision`
*   **3D Renderer:** `@react-three/fiber` (R3F) & `@react-three/drei` with Three.js (v0.167)
*   **Runtime Framework:** React 18 (paired with R3F for stable reconciler execution)
*   **Model:** Hand Landmarker (detects 21 3D landmarks per hand) & Face Landmarker (478 landmarks + blendshapes)
*   **Delegate:** GPU (WebGL) for high-performance inference.


### 2. Architecture

The tracking logic is encapsulated in a custom React hook (`hooks/useMediaPipe.ts`). This separates the computer vision logic from the UI and Game Loop.

#### Data Flow

1.  **Webcam Input:** A hidden HTML `<video>` element streams the camera feed.
2.  **Inference Loop:** A `requestAnimationFrame` loop passes video frames to the MediaPipe `HandLandmarker`.
3.  **Coordinate Mapping:** Normalized 2D coordinates (0-1) are converted to 3D World coordinates.
4.  **State Updates:** Data is written to a Mutable Ref (`useRef`) to avoid triggering React re-renders 60 times a second.
5.  **Game Loop:** The 3D scene reads from this Ref to update the Saber positions.

### 3. Implementation Details

#### Initialization (`hooks/useMediaPipe.ts`)

You must load the WASM binaries and the model asset.

```typescript
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
);

const landmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
    delegate: "GPU" // Critical for performance
  },
  runningMode: "VIDEO",
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
```

#### The Detection Loop

We do not use `useState` for the loop because it triggers React reconciliation, which is too slow for a high-speed rhythm game. Instead, we use a recursive `requestAnimationFrame` function.

```typescript
const predictWebcam = () => {
    let startTimeMs = performance.now();
    if (landmarkerRef.current && videoRef.current) {
        const results = landmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
        processResults(results); // Logic to update Refs
    }
    requestAnimationFrame(predictWebcam);
};
```

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

For future plans and feature tracking, please see [PLANNING.md](./PLANNING.md).
