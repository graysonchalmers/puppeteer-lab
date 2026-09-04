# 👁️ Data Visualizer

**Data Visualizer** is a diagnostic tool designed to inspect the raw output of the MediaPipe Hand Landmarker. It is essential for debugging tracking issues, latency, and coordinate mapping algorithms.

## 📊 Features
*   **Video Feed Overlay:** See the webcam input with skeletal overlays.
*   **Raw Metric Dashboard:** View real-time X/Y/Z coordinates and velocity.
*   **Feature Testers:**
    *   **Pinch Detection:** Visualizes distance between Thumb and Index finger.
    *   **Hand State:** Detects Open vs Closed palm states.
    *   **Orientation:** Visualizes the palm normal vector.

## 🛠️ Components
*   **Entry Point:** `DebugView.tsx`
*   **Helper:** `WebcamPreview.tsx` (Used here and in other demos for 2D overlay).
