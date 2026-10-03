/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orbit camera pose: the capture camera (at `front`, looking down -z) rotated rigidly about the pivot by the
 * orbit view. Pure maths over three's vector types so it can be unit-tested without WebGL; PuppetScene only
 * copies the result onto its perspective camera and light rigs.
 */
import * as THREE from 'three';
import { OrbitView } from './orbitState';
import { V3 } from './projection';

export interface OrbitPose {
  position: V3;
  /** Camera orientation as [x, y, z, w]. */
  quaternion: [number, number, number, number];
}

/**
 * Positive yaw moves the camera toward +x; positive pitch lifts it (and tilts it down at the pivot). Rotation
 * about +X by phi sends (0,0,1) to (0,-sin phi,cos phi), so the Euler X angle is the NEGATED pitch.
 */
export function orbitCameraPose(view: OrbitView, pivot: V3, front: V3): OrbitPose {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-view.pitch, view.yaw, 0, 'YXZ'));
  const p = new THREE.Vector3(...pivot);
  const offset = new THREE.Vector3(...front).sub(p).applyQuaternion(q).multiplyScalar(view.zoom);
  const pos = p.add(offset);
  return { position: [pos.x, pos.y, pos.z], quaternion: [q.x, q.y, q.z, q.w] };
}
