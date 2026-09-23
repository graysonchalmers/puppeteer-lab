/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capsule hand rig for the Face Puppet, in scene units: 16 finger segments
 * (thumb from the wrist, fingers from the knuckles; the palm pad covers the
 * metacarpals), a joint sphere per used landmark (segment + joint spheres =
 * capsules, no stretched caps), and a rounded palm pad frame. Radii per finger,
 * tapering to the tip, scaled by hand size (wrist to middle knuckle).
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection, toScene, V3 } from './projection';

/** [from, to, finger] with finger 0 = thumb .. 4 = pinky. */
export const HAND_SEGMENTS: readonly [number, number, number][] = [
  [0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0],
  [5, 6, 1], [6, 7, 1], [7, 8, 1],
  [9, 10, 2], [10, 11, 2], [11, 12, 2],
  [13, 14, 3], [14, 15, 3], [15, 16, 3],
  [17, 18, 4], [18, 19, 4], [19, 20, 4],
];
/** Base radius per finger as a share of hand size. */
export const FINGER_RADIUS: readonly number[] = [0.13, 0.11, 0.115, 0.105, 0.09];
/** Radius multiplier per segment along a finger (base -> tip). */
export const FINGER_TAPER: readonly number[] = [1, 0.88, 0.78, 0.7];

export interface Segment { a: V3; b: V3; radius: number }
export interface Joint { p: V3; radius: number }
export interface PalmPad { center: V3; u: V3; v: V3; n: V3; su: number; sv: number; sn: number }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const m = len(a) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function handRig(lm: Landmark[], p: Projection) {
  const P = lm.map((l) => toScene(l, p));
  const size = len(sub(P[9], P[0]));

  const segments: Segment[] = [];
  const jointR = new Map<number, number>();
  const segIndex = [0, 0, 0, 0, 0];
  for (const [a, b, f] of HAND_SEGMENTS) {
    const k = segIndex[f]++;
    const taper = f === 0 ? FINGER_TAPER[k] : FINGER_TAPER[k + 1];
    const radius = size * FINGER_RADIUS[f] * taper;
    segments.push({ a: P[a], b: P[b], radius });
    for (const j of [a, b]) jointR.set(j, Math.max(jointR.get(j) ?? 0, radius));
  }
  const joints: Joint[] = [...jointR].map(([j, radius]) => ({ p: P[j], radius }));

  const knuckles = [5, 9, 13, 17].map((i) => P[i]);
  const center: V3 = [0, 1, 2].map((d) => (P[0][d] + knuckles.reduce((s, q) => s + q[d], 0)) / 5) as V3;
  const u = unit(sub(P[9], P[0]));
  let n = unit(cross(u, sub(P[17], P[5])));
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]]; // face the camera; the pad is symmetric
  const v = unit(cross(n, u));
  const width = len(sub(P[17], P[5]));
  return {
    segments,
    joints,
    palm: { center, u, v, n, su: size * 0.55, sv: width * 0.6, sn: (width * 0.6) / 3 } as PalmPad,
  };
}
