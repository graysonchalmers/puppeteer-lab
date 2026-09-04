
# 📅 [SYS.03] Spatial Recorder & Transpose Roadmap

## 🟢 Operational Tools
*   **Motion Recorder & 3D Replay:** Captures raw coordinate frames at 30-60 FPS, plays back with velocity color gradients, provides timeline scrubber, and exports/imports JSON sessions.
*   **Synchronized Audio Track Capture:** Automatically records microphone audio streams synchronously with optical frames via `MediaRecorder`.
*   **Synchronous Audio Playback & Scrubbing:** Audio automatically starts, pauses, loops, and seeks along with the 3D replay scrubber.
*   **Multi-Format Export Engine:** Direct export to full `.puppeteer.json` bundles, lightweight `.kinematics.json` animation time-series (for Blender/Three.js), and isolated `.webm` audio tracks.

---

## 💡 Planned Transpose & Mapping Tools

### 1. Custom Channel Remapper (MIDI / OSC)
*   **Concept:** Map raw spatial coordinates directly to arbitrary hardware/software targets.
*   **Routing Options:**
    *   *Wrist Roll (Z-rotation):* CC 1 (Modulation Wheel).
    *   *Thumb-Index Pinch Distance:* CC 74 (Filter Cutoff).
    *   *Hand Z-Velocity:* Note Velocity or Aftertouch.
    *   *OSC Broadcast:* UDP transmission of raw vector bundles to Ableton Live, Max/MSP, or TouchDesigner.

### 2. Spline Optimizer & Trajectory Filter
*   **Concept:** Post-processing pipeline that applies B-spline interpolation to turn noisy webcam trajectories into butter-smooth curved motion paths.

### 3. Multi-Format Transposer
*   **Concept:** Convert raw JSON sessions into industry-standard formats:
    *   `BVH` (BioVision Hierarchical animation format).
    *   `CSV` (Kinematic time-series for science/biomechanics).
    *   `GLTF/AnimationTrack` (Ready to drop into Blender, Unreal, or Unity).

