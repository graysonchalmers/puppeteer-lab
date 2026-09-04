# 📅 [SYS.04] Facial Telemetry & Expression Roadmap

## 🟢 Operational Tools
*   **Face Mesh & Expression Tracker:** 478-point 3D landmarking, iris gaze tracking, 52 blendshape coefficients, and session recorder.
*   **Stylized Animated Puppet Reconstruction:** Renders an animated character face mesh directly onto carbon black canvas, replacing raw video with responsive wireframe contours, jaw/mouth opening cavity, expressive eyebrows with tracking dots, cheek markers, and 3D directional gaze eyeballs.
*   **Picture-in-Picture Webcam HUD:** Secondary miniature webcam feed docked cleanly into corner frame.
*   **Audio-Puppet Sync Replay:** Playing back recorded sessions moves the puppet mesh in real-time sync with user's voice track.

---

## 💡 Planned Face Rigging & Tracking Prototypes

### 1. Cybernetic Mimic Mask
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
