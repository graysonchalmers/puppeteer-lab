/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Static cavity set for the baked darkening some looks apply: landmarks in the eye sockets, the nostril / nose-wing
 * creases and under the lower lip. Indices are MediaPipe canonical-face landmarks; only those present in a mesh's
 * triangles take effect. Starting values: the comparison sheet shows immediately whether a region is wrong.
 */
import type { MeshDetail } from './faceGeometry'; // type-only: faceGeometry imports this module, so no runtime cycle
import { FACE_TRIS, FACE_TRIS_FULL, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from './faceTopology';

const NOSTRILS = [49, 279, 129, 358, 98, 327, 64, 294, 48, 278, 219, 439, 59, 289, 2, 97, 326];
const UNDER_LIP = [17, 84, 314, 18, 83, 313, 200, 421, 199];

export const CAVITY_VERTS: ReadonlySet<number> = new Set([...LEFT_EYE_CONTOUR, ...RIGHT_EYE_CONTOUR, ...NOSTRILS, ...UNDER_LIP]);

const cache = new Map<MeshDetail, Float32Array>();

/** Per-corner 1 if the corner's landmark is in the cavity set, else 0 (corner order = the mesh's triangle list). */
export function cornerCavity(detail: MeshDetail): Float32Array {
  let w = cache.get(detail);
  if (!w) {
    const tris = detail === 'low' ? FACE_TRIS : FACE_TRIS_FULL;
    w = new Float32Array(tris.length);
    for (let c = 0; c < tris.length; c++) w[c] = CAVITY_VERTS.has(tris[c]) ? 1 : 0;
    cache.set(detail, w);
  }
  return w;
}
