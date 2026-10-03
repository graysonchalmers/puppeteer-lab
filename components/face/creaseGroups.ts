/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smoothing groups for the Face Puppet's crease-angle shading. Built ONCE per
 * (mesh, angle) on the neutral canonical face, so an edge never pops between
 * smooth and hard while the live face moves: per frame, each triangle corner's
 * normal is the sum of its group's LIVE face normals (faceGeometry.ts).
 */

export interface CreaseGroups {
  /** CSR: the group of corner c is tris[offsets[c] .. offsets[c + 1]). */
  offsets: Int32Array;
  tris: Int32Array;
}

/** Undirected edge key for the hard-edge set (landmark ids are below 512). */
export const hardEdgeKey = (a: number, b: number): number => (a < b ? a * 512 + b : b * 512 + a);

/**
 * `hardEdges` (hardEdgeKey values) are never smoothed across, at any angle: at each vertex the surrounding triangles
 * are split into fans wherever two neighbours share a hard edge, and a corner only smooths within its own fan.
 */
export function buildCreaseGroups(
  triIdx: readonly number[], verts: readonly number[], angleDeg: number, hardEdges?: ReadonlySet<number>,
): CreaseGroups {
  const nTris = triIdx.length / 3;
  const normals = new Float64Array(nTris * 3);
  for (let t = 0; t < nTris; t++) {
    const [a, b, c] = [triIdx[t * 3], triIdx[t * 3 + 1], triIdx[t * 3 + 2]];
    const ux = verts[b * 3] - verts[a * 3], uy = verts[b * 3 + 1] - verts[a * 3 + 1], uz = verts[b * 3 + 2] - verts[a * 3 + 2];
    const vx = verts[c * 3] - verts[a * 3], vy = verts[c * 3 + 1] - verts[a * 3 + 1], vz = verts[c * 3 + 2] - verts[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / m;
    normals[t * 3 + 1] = ny / m;
    normals[t * 3 + 2] = nz / m;
  }

  const byVertex = new Map<number, number[]>();
  for (let t = 0; t < nTris; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triIdx[t * 3 + k];
      const list = byVertex.get(v);
      if (list) list.push(t); else byVertex.set(v, [t]);
    }
  }

  // fanOf(v)[t] = fan id of triangle t around vertex v (triangles joined by a non-hard shared edge through v).
  const fans = new Map<number, Map<number, number>>();
  const fanOf = (v: number): Map<number, number> => {
    let f = fans.get(v);
    if (f) return f;
    const list = byVertex.get(v)!;
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const other = (t: number, w: number) => [0, 1, 2].map((k) => triIdx[t * 3 + k]).filter((x) => x !== v && x !== w);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const shared = other(list[i], -1).filter((w) => other(list[j], -1).includes(w));
        if (shared.some((w) => !hardEdges!.has(hardEdgeKey(v, w)))) parent[find(i)] = find(j);
      }
    }
    f = new Map(list.map((t, i) => [t, find(i)]));
    fans.set(v, f);
    return f;
  };

  // Winding is consistent across the canonical mesh, so the dot is a true
  // fold angle; -1e-9 keeps exactly-coplanar neighbors in at 0 degrees out.
  const cosLimit = angleDeg <= 0 ? 2 : Math.cos((angleDeg * Math.PI) / 180) - 1e-9;
  const offsets = new Int32Array(nTris * 3 + 1);
  const out: number[] = [];
  for (let c = 0; c < nTris * 3; c++) {
    const t = Math.floor(c / 3);
    out.push(t);
    const fan = hardEdges && hardEdges.size ? fanOf(triIdx[c]) : null;
    for (const u of byVertex.get(triIdx[c])!) {
      if (u === t) continue;
      if (fan && fan.get(u) !== fan.get(t)) continue;
      const dot = normals[t * 3] * normals[u * 3] + normals[t * 3 + 1] * normals[u * 3 + 1] + normals[t * 3 + 2] * normals[u * 3 + 2];
      if (dot >= cosLimit) out.push(u);
    }
    offsets[c + 1] = out.length;
  }
  return { offsets, tris: Int32Array.from(out) };
}
