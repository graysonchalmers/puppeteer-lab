/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Eyeball pose for the Face Puppet: a ball centered on the lid opening,
 * sized from the corner-to-corner width and set back so the face mesh around
 * the opening sits in front of it (the lids occlude it when they close). It
 * rotates toward the MediaPipe iris landmark, clamped. Scene units.
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection, toScene, V3 } from './projection';

export const EYE_RADIUS_OF_WIDTH = 0.5;
/** Center depth behind the lid-rim average, in radii (front of the ball just behind the rim). */
export const EYE_SETBACK = 1.05;
/** Max sine of the gaze rotation. */
export const GAZE_MAX = 0.6;

export interface EyePose { center: V3; radius: number; rx: number; ry: number }

export function eyePose(lm: Landmark[], contour: readonly number[], irisIdx: number, p: Projection): EyePose {
  let cx = 0, cy = 0, cz = 0, minX = Infinity, maxX = -Infinity;
  for (const i of contour) {
    const [x, y, z] = toScene(lm[i], p);
    cx += x; cy += y; cz += z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  const n = contour.length;
  cx /= n; cy /= n; cz /= n;
  const radius = Math.max(1, (maxX - minX) * EYE_RADIUS_OF_WIDTH);
  let rx = 0, ry = 0;
  if (lm[irisIdx]) {
    const [ix, iy] = toScene(lm[irisIdx], p);
    let ox = (ix - cx) / radius, oy = (iy - cy) / radius;
    const m = Math.hypot(ox, oy);
    if (m > GAZE_MAX) { ox *= GAZE_MAX / m; oy *= GAZE_MAX / m; }
    ry = Math.asin(ox);  // +Z front turned toward +X
    rx = -Math.asin(oy); // +Z front tilted toward +Y
  }
  return { center: [cx, cy, cz - radius * EYE_SETBACK], radius, rx, ry };
}
