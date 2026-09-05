# 🎨 Air Canvas

**Air Canvas** is a gesture-driven drawing demo. Use hand pinches to draw glowing vector lines, manipulate them in real time, and refine the drawing with smoothing controls.

## 📊 Features
*   **Right-Hand Drawing:** Pinch thumb and index finger (distance < 30px) to draw continuous luminous strokes on the canvas.
*   **Left-Hand Manipulation:** Pinch to select and move a line, or hold still over a line to delete it.
*   **Air-Touch Controls:** Hold any index fingertip in the upper canvas region for 1.5 seconds to undo or clear the canvas (visual progress ring shows charge state).
*   **Global Smoothing:** Adjust post-draw line relaxation to reduce jitter without affecting responsiveness during drawing.
*   **Line Reliability:** Interpolates sparse tracking points, bridges brief tracking dropouts, and applies final smoothing after release.

## 🛠️ Components
*   **Entry Point:** `components/aircanvas/AirCanvas.tsx`
*   **Shared Engine:** `components/shared` provides `resolveHands` (hand tracking state), `useHandRenderLoop` (canvas loop), and camera integration with the Hand Telemetry demo.
