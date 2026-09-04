# 📅 [SYS.02] Kinetic Games & Interaction Roadmap

## 🟢 Operational Games
*   **Tempo Strike (Playable 3D Slasher):** Slice spark crystals to the rhythm of 140 BPM electronic tracks using hand velocity vectors.

---

## 💡 Planned Games & Kinetic Prototypes

### 1. Spatial Pong (3D Dual-Paddle Reflex)
*   **Concept:** Use left and right hands as 3D reflective barrier planes in front of the camera. A glowing kinetic orb bounces between walls in a perspective tunnel.
*   **Modes:**
    *   *Solo Reflex (1 Player):* Rally back and forth using both hands; ball accelerates with each deflection.
    *   *Co-Op Split (2 Player):* Left player controls left boundary paddle, right player controls right boundary paddle.
    *   *Curve Control:* Impart spin on the ball based on hand velocity at contact moment.
*   **Kinematic Mechanic:** Depth calculation (`Z`) detects push/pull forward slams for power smashes.

### 2. Kinetic Particle Well
*   **Concept:** Hands generate dynamic Newtonian gravity wells. Holding palms open attracts a cloud of 5,000 spatial particles; closing into fists or pushing forward detonates the cluster outward.

### 3. Marionette IK String Rig
*   **Concept:** Optical puppeteering—fingertips act as marionette crossbar anchors. Dropping or raising fingers pulls inverse-kinematic strings connected to a ragdoll puppet.

---

## 📝 Tempo Strike Feature Backlog

### Visuals & FX
- [ ] **Slice Particles:** Add directional sparks when a saber cuts through a note.
- [ ] **Saber Trails:** Add a ribbon trail behind the sabers to emphasize movement speed.
- [ ] **Dynamic Lighting:** Make the environment react more intensely to the music (e.g., flashing on kick drums).
- [ ] **Floating Text:** Show score numbers ("+100") popping up at the hit location.

### Gameplay
- [ ] **Directional Cutting:** Enforce specific cut directions (Up, Down, Left, Right) for certain notes.
- [ ] **Obstacles:** Add "Walls" that the player must dodge with their head/hands.
- [ ] **Difficulty Modes:** Create Easy/Hard variations of the chart.

### Audio
- [ ] **SFX:** Add specific sounds for "Slash", "Miss", and "Combo Break".
- [ ] **Audio Latency Calibration:** A tool to offset audio visuals for different hardware.

### Tech Debt
- [ ] **Note Pooling:** Optimization to reuse Note objects instead of destroying/recreating them to reduce Garbage Collection hiccups.

