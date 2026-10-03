/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reproduces EVEN_ADD in tools/lib/faceTopologyBuild.mjs: the extra canonical landmarks of the "even" low mesh.
 * Greedy and additive: each round adds the landmark (with its x-mirror partner, so the mesh stays symmetric) that most
 * lowers the sliver penalty sum(max(0, 30 - minAngle)^2) of the Delaunay + edge-flip low mesh. Slow (~10 s per round).
 *
 * Run: node tools/pick-even-vertices.mjs [pairs=24]
 * Paste the printed list into EVEN_ADD, then regenerate with `node tools/gen-face-topology.mjs --variant even --out <path>`.
 */
import { buildVariants, SETS } from './lib/faceTopologyBuild.mjs';
import { triShape } from './lib/meshOpt.mjs';

const ROUNDS = Number(process.argv[2] ?? 24);
const B = buildVariants('tools/data/canonical_face_model.obj');
const { V } = B;
const base = [...SETS.SUBSET];
const P = (i) => [V[i][0], -V[i][1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// x-mirror partner: the canonical vertex nearest the reflected position (itself for the midline).
const mirror = V.map((v) => {
  let best = 0;
  for (let j = 1; j < V.length; j++) if (dist(V[j], [-v[0], v[1], v[2]]) < dist(V[best], [-v[0], v[1], v[2]])) best = j;
  return best;
});

const pen = (a) => Math.max(0, 30 - a) ** 2;
const score = (m) => m.tris.reduce((s, t) => s + pen(triShape(V, t).minAngle), 0);
const usable = (i) => B.inPoly(P(i), [...SETS.FACE_OVAL]) && !B.inPoly(P(i), SETS.LEFT_EYE)
  && !B.inPoly(P(i), SETS.RIGHT_EYE) && !B.inPoly(P(i), SETS.LIPS_INNER);
const cands = [...Array(468).keys()].filter((i) => !base.includes(i) && usable(i) && usable(mirror[i]) && !base.includes(mirror[i]));

let cur = [...base];
let curScore = score(B.lowFlipFor(cur));
const added = [];
for (let r = 0; r < ROUNDS; r++) {
  let best = null;
  for (const c of cands) {
    if (cur.includes(c)) continue;
    const pair = [...new Set([c, mirror[c]])];
    const s = score(B.lowFlipFor([...cur, ...pair]));
    if (best === null || s < best.s) best = { pair, s };
  }
  if (best === null || best.s >= curScore - 1) break;
  cur.push(...best.pair);
  added.push(...best.pair);
  curScore = best.s;
  console.error(`${r + 1}: +${best.pair.join(',')} score ${curScore.toFixed(0)}`);
}
console.log(`[${added.join(', ')}]`);
