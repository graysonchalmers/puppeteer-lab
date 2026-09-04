
# Puppeteer Lab // System Plan

> **North Star**: **Puppeteer Lab** is a zero-hardware spatial tracking and recording framework for games and media. Using standard webcams and browser-native computer vision, it enables developers and creators to control games, sketch in spatial air, puppeteer 3D characters, and record synchronized mocap and audio without specialized hardware.

---

## The Four Core Demos

### 1. Air Canvas & Hand Tracking
Draw and manipulate lines in 3D space using natural hand gestures.
- **Right Hand Pinch**: Pinch thumb and index to draw glowing 3D vector lines in the air.
- **Left Hand Pinch & Move**: Pinch near any drawn line to grab and reposition it in real time.
- **Hold to Delete**: Hold your left hand stationary on a grabbed line for 1.0s to erase just that stroke.
- **Gravity Spark Particles**: Pinch your left hand in open air to emit sparks with simulated drag and gravity.
- **Air-Touch Dwell Buttons**: Point your index finger at the on-screen Undo (1.2s) or Clear (1.5s) targets to trigger hands-free commands.
- **Hand Telemetry & Smoothing**: 21 3D skeletal landmarks, pinch distance calculations, and real-time smoothing filters.

### 2. Games (Tempo Strike)
Fast-paced spatial gaming powered by webcam tracking. Currently features *Tempo Strike* rhythm action, expanding to multi-game spatial experiences.
- **Dual Laser Sabers**: Your hands directly drive two 3D sabers in real time.
- **Rhythmic Slicing**: Cut oncoming beat cubes in sync with the soundtrack.
- **Velocity Scoring**: High-speed cuts score bonus points; maintain streaks to build multipliers.

### 3. Motion Recorder & 3D Replay
Record physical motion and voice together for games, animation, and analysis.
- **Synchronized Audio & Motion**: Captures 3D skeletal coordinates alongside microphone audio.
- **3D Timeline Scrubber**: Rotate and zoom around your recorded motion with synchronized audio playback.
- **Export for 3D Tools**: Export as complete session JSON, pure 3D mocap coordinates for Blender/Maya/Unity, or standalone WebM audio.

### 4. Face Puppet & Expressions
A stylized 3D character puppet that mirrors your facial expressions and speech.
- **478 Facial Landmarks**: Tracks head rotation, eyebrow raises, smiles, winks, and mouth shapes using 52 blendshapes.
- **Gaze Direction**: 3D character eyes track your real-time gaze.
- **Performance Replay**: Record a voice and facial performance, then watch the character replay it synchronously.

---

## Design Principles
- **Clarity Over Jargon**: Plain, human-readable explanations of all interactions.
- **Direct Feedback**: Visible reticles, progress gauges, and audio feedback for all gestures.
- **Zero Configuration**: Works immediately with any standard webcam.
- **Immediate Action Placement**: Launch and play CTA buttons are positioned directly beneath section titles for immediate, intuitive access.
- **Natural Card Sizing**: Cards fit to a balanced, comfortable height rather than artificially stretching to fill the vertical viewport.

