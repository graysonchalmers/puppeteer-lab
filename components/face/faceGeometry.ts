/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet geometry in scene units (see projection.ts): non-indexed
 * positions, per-corner color (gray x tint x cavity), OUTWARD live face normals
 * (faceNormals, never flipped toward the camera) and crease-angle smoothed
 * normals stored INWARD (normals: the negated, normalized sum of faceNormals over
 * the neutral smoothing groups, which is what the shader needs because the
 * mirrored mesh is drawn back-facing). Writes into preallocated arrays; no
 * per-frame allocation. PuppetScene uploads these to a BufferGeometry as-is.
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection } from './projection';
import { CreaseGroups } from './creaseGroups';
import { FACE_TRIS, FACE_TRI_IS_LIP, FACE_TRIS_FULL, FACE_TRI_IS_LIP_FULL } from './faceTopology';
import { cornerCavity } from './cavity';

export type MeshDetail = 'low' | 'full';

export const FACE_MESHES: Record<MeshDetail, { tris: readonly number[]; isLip: readonly (0 | 1)[] }> = {
  low: { tris: FACE_TRIS, isLip: FACE_TRI_IS_LIP },
  full: { tris: FACE_TRIS_FULL, isLip: FACE_TRI_IS_LIP_FULL },
};

export const SKIN_GRAY = 0.62;
export const LIP_GRAY = 0.45;

export interface FaceBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Live OUTWARD face normal per triangle (unnormalized, area-weighted), at every pose. */
  faceNormals: Float32Array;
}

export interface FaceShade { skinGray: number; lipGray: number; skinTint: number; lipTint: number; cavity: number }
export const DEFAULT_SHADE: FaceShade = { skinGray: SKIN_GRAY, lipGray: LIP_GRAY, skinTint: 0xffffff, lipTint: 0xffffff, cavity: 0 };

export function createFaceBuffers(detail: MeshDetail, shade: FaceShade = DEFAULT_SHADE): FaceBuffers {
  const { tris, isLip } = FACE_MESHES[detail];
  const nTris = tris.length / 3;
  const colors = new Float32Array(nTris * 9);
  const cav = shade.cavity > 0 ? cornerCavity(tris) : null;
  const rgb = (tint: number): [number, number, number] => [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255].map((v) => v / 255) as [number, number, number];
  const skin = rgb(shade.skinTint), lip = rgb(shade.lipTint);
  for (let t = 0; t < nTris; t++) {
    const gray = isLip[t] ? shade.lipGray : shade.skinGray;
    const tint = isLip[t] ? lip : skin;
    for (let k = 0; k < 3; k++) {
      const dim = cav ? 1 - shade.cavity * cav[t * 3 + k] : 1;
      for (let ch = 0; ch < 3; ch++) colors[t * 9 + k * 3 + ch] = gray * tint[ch] * dim;
    }
  }
  return {
    positions: new Float32Array(nTris * 9),
    normals: new Float32Array(nTris * 9),
    colors,
    faceNormals: new Float32Array(nTris * 3),
  };
}

export function updateFaceBuffers(buf: FaceBuffers, detail: MeshDetail, lm: Landmark[], p: Projection, groups: CreaseGroups): void {
  const { tris } = FACE_MESHES[detail];
  const nTris = tris.length / 3;
  const P = buf.positions;
  for (let c = 0; c < nTris * 3; c++) {
    const l = lm[tris[c]];
    P[c * 3] = p.x(l);
    P[c * 3 + 1] = -p.y(l);
    P[c * 3 + 2] = -p.z(l);
  }
  const FN = buf.faceNormals;
  for (let t = 0; t < nTris; t++) {
    const a = t * 9;
    const ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2];
    const vx = P[a + 6] - P[a], vy = P[a + 7] - P[a + 1], vz = P[a + 8] - P[a + 2];
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    // The X mirror reverses every triangle's winding and the tables are consistently wound, so -w is the outward
    // normal of every triangle at every pose. Do not flip it toward the camera: triangles that fold when the head
    // turns must keep facing away from the head, or they are lit inside-out.
    FN[t * 3] = -wx; FN[t * 3 + 1] = -wy; FN[t * 3 + 2] = -wz;
  }
  const N = buf.normals;
  for (let c = 0; c < nTris * 3; c++) {
    let x = 0, y = 0, z = 0;
    for (let k = groups.offsets[c]; k < groups.offsets[c + 1]; k++) {
      const u = groups.tris[k];
      x += FN[u * 3]; y += FN[u * 3 + 1]; z += FN[u * 3 + 2];
    }
    const m = Math.hypot(x, y, z) || 1;
    // Stored NEGATED (inward): three flips the stored normal of a back-facing triangle and the mirrored mesh is drawn
    // back-facing, so the shader turns this inward normal back into the outward one.
    N[c * 3] = -x / m; N[c * 3 + 1] = -y / m; N[c * 3 + 2] = -z / m;
  }
}
