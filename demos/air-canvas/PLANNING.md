# 📅 Air Canvas Roadmap

## 🟢 Current Implementation

*   **Kinetic Pinch Tracer:** Right hand pinch (<30px) renders continuous luminous strokes; left hand pinch selects/moves lines or deletes on hold.
*   **Air-Touch Dwell Controls:** Index fingertip dwell in upper canvas region (1.5s charge time) triggers undo or full canvas clear with visual progress ring.
*   **Line Smoothing Engine:** Global post-draw relaxation reduces jitter; Line Reliability slider interpolates sparse points and bridges tracking dropouts.
*   **Shared Rendering Loop:** Uses `useHandRenderLoop` and `resolveHands` from components/shared for stable 60fps canvas refresh with mirrored video.

---

## 💡 Planned Enhancements

### 1. Multi-Stroke Undo Stack
*   **Concept:** Maintain full undo history with per-stroke granularity instead of canvas-wide clear.
*   **Implementation:** Store stroke sequence in state; dwell/gesture pops one stroke at a time.

### 2. Color & Brush Variants
*   **Concept:** Gesture or UI controls to vary stroke color, thickness, and glow intensity.
*   **Implementation:** Map hand position or secondary pinch distance to visual parameters.

### 3. Drawing Persistence & Export
*   **Concept:** Save canvas state to local storage or export strokes as SVG vector paths.
*   **Implementation:** Serialize stroke point arrays; add export UI button.

### 4. Collaborative Canvas
*   **Concept:** Transmit pinch traces to other connected clients in real time.
*   **Implementation:** WebSocket or WebRTC bridge to sync hand state and render events.

