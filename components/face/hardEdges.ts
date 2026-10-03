/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edges the Face Puppet's smoothing never crosses, at any crease angle (creaseGroups.ts `hardEdges`): the outer lip
 * ring, the outer edge of the first triangle ring around each eye hole (the lid / eye-socket outline), and the nose
 * underside (alar rim, nose base and the base-of-nose to upper-lip line). Only edges that exist in the given
 * triangle list count, so a chain that a mesh does not contain is simply absent from it.
 */
import { LIPS_OUTER, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from './faceTopology';
import { hardEdgeKey } from './creaseGroups';

/** Landmark chains, left/right mirrored: alar wing -> alar rim -> nostril bottom -> base -> mirror side, and base -> lip line. */
const NOSE_UNDERSIDE: readonly (readonly number[])[] = [
  [48, 64, 98, 60, 94, 290, 327, 294, 278],
  [60, 2, 290],
];

const cache = new WeakMap<readonly number[], ReadonlySet<number>>();

export function hardEdgesFor(tris: readonly number[]): ReadonlySet<number> {
  const hit = cache.get(tris);
  if (hit) return hit;
  const present = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) present.add(hardEdgeKey(tris[t + k], tris[t + (k + 1) % 3]));
  }
  const out = new Set<number>();
  const link = (a: number, b: number) => { const key = hardEdgeKey(a, b); if (present.has(key)) out.add(key); };
  for (let i = 0; i + 1 < LIPS_OUTER.length; i++) link(LIPS_OUTER[i], LIPS_OUTER[i + 1]); // LIPS_OUTER repeats its first id at the end
  for (const chain of NOSE_UNDERSIDE) for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1]);
  for (const contour of [LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR]) {
    const ring = new Set(contour);
    for (let t = 0; t < tris.length; t += 3) {
      const tri = [tris[t], tris[t + 1], tris[t + 2]];
      if (tri.filter((v) => ring.has(v)).length === 1) { const [a, b] = tri.filter((v) => !ring.has(v)); link(a, b); }
    }
  }
  cache.set(tris, out);
  return out;
}
