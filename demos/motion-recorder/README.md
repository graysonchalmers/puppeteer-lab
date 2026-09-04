
# 📹 Motion Recorder & Replay

**Motion Recorder** is a specialized utility for capturing raw hand tracking data over time and replaying it.

Unlike the **Data Visualizer**, which shows live data overlaid on video, this tool allows you to replay movements in a "clean" 3D void. This is critical for analyzing **Z-axis depth** and **jitter** without the visual noise of the camera feed.

## 🎯 Purpose
1.  **Depth Analysis:** Spin the camera around recorded movements to see if the depth mapping feels "flat" or "deep".
2.  **Algorithm Testing:** Record a difficult movement (like crossing hands) and replay it repeatedly while tweaking smoothing algorithms.
3.  **Data Export:** (Planned) Export gestures as JSON to train custom gesture recognizers.

## 🛠️ Components
*   **Entry Point:** `MotionRecorder.tsx` (To be created)
*   **State Management:** `useRecorder.ts` (Handling the buffer of frame data)

## 🎮 Controls
*   **Record:** Start capturing frame data.
*   **Stop:** End capture.
*   **Play:** Loop the captured sequence.
*   **Scrub:** (Planned) Slider to examine specific frames.
