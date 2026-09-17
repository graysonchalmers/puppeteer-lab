/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps 2D normalized hand-landmark coordinates (plus a depth proxy) to the
 * 3D game-world space used by Tempo Strike, Motion Recorder, and the Hand
 * Telemetry hologram cube. Extracted out of useMediaPipe.ts (TDD-001 Phase 2)
 * so buildFrame can call it without hooks/useMediaPipe.ts (the adapter,
 * which imports useTracker, which imports buildFrame) forming a cycle back
 * through this function's old home.
 */
import * as THREE from 'three';

export const mapHandToWorld = (x: number, y: number, z: number = 0): THREE.Vector3 => {
  const GAME_X_RANGE = 5;
  const GAME_Y_RANGE = 3.5;
  const Y_OFFSET = 0.8;

  const worldX = (0.5 - x) * GAME_X_RANGE;
  const worldY = (1.0 - y) * GAME_Y_RANGE - (GAME_Y_RANGE / 2) + Y_OFFSET;
  const worldZ = z * 8;

  return new THREE.Vector3(worldX, Math.max(0.1, worldY), worldZ);
};
