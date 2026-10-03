/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Builder for the face topology tables (used by tools/gen-face-topology.mjs): picks a ~190-point
 * subset of the 468 face landmarks, Delaunay-triangulates it on the canonical face (frontal,
 * neutral), and cuts holes for the eyes and the mouth. Pure: no file output, no process access.
 *
 * Three variants:
 *  - current: the shipped tables (Delaunay low mesh, canonical full mesh, holes cut).
 *  - flip: current improved by the edge-flip optimizer in 3D; vertices, count and boundary unchanged.
 *  - flow: low mesh re-triangulated with edge-loop chains forced in (oval, eyes, lips, brows, nose
 *    bridge), holes cut exactly at the rings, then optimized with the chain edges locked. Its full
 *    mesh is flip's full mesh.
 */
import fs from 'node:fs';
import Delaunator from 'delaunator';
import { optimize, enforceChains, qualityReport, formatReport } from './meshOpt.mjs';

const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LIPS_OUTER = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const LIPS_INNER_UPPER = [191,80,81,82,13,312,311,310,415];
const LIPS_INNER_LOWER = [95,88,178,87,14,317,402,318,324];
const LIPS_INNER = [78, ...LIPS_INNER_UPPER, 308, ...[...LIPS_INNER_LOWER].reverse()];
const L_EYE_LOWER = [7,163,144,145,153,154,155], L_EYE_UPPER = [173,157,158,159,160,161,246];
const R_EYE_LOWER = [249,390,373,374,380,381,382], R_EYE_UPPER = [398,384,385,386,387,388,466];
const LEFT_EYE = [33, ...L_EYE_LOWER, 133, ...L_EYE_UPPER];
const RIGHT_EYE = [263, ...R_EYE_LOWER, 362, ...R_EYE_UPPER];
const LEFT_EYEBROW = [70,63,105,66,107,55,65,52,53,46];
const RIGHT_EYEBROW = [300,293,334,296,336,285,295,282,283,276];
const NOSE = [168,6,197,195,5,4,1,19,94,2,98,327,129,358,64,294,48,278,115,344,220,440];
// Trimmed 2026-09-22 for a more stylized head: fewer cheek, jaw and chin points.
// Forehead points stay (the brow boost deforms them).
const FILL = [117,123,147,213,187,50,205,36,346,352,376,433,411,280,425,266,
  9,151,108,337,69,299,104,333,71,301,139,368,175,200,18,32,262,135,364,57,287,43,273,192,416];
const MOCAP_POINTS = [117,123,147,213,187,120,346,352,376,433,411,349,9,151,10,108,337,152,175,199,200];

const SUBSET = [...new Set([...FACE_OVAL, ...LIPS_OUTER, ...LIPS_INNER, ...LEFT_EYE, ...RIGHT_EYE,
  ...LEFT_EYEBROW, ...RIGHT_EYEBROW, ...NOSE, ...FILL])];

const frozen = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));

/** Landmark id sets shared by every variant and the CLI. Frozen: copy before reordering. */
export const SETS = frozen({
  FACE_OVAL, LIPS_OUTER, LIPS_INNER_UPPER, LIPS_INNER_LOWER, LIPS_INNER, L_EYE_LOWER, L_EYE_UPPER, R_EYE_LOWER, R_EYE_UPPER,
  LEFT_EYE, RIGHT_EYE, LEFT_EYEBROW, RIGHT_EYEBROW, NOSE, FILL, MOCAP_POINTS, SUBSET,
});

export const FLIP_OPTS = Object.freeze({ wQuality: 1, wValence: 0.1, wDihedral: 1 });
export const FLOW_OPTS = Object.freeze({ ...FLIP_OPTS, wFlow: 0.3 });
const ringOf = (ids) => [...ids, ids[0]];
/** Edge loops forced into the Flow low mesh, in this order. Only `optional` chains may be dropped. */
export const FLOW_CHAINS = Object.freeze([
  { name: 'oval', ids: ringOf(FACE_OVAL) },
  { name: 'left-eye', ids: ringOf(LEFT_EYE) },
  { name: 'right-eye', ids: ringOf(RIGHT_EYE) },
  { name: 'lips-outer', ids: ringOf(LIPS_OUTER) },
  { name: 'lips-inner', ids: ringOf(LIPS_INNER) },
  { name: 'left-brow', ids: ringOf(LEFT_EYEBROW) },
  { name: 'right-brow', ids: ringOf(RIGHT_EYEBROW) },
  { name: 'nose-bridge', ids: [168, 6, 197, 195, 5, 4, 1, 19, 94, 2] },
  { name: 'nasolabial-left', ids: [98, 61], optional: true },
  { name: 'nasolabial-right', ids: [327, 291], optional: true },
].map((c) => Object.freeze({ ...c, ids: Object.freeze(c.ids) })));

/** Parse the reference OBJ: V is 468 x [x, y, z], F is faces as 0-based id triples. */
export function loadObj(objPath) {
  const V = fs.readFileSync(objPath, 'utf8').split('\n')
    .filter((l) => l.startsWith('v '))
    .map((l) => l.trim().split(/\s+/).slice(1, 4).map(Number));
  if (V.length !== 468) throw new Error(`expected 468 vertices, got ${V.length}`);

  const F = fs.readFileSync(objPath, 'utf8').split('\n')
    .filter((l) => l.startsWith('f '))
    .map((l) => l.trim().split(/\s+/).slice(1, 4).map((s) => Number(s.split('/')[0]) - 1));
  return { V, F };
}

export function buildVariants(objPath) {
  const { V, F } = loadObj(objPath);

  // Canonical is y-up; flip to image-like y-down for the 2D triangulation.
  const pos2 = V.map((v) => [v[0], -v[1]]);
  const pos3 = V;
  const P = (i) => pos2[i];

  const inPoly = ([px, py], poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = P(poly[i]);
      const [bx, by] = P(poly[j]);
      if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) c = !c;
    }
    return c;
  };
  const centroid = (t) => [0, 1].map((a) => t.reduce((s, i) => s + P(i)[a], 0) / 3);
  // A triangle "spans" a hole when it touches both lids / both lips.
  const spans = (t, a, b) => t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));

  const isHoleTri = (t) => {
    const c = centroid(t);
    if (spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER) || inPoly(c, LIPS_INNER)) return 'mouth';
    if (spans(t, L_EYE_UPPER, L_EYE_LOWER) || spans(t, R_EYE_UPPER, R_EYE_LOWER) || inPoly(c, LEFT_EYE) || inPoly(c, RIGHT_EYE)) return 'eyes';
    return null;
  };

  const delaunaySubset = () => {
    const d = new Delaunator(SUBSET.flatMap(P));
    const all = [];
    for (let k = 0; k < d.triangles.length; k += 3) all.push([0, 1, 2].map((j) => SUBSET[d.triangles[k + j]]));
    return all;
  };

  const tris = [];
  const removed = { outside: 0, mouth: 0, eyes: 0 };
  for (const t of delaunaySubset()) {
    if (!inPoly(centroid(t), FACE_OVAL)) { removed.outside++; continue; }
    const hole = isHoleTri(t);
    if (hole) { removed[hole]++; continue; }
    tris.push(t);
  }

  const fullTris = [];
  const removedFull = { mouth: 0, eyes: 0 };
  for (const t of F) {
    const hole = isHoleTri(t);
    if (hole) { removedFull[hole]++; continue; }
    fullTris.push(t);
  }

  const LIP_SET = new Set([...LIPS_OUTER, ...LIPS_INNER]);
  const lipFlags = (ts) => ts.map((t) => (t.every((i) => LIP_SET.has(i)) ? 1 : 0));

  // FULL uses centroid-inside-outer-lip-polygon instead of LIP_SET membership: the dense mesh has
  // an unlabeled middle lip ring between LIPS_OUTER and LIPS_INNER, so no real lip-surface triangle
  // ever has all 3 vertices in LIP_SET.
  const LIPS_OUTER_POLY = [...LIPS_OUTER, LIPS_OUTER[0]];
  const lipFlagsFull = (ts) => ts.map((t) => (inPoly(centroid(t), LIPS_OUTER_POLY) ? 1 : 0));

  const current = {
    low: { tris, isLip: lipFlags(tris), removed },
    full: { tris: fullTris, isLip: lipFlagsFull(fullTris), removed: removedFull },
  };

  // Flip: the optimizer on the current tables, boundary and holes unchanged.
  const runFlip = (mesh, flags) => {
    const r = optimize(mesh.tris, { pos2, pos3, ...FLIP_OPTS });
    return { mesh: { tris: r.tris, isLip: flags(r.tris), removed: mesh.removed }, stats: { flips: r.flips, sweeps: r.sweeps, frozen: r.frozen } };
  };
  const flipLow = runFlip(current.low, lipFlags);
  const flipFull = runFlip(current.full, lipFlagsFull);
  const flip = { low: flipLow.mesh, full: flipFull.mesh };

  // Flow (low only): chains forced into the subset's Delaunay, holes cut exactly at the rings, then
  // optimized with the chain edges locked.
  const enforced = enforceChains(delaunaySubset(), pos2, FLOW_CHAINS);
  const removedFlow = { outside: 0, mouth: 0, eyes: 0 };
  const kept = [];
  for (const t of enforced.tris) {
    const c = centroid(t);
    if (!inPoly(c, FACE_OVAL)) { removedFlow.outside++; continue; }
    if (inPoly(c, LIPS_INNER)) { removedFlow.mouth++; continue; }
    if (inPoly(c, LEFT_EYE) || inPoly(c, RIGHT_EYE)) { removedFlow.eyes++; continue; }
    kept.push(t);
  }
  const mean = (ids) => [ids.reduce((s, i) => s + P(i)[0], 0) / ids.length, ids.reduce((s, i) => s + P(i)[1], 0) / ids.length];
  const radius = (c, ids) => Math.max(...ids.map((i) => Math.hypot(P(i)[0] - c[0], P(i)[1] - c[1])));
  const feature = (ids) => { const c = mean(ids); return { c, r: radius(c, ids) }; };
  const centers = [feature(LEFT_EYE), feature(RIGHT_EYE), feature(LIPS_OUTER),
    { c: P(4), r: Math.hypot(P(4)[0] - P(98)[0], P(4)[1] - P(98)[1]) }];
  const rf = optimize(kept, { pos2, pos3, locked: enforced.locked, ...FLOW_OPTS, centers });
  const flow = {
    low: { tris: rf.tris, isLip: lipFlags(rf.tris), removed: removedFlow },
    full: flip.full,
  };

  const stats = {
    flip: { low: flipLow.stats, full: flipFull.stats },
    flow: {
      low: { flips: rf.flips, sweeps: rf.sweeps, frozen: rf.frozen, enforcedFlips: enforced.flips, dropped: enforced.dropped },
      full: flipFull.stats,
    },
  };

  const variants = { current, flip, flow };
  const sections = [];
  for (const name of Object.keys(variants)) {
    for (const mesh of ['low', 'full']) sections.push(formatReport(`${name} ${mesh}`, qualityReport(variants[name][mesh].tris, pos3)));
  }
  const line = (s) => `flips ${s.flips}, sweeps ${s.sweeps}, frozen ${s.frozen}`;
  sections.push([
    'current: no optimization',
    `flip: low ${line(stats.flip.low)}; full ${line(stats.flip.full)}; weights ${JSON.stringify(FLIP_OPTS)}`,
    `flow: low ${line(stats.flow.low)}, enforcedFlips ${stats.flow.low.enforcedFlips}, dropped [${stats.flow.low.dropped.join(', ')}]; full = flip full; weights ${JSON.stringify(FLOW_OPTS)}`,
  ].join('\n'));

  return { V, F, SUBSET, variants, stats, reports: sections.join('\n\n') };
}
