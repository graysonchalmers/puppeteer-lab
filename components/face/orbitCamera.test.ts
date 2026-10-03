/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FRONT_VIEW } from './orbitState';
import { orbitCameraPose } from './orbitCamera';
import { V3 } from './projection';

const FRONT: V3 = [320, -240, 900];
const PIVOT: V3 = [320, -200, 0];
const deg = (d: number) => (d * Math.PI) / 180;

const forward = (q: [number, number, number, number]): THREE.Vector3 =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]));
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('orbitCameraPose', () => {
  it('the front view is the capture camera: at the front point with the identity rotation', () => {
    const pose = orbitCameraPose(FRONT_VIEW, PIVOT, FRONT);
    pose.position.forEach((c, i) => expect(c).toBeCloseTo(FRONT[i], 6));
    expect(pose.quaternion[0]).toBeCloseTo(0, 9);
    expect(pose.quaternion[1]).toBeCloseTo(0, 9);
    expect(pose.quaternion[2]).toBeCloseTo(0, 9);
    expect(pose.quaternion[3]).toBeCloseTo(1, 9);
  });

  it('positive yaw moves the camera toward +x and keeps its height', () => {
    const pose = orbitCameraPose({ ...FRONT_VIEW, yaw: deg(30) }, PIVOT, FRONT);
    expect(pose.position[0]).toBeGreaterThan(FRONT[0]);
    expect(pose.position[1]).toBeCloseTo(FRONT[1], 6);
  });

  it('positive pitch lifts the camera and tilts it to look down at the pivot', () => {
    const up = orbitCameraPose({ ...FRONT_VIEW, pitch: deg(25) }, PIVOT, FRONT);
    expect(up.position[1]).toBeGreaterThan(FRONT[1]);
    expect(forward(up.quaternion).y).toBeLessThan(0);
    const down = orbitCameraPose({ ...FRONT_VIEW, pitch: deg(-25) }, PIVOT, FRONT);
    expect(down.position[1]).toBeLessThan(FRONT[1]);
    expect(forward(down.quaternion).y).toBeGreaterThan(0);
  });

  it('a pivot on the optical axis stays dead ahead of the camera for any yaw and pitch', () => {
    const pivot: V3 = [320, -240, 0];
    for (const view of [
      { yaw: deg(40), pitch: deg(20), zoom: 1 },
      { yaw: deg(-65), pitch: deg(-30), zoom: 1.5 },
    ]) {
      const pose = orbitCameraPose(view, pivot, FRONT);
      const toPivot = new THREE.Vector3(...pivot).sub(new THREE.Vector3(...pose.position)).normalize();
      const f = forward(pose.quaternion);
      expect(f.x).toBeCloseTo(toPivot.x, 6);
      expect(f.y).toBeCloseTo(toPivot.y, 6);
      expect(f.z).toBeCloseTo(toPivot.z, 6);
    }
  });

  it('zoom scales the camera distance from the pivot without changing direction', () => {
    const base = orbitCameraPose({ yaw: deg(20), pitch: deg(10), zoom: 1 }, PIVOT, FRONT);
    const far = orbitCameraPose({ yaw: deg(20), pitch: deg(10), zoom: 2 }, PIVOT, FRONT);
    const near = orbitCameraPose({ yaw: deg(20), pitch: deg(10), zoom: 0.5 }, PIVOT, FRONT);
    const d = dist(base.position, PIVOT);
    expect(dist(far.position, PIVOT)).toBeCloseTo(2 * d, 6);
    expect(dist(near.position, PIVOT)).toBeCloseTo(0.5 * d, 6);
    const dir = (pos: V3) => new THREE.Vector3(...pos).sub(new THREE.Vector3(...PIVOT)).normalize();
    const b = dir(base.position);
    for (const other of [far, near]) {
      const o = dir(other.position);
      expect(o.x).toBeCloseTo(b.x, 6);
      expect(o.y).toBeCloseTo(b.y, 6);
      expect(o.z).toBeCloseTo(b.z, 6);
    }
    expect(far.quaternion).toEqual(base.quaternion);
  });

  it('orbits about a non-origin pivot at the front distance times zoom', () => {
    const pivot: V3 = [500, -100, 40];
    const radius = dist(FRONT, pivot);
    const pose = orbitCameraPose({ yaw: deg(-50), pitch: deg(15), zoom: 1.25 }, pivot, FRONT);
    expect(dist(pose.position, pivot)).toBeCloseTo(radius * 1.25, 6);
  });
});
