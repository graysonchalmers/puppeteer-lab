/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Static cavity set for the baked darkening of the look (looks.ts `cavity`): the eye contours, the nostril / nose-wing
 * creases and under the lower lip. Indices are MediaPipe canonical-face landmarks; only those present in a mesh's
 * triangles take effect. A corner in the set has its vertex color dimmed by the look's cavity strength.
 */
import { LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from './faceTopology';

const NOSTRILS = [49, 279, 129, 358, 98, 327, 64, 294, 48, 278, 219, 439, 59, 289, 2, 97, 326];
const UNDER_LIP = [17, 84, 314, 18, 83, 313];

export const CAVITY_VERTS: ReadonlySet<number> = new Set([...LEFT_EYE_CONTOUR, ...RIGHT_EYE_CONTOUR, ...NOSTRILS, ...UNDER_LIP]);

const cache = new WeakMap<readonly number[], Float32Array>();

/** Per-corner 1 if the corner's landmark is in the cavity set, else 0 (corner order = the given triangle list). Cached per array. */
export function cornerCavity(tris: readonly number[]): Float32Array {
  let w = cache.get(tris);
  if (!w) {
    w = new Float32Array(tris.length);
    for (let c = 0; c < tris.length; c++) w[c] = CAVITY_VERTS.has(tris[c]) ? 1 : 0;
    cache.set(tris, w);
  }
  return w;
}
