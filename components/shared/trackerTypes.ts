/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One frame shape for hand (and, from Phase 3, face) tracking (TDD-001).
 * Plain, serializable data — no THREE.Vector3 — so the recorder can store
 * frames verbatim and consumers wrap at the edge if they want a THREE type.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackedHand {
  side: 'left' | 'right';
  score: number;             // handedness confidence, 0..1
  landmarks: Landmark[];     // 21, normalized image space, SMOOTHED (what demos draw)
  rawLandmarks: Landmark[];  // 21, exactly as MediaPipe returned them
  world: Vec3[];             // 21, world units via mapHandToWorld with this hand's depth
  tip: Vec3;                 // world[8]; the value Tempo Strike and Motion Recorder use today
  velocity: Vec3;            // world units per second, from the smoothed tip
  pinch: number;             // thumb tip to index tip distance in NORMALIZED units (not pixels)
}

export interface TrackedFace {
  landmarks: Landmark[];                 // 478
  blendshapes: Record<string, number>;   // ARKit-style scores by name
  transform: number[] | null;            // 16 floats, column-major, from facialTransformationMatrixes
}

export interface TrackedFrame {
  t: number;                 // ms, performance.now() at capture
  dt: number;                // ms since the previous frame (0 on the first)
  hands: TrackedHand[];      // 0..2, after confidence gating
  left: TrackedHand | null;
  right: TrackedHand | null;
  face: TrackedFace | null;
}
