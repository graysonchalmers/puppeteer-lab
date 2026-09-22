# 📅 [SYS.04] Facial Telemetry & Expression Roadmap

## 🟢 Operational Tools
*   **Low-poly faceted head:** fixed ~210-vertex topology generated from MediaPipe's canonical face, flat Lambert shading on one gray ramp.
*   **One Euro face smoothing:** a slider over the One Euro filter bank, same slider pattern as hand smoothing.
*   **Ratio + hysteresis mouth:** scale-invariant open ratio with a closed seam at rest and an open cavity when the jaw opens; no flicker at the open/close boundary.
*   **Low-poly hands:** palm fan + tapered finger quads, drawn above the face in the same combined face+hands loop.
*   **Recorder with scrubber:** record, play, pause/resume, and scrub a take.
*   **Exports:** Video (MP4 or WebM, with audio when captured), Pack (`.zip` of video + `recording.json`), Full JSON, Kinematics, Audio.

---

## 💡 Planned Face Rigging & Tracking Prototypes

### 1. Cybernetic Mimic Mask
*   **Status:** partly realized by the 2026-09-22 Face Puppet overhaul: a faceted low-poly head mesh now morphs with the user's face (mouth open/close, jaw displacement). No WebGL wireframe/helmet styling, brow visor, or eyelid shutters; the shading is flat Lambert on one gray ramp, not a cybernetic look.
*   **Concept:** Real-time 3D wireframe head mesh/helmet rendered in WebGL that morphs with the user's face.
*   **Expression Binding:**
    *   *Mouth Open:* Drops lower jaw geometry and triggers inner cyan glow.
    *   *Brow Raise / Furrow:* Tilts brow visor angle and adjusts warning LED indicators.
    *   *Eye Blink:* Closes digital eyelid shutters.
    *   *Head Rotation (Yaw/Pitch/Roll):* Directly steers the 3D model's orientation matrix.

### 2. Gaze Focus Raycaster
*   **Concept:** Uses the iris landmarks (indices 468-477) to estimate screen gaze intersection.
*   **Application:** Enables eye-driven target selection and visual fixation heatmaps.

### 3. Micro-Expression Classifier
*   **Concept:** Heuristic scoring algorithm that tracks blink rate, fatigue indicators, head nod cadence, and smile/frown symmetry over time.
