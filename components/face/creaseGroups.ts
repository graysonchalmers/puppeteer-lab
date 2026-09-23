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

export function buildCreaseGroups(triIdx: readonly number[], verts: readonly number[], angleDeg: number): CreaseGroups {
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

  // Winding is consistent across the canonical mesh, so the dot is a true
  // fold angle; -1e-9 keeps exactly-coplanar neighbors in at 0 degrees out.
  const cosLimit = angleDeg <= 0 ? 2 : Math.cos((angleDeg * Math.PI) / 180) - 1e-9;
  const offsets = new Int32Array(nTris * 3 + 1);
  const out: number[] = [];
  for (let c = 0; c < nTris * 3; c++) {
    const t = Math.floor(c / 3);
    out.push(t);
    for (const u of byVertex.get(triIdx[c])!) {
      if (u === t) continue;
      const dot = normals[t * 3] * normals[u * 3] + normals[t * 3 + 1] * normals[u * 3 + 1] + normals[t * 3 + 2] * normals[u * 3 + 2];
      if (dot >= cosLimit) out.push(u);
    }
    offsets[c + 1] = out.length;
  }
  return { offsets, tris: Int32Array.from(out) };
}
