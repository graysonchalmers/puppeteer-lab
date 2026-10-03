/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Triangle-mesh edge optimization for the face topology generator (tools/gen-face-topology.mjs). Pure functions over
 * triangle lists (arrays of 3 vertex ids, consistently wound in the 2D frontal projection) with per-vertex positions
 * pos2[i] = [x, y] (the projection the triangulation lives in) and pos3[i] = [x, y, z] (the canonical face in 3D).
 *
 * Edge-flip optimization: a flip replaces the shared edge of two triangles with the other diagonal of their quad. It is
 * applied only when the quad is strictly convex in 2D (no fold-over), the edge is neither locked nor on the boundary,
 * and the exact change in a global energy is strictly negative, so the sweeps terminate and the result is deterministic.
 * Energy = wQuality * sum(1 - triangle quality) + wValence * sum((valence - target)^2)
 *        + wDihedral * sum(dihedral over interior edges) + wFlow * sum(flow penalty over interior edges).
 */
export const edgeKey = (a, b) => (a < b ? a * 1024 + b : b * 1024 + a);
export const keyEdge = (k) => [Math.floor(k / 1024), k % 1024];
export const orient2 = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

const EPS = 1e-9;
const DEFAULTS = { wQuality: 1, wValence: 0.1, wDihedral: 1, wFlow: 0, centers: [], maxSweeps: 50 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

export function buildAdjacency(tris) {
  const adj = new Map();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(t[k], t[(k + 1) % 3]);
      const l = adj.get(key);
      if (l) l.push(i); else adj.set(key, [i]);
    }
  });
  return adj;
}

export function boundaryKeys(tris) {
  const out = new Set();
  for (const [k, l] of buildAdjacency(tris)) if (l.length === 1) out.add(k);
  return out;
}

export function valences(adj) {
  const v = new Map();
  for (const k of adj.keys()) {
    const [a, b] = keyEdge(k);
    v.set(a, (v.get(a) ?? 0) + 1);
    v.set(b, (v.get(b) ?? 0) + 1);
  }
  return v;
}

function boundaryVertices(bnd) {
  const s = new Set();
  for (const k of bnd) { const [a, b] = keyEdge(k); s.add(a); s.add(b); }
  return s;
}

export function triQuality(pos3, t) {
  const a = pos3[t[0]], b = pos3[t[1]], c = pos3[t[2]];
  const ab = sub(b, a), ac = sub(c, a), bc = sub(c, b);
  const area = 0.5 * len(cross(ab, ac));
  const s = dot(ab, ab) + dot(ac, ac) + dot(bc, bc);
  return s > 0 ? (4 * Math.sqrt(3) * area) / s : 0;
}

function unitNormal(pos3, t) {
  const a = pos3[t[0]], b = pos3[t[1]], c = pos3[t[2]];
  const n = cross(sub(b, a), sub(c, a));
  const l = len(n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function dihedral(pos3, t1, t2) {
  return Math.acos(Math.max(-1, Math.min(1, dot(unitNormal(pos3, t1), unitNormal(pos3, t2)))));
}

/** 0 (edge tangent to the nearest feature ring) .. 1 (edge pointing radially at it); only near a feature center. */
export function flowPenalty(pos2, centers, a, b) {
  let worst = 0;
  const mx = (pos2[a][0] + pos2[b][0]) / 2, my = (pos2[a][1] + pos2[b][1]) / 2;
  const ex = pos2[b][0] - pos2[a][0], ey = pos2[b][1] - pos2[a][1];
  const el = Math.hypot(ex, ey) || 1;
  for (const { c, r } of centers) {
    const dx = mx - c[0], dy = my - c[1];
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-9 || dl > 2.2 * r) continue;
    const p = (1 - dl / (2.2 * r)) * Math.abs((ex / el) * (dx / dl) + (ey / el) * (dy / dl));
    if (p > worst) worst = p;
  }
  return worst;
}

export function totalEnergy(tris, { pos2, pos3, ...opts }) {
  const o = { ...DEFAULTS, ...opts };
  const adj = buildAdjacency(tris);
  const val = valences(adj);
  const bv = boundaryVertices(boundaryKeys(tris));
  let e = 0;
  for (const t of tris) e += o.wQuality * (1 - triQuality(pos3, t));
  for (const [x, n] of val) e += o.wValence * (n - (bv.has(x) ? 4 : 6)) ** 2;
  for (const [k, l] of adj) {
    if (l.length !== 2) continue;
    const [a, b] = keyEdge(k);
    e += o.wDihedral * dihedral(pos3, tris[l[0]], tris[l[1]]);
    e += o.wFlow * flowPenalty(pos2, o.centers, a, b);
  }
  return e;
}

/** Winding sign of the mesh (majority) and the indices of triangles that are degenerate or wound the other way. */
function windingInfo(tris, pos2) {
  const area = tris.map((t) => orient2(pos2[t[0]], pos2[t[1]], pos2[t[2]]));
  let pos = 0, neg = 0;
  for (const a of area) { if (a > EPS) pos++; else if (a < -EPS) neg++; }
  const sign0 = pos >= neg ? 1 : -1;
  const frozen = new Set();
  area.forEach((a, i) => { if (a * sign0 <= EPS) frozen.add(i); });
  return { sign0, frozen };
}

/** The geometric part of flipping edge `key`: returns the two replacement triangles, or null if the flip is invalid. */
function flipCandidate(tris, adj, key, pos2, sign0, frozen) {
  const l = adj.get(key);
  if (!l || l.length !== 2) return null;
  const [i1, i2] = l;
  if (frozen.has(i1) || frozen.has(i2)) return null;
  const T1 = tris[i1], T2 = tris[i2];
  let u = -1, v = -1, c = -1;
  for (let k = 0; k < 3; k++) {
    if (edgeKey(T1[k], T1[(k + 1) % 3]) === key) { u = T1[k]; v = T1[(k + 1) % 3]; c = T1[(k + 2) % 3]; }
  }
  let d = -1;
  for (let k = 0; k < 3; k++) if (T2[k] === v && T2[(k + 1) % 3] === u) d = T2[(k + 2) % 3];
  if (u < 0 || d < 0) return null; // inconsistent winding across the edge
  if (adj.has(edgeKey(c, d))) return null;
  const n1 = [u, d, c], n2 = [d, v, c];
  const s1 = orient2(pos2[n1[0]], pos2[n1[1]], pos2[n1[2]]) * sign0;
  const s2 = orient2(pos2[n2[0]], pos2[n2[1]], pos2[n2[2]]) * sign0;
  if (!(s1 > EPS && s2 > EPS)) return null; // not strictly convex
  return { i1, i2, u, v, c, d, n1, n2 };
}

/** Exact change of the global energy if the flip were applied (negative = better). */
function flipDelta(tris, adj, val, bv, f, o, pos2, pos3) {
  const { i1, i2, u, v, c, d, n1, n2 } = f;
  const T1 = tris[i1], T2 = tris[i2];
  const vp = (x, dv) => (val.get(x) + dv - (bv.has(x) ? 4 : 6)) ** 2;
  const outside = (a, b) => {
    const l = adj.get(edgeKey(a, b));
    const j = l ? l.find((x) => x !== i1 && x !== i2) : undefined;
    return j === undefined ? null : tris[j];
  };
  let before = o.wQuality * (2 - triQuality(pos3, T1) - triQuality(pos3, T2));
  let after = o.wQuality * (2 - triQuality(pos3, n1) - triQuality(pos3, n2));
  before += o.wValence * (vp(u, 0) + vp(v, 0) + vp(c, 0) + vp(d, 0));
  after += o.wValence * (vp(u, -1) + vp(v, -1) + vp(c, 1) + vp(d, 1));
  before += o.wDihedral * dihedral(pos3, T1, T2);
  after += o.wDihedral * dihedral(pos3, n1, n2);
  for (const [a, b, oldT, newT] of [[u, c, T1, n1], [c, v, T1, n2], [v, d, T2, n2], [d, u, T2, n1]]) {
    const N = outside(a, b);
    if (!N) continue;
    before += o.wDihedral * dihedral(pos3, oldT, N);
    after += o.wDihedral * dihedral(pos3, newT, N);
  }
  before += o.wFlow * flowPenalty(pos2, o.centers, u, v);
  after += o.wFlow * flowPenalty(pos2, o.centers, c, d);
  return after - before;
}

export function optimize(trisIn, { pos2, pos3, locked = new Set(), ...opts }) {
  const o = { ...DEFAULTS, ...opts };
  const tris = trisIn.map((t) => t.slice());
  const { sign0, frozen } = windingInfo(tris, pos2);
  const bnd = boundaryKeys(tris);
  const bv = boundaryVertices(bnd);
  let adj = buildAdjacency(tris);
  let val = valences(adj);
  let flips = 0, sweeps = 0;
  while (sweeps < o.maxSweeps) {
    sweeps++;
    let changed = 0;
    for (const key of [...adj.keys()].sort((x, y) => x - y)) {
      if (locked.has(key) || bnd.has(key)) continue;
      const f = flipCandidate(tris, adj, key, pos2, sign0, frozen);
      if (!f) continue;
      if (flipDelta(tris, adj, val, bv, f, o, pos2, pos3) < -EPS) {
        tris[f.i1] = f.n1;
        tris[f.i2] = f.n2;
        adj = buildAdjacency(tris);
        val = valences(adj);
        flips++;
        changed++;
      }
    }
    if (!changed) break;
  }
  return { tris, flips, sweeps, frozen: frozen.size };
}

/** Proper intersection (not at endpoints) of segments a-b and p-q in 2D. */
const crosses = (pos2, a, b, p, q) => {
  const A = pos2[a], B = pos2[b], P = pos2[p], Q = pos2[q];
  return orient2(A, B, P) * orient2(A, B, Q) < 0 && orient2(P, Q, A) * orient2(P, Q, B) < 0;
};

/**
 * Makes edge a-b present by flipping the edges that cross it (convex quads only). Throws if it crosses a locked edge,
 * if no crossing edge can be flipped (for example the segment passes through another vertex), or after `maxFlips`.
 */
export function enforceEdge(trisIn, pos2, a, b, locked = new Set(), maxFlips = 5000) {
  const tris = trisIn.map((t) => t.slice());
  const { sign0, frozen } = windingInfo(tris, pos2);
  const target = edgeKey(a, b);
  let flips = 0;
  for (;;) {
    const adj = buildAdjacency(tris);
    if (adj.has(target)) return { tris, flips };
    if (flips >= maxFlips) throw new Error(`edge ${a}-${b} cannot be enforced: flip cap reached`);
    const crossing = [...adj.keys()].sort((x, y) => x - y).filter((k) => {
      const [p, q] = keyEdge(k);
      return p !== a && p !== b && q !== a && q !== b && crosses(pos2, a, b, p, q);
    });
    if (!crossing.length) throw new Error(`edge ${a}-${b} cannot be enforced: no crossing edge to flip`);
    let done = false;
    for (const k of crossing) {
      if (locked.has(k)) {
        const [p, q] = keyEdge(k);
        throw new Error(`edge ${a}-${b} crosses locked edge ${p}-${q}`);
      }
      const f = flipCandidate(tris, adj, k, pos2, sign0, frozen);
      if (f) { tris[f.i1] = f.n1; tris[f.i2] = f.n2; flips++; done = true; break; }
    }
    if (!done) throw new Error(`edge ${a}-${b} cannot be enforced: no convex crossing edge`);
  }
}

/** Enforces each chain's consecutive edges in order and locks them. See the plan for the optional-chain rollback rule. */
export function enforceChains(trisIn, pos2, chains, { locked = new Set() } = {}) {
  let cur = trisIn;
  const lockedOut = new Set(locked);
  let flips = 0;
  const dropped = [];
  for (const ch of chains) {
    const added = [];
    try {
      let t = cur;
      for (let i = 0; i + 1 < ch.ids.length; i++) {
        const r = enforceEdge(t, pos2, ch.ids[i], ch.ids[i + 1], lockedOut);
        t = r.tris;
        flips += r.flips;
        const k = edgeKey(ch.ids[i], ch.ids[i + 1]);
        if (!lockedOut.has(k)) { lockedOut.add(k); added.push(k); }
      }
      cur = t;
    } catch (e) {
      for (const k of added) lockedOut.delete(k);
      if (!ch.optional) throw new Error(`chain "${ch.name}": ${e.message}`);
      dropped.push(ch.name);
    }
  }
  return { tris: cur, locked: lockedOut, flips, dropped };
}

const deg = (r) => (r * 180) / Math.PI;

export function qualityReport(tris, pos3) {
  const adj = buildAdjacency(tris);
  const val = valences(adj);
  const bv = boundaryVertices(boundaryKeys(tris));
  const minAngles = [];
  let aspectOver3 = 0;
  for (const t of tris) {
    const [a, b, c] = t.map((i) => pos3[i]);
    const la = len(sub(b, c)), lb = len(sub(a, c)), lc = len(sub(a, b));
    const ang = (opp, s1, s2) => deg(Math.acos(Math.max(-1, Math.min(1, (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2 || 1)))));
    minAngles.push(Math.min(ang(la, lb, lc), ang(lb, la, lc), ang(lc, la, lb)));
    const area = 0.5 * len(cross(sub(b, a), sub(c, a)));
    const longest = Math.max(la, lb, lc);
    if (!(area > 0) || (longest * longest) / (2 * area) > 3) aspectOver3++;
  }
  const hist = {};
  let interior = 0, ok = 0;
  for (const [x, n] of val) {
    if (bv.has(x)) continue;
    interior++;
    hist[n] = (hist[n] ?? 0) + 1;
    if (n >= 5 && n <= 7) ok++;
  }
  const dih = [];
  for (const l of adj.values()) if (l.length === 2) dih.push(deg(dihedral(pos3, tris[l[0]], tris[l[1]])));
  dih.sort((x, y) => x - y);
  return {
    tris: tris.length,
    minAngleMin: Math.min(...minAngles),
    minAngleMean: minAngles.reduce((s, x) => s + x, 0) / minAngles.length,
    slivers20: minAngles.filter((x) => x < 20).length,
    aspectOver3,
    interiorVertices: interior,
    valenceHistogram: hist,
    valenceShare5to7: interior ? ok / interior : 0,
    dihedralMean: dih.length ? dih.reduce((s, x) => s + x, 0) / dih.length : 0,
    dihedral90: dih.length ? dih[Math.floor(0.9 * (dih.length - 1))] : 0,
  };
}

export function formatReport(name, r) {
  const f = (x) => x.toFixed(2);
  return [
    `${name}: ${r.tris} triangles`,
    `  min angle: worst ${f(r.minAngleMin)} deg, mean ${f(r.minAngleMean)} deg; under 20 deg: ${r.slivers20}; aspect over 3: ${r.aspectOver3}`,
    `  interior valence: ${JSON.stringify(r.valenceHistogram)} (${(100 * r.valenceShare5to7).toFixed(1)}% at 5..7 of ${r.interiorVertices})`,
    `  dihedral across interior edges: mean ${f(r.dihedralMean)} deg, 90th percentile ${f(r.dihedral90)} deg`,
  ].join('\n');
}
