# 📅 [SYS.01] Data Matrix & Visual Synthesis Roadmap

## 🟢 Operational Tools
*   **3D Coordinate Matrix:** Raw 21-joint 3D hand landmarks, basis orientation vectors, pinch distance, and interactive hologram manipulation.
*   **Default Analysis Telemetry Suite:** Enabled all measurement tools by default (Basis RGB vectors, palm distance, finger span, thumb gap, pinky gap, body center estimation).
*   **NASA Telemetry Typography:** Replaced emojis in gesture classifiers with high-contrast mission status text.
*   **Kinetic Pinch Tracer (Air Canvas):**
    *   Right Hand Pinch (<30px): Renders continuous luminous strokes.
    *   Left Hand Pinch (<30px): Emits drifting physical spark particles.
    *   Instant canvas wipe and active pinch indicator HUD.
*   **Air-Touch Dwell Clear Button (Hands-Free):** Interactive HUD target in upper canvas; holding any index fingertip within target zone for 1.5 seconds charges a circular progress ring and clears all strokes and sparks without mouse interaction.
*   **High-Contrast Monochromatic Drop Shadows:** All vector connectors, distance indicators, basis vectors, and text labels render with a dark drop shadow (`rgba(0,0,0,0.85)`) to eliminate visual clash and tangling as hands whip across the screen.
*   **Docked Hologram Target:** Compact 3D object resting in corner space that can be grabbed and translated across the camera field of view via pinch kinematics.

---

## 💡 Planned Visual & Generative Prototypes

### 1. Chromatic Fractal Sandbox
*   **Concept:** Real-time WebGL shader rendering a complex Mandelbrot or Julia fractal set.
*   **Optical Mapping:**
    *   *Span (Distance between hands):* Governs fractal zoom depth and scale.
    *   *Pinch Distance:* Adjusts color spectrum cycling and palette gradient interpolation.
    *   *Wrist Rotation (Roll):* Rotates the fractal complex coordinate plane in real time.

### 2. Spatial Theremin Synthesizer
*   **Concept:** Pure optical electronic instrument mimicking the classic Leon Theremin setup without physical contact.
*   **Optical Mapping:**
    *   *Right Hand Elevation (Y-axis):* Continuous pitch control across 4 octaves.
    *   *Left Hand Proximity (Z-axis):* Amplitude, low-pass filter cutoff, and resonance modulation.

### 3. Latency & Jitter Scope
*   **Concept:** Oscilloscope readout calculating Euclidean landmark variance when holding hands stationary to benchmark camera framerates and test smoothing filters.

