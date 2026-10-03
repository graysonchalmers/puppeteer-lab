/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { buildCreaseGroups } from './creaseGroups';
import { FACE_MESHES, createFaceBuffers, updateFaceBuffers, SKIN_GRAY, LIP_GRAY, DEFAULT_SHADE } from './faceGeometry';
import { CANONICAL_VERTS } from './faceTopology';
import { cornerCavity } from './cavity';

// Canonical face as landmarks (y flipped to image-down), 478 points.
const canonical = (): Landmark[] => {
  const lm: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    lm.push({ x: 0.5 + CANONICAL_VERTS[i * 3] * 0.02, y: 0.5 - CANONICAL_VERTS[i * 3 + 1] * 0.02, z: -CANONICAL_VERTS[i * 3 + 2] * 0.02 });
  }
  for (let i = 468; i < 478; i++) lm.push({ x: 0.5, y: 0.5, z: 0 });
  return lm;
};

describe('faceGeometry', () => {
  it('sizes buffers per mesh and colors lips darker', () => {
    const buf = createFaceBuffers('low');
    const n = FACE_MESHES.low.tris.length / 3;
    expect(buf.positions.length).toBe(n * 9);
    const lipTri = FACE_MESHES.low.isLip.indexOf(1);
    const skinTri = FACE_MESHES.low.isLip.indexOf(0);
    expect(buf.colors[lipTri * 9]).toBeCloseTo(LIP_GRAY);
    expect(buf.colors[skinTri * 9]).toBeCloseTo(SKIN_GRAY);
  });

  it('writes scene positions for every corner', () => {
    const lm = canonical();
    const p = fitProjection(640, 480, 4 / 3);
    const buf = createFaceBuffers('low');
    const g = buildCreaseGroups(FACE_MESHES.low.tris, CANONICAL_VERTS, 35);
    updateFaceBuffers(buf, 'low', lm, p, g);
    const v0 = FACE_MESHES.low.tris[0];
    expect(buf.positions[0]).toBeCloseTo(p.x(lm[v0]));
    expect(buf.positions[1]).toBeCloseTo(-p.y(lm[v0]));
    expect(buf.positions[2]).toBeCloseTo(-p.z(lm[v0]));
  });

  it('writes unit stored normals that mostly point away from the camera (-Z, inward) on a frontal face', () => {
    const lm = canonical();
    const p = fitProjection(640, 480, 4 / 3);
    for (const detail of ['low', 'full'] as const) {
      const buf = createFaceBuffers(detail);
      updateFaceBuffers(buf, detail, lm, p, buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, 35));
      let front = 0;
      const corners = buf.normals.length / 3;
      for (let c = 0; c < corners; c++) {
        const [x, y, z] = [buf.normals[c * 3], buf.normals[c * 3 + 1], buf.normals[c * 3 + 2]];
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
        if (z < 0) front++;
      }
      expect(front / corners).toBeGreaterThan(0.9);
    }
  });

  it('at 0 degrees gives all three corners of a triangle the same normal (flat)', () => {
    const lm = canonical();
    const p = fitProjection(640, 480, 4 / 3);
    const buf = createFaceBuffers('low');
    updateFaceBuffers(buf, 'low', lm, p, buildCreaseGroups(FACE_MESHES.low.tris, CANONICAL_VERTS, 0));
    for (let k = 0; k < 3; k++) expect(buf.normals[3 + k]).toBeCloseTo(buf.normals[k]);
  });
});

// The canonical face yawed in scene space (about the vertical axis), as landmarks.
const yawed = (yawDeg: number): Landmark[] => {
  const a = (yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const lm: Landmark[] = [];
  for (let i = 0; i < 468; i++) {
    const x = CANONICAL_VERTS[i * 3], y = CANONICAL_VERTS[i * 3 + 1], z = CANONICAL_VERTS[i * 3 + 2];
    lm.push({ x: 0.5 + (c * x + s * z) * 0.02, y: 0.5 - y * 0.02, z: -(-s * x + c * z) * 0.02 });
  }
  for (let i = 468; i < 478; i++) lm.push({ x: 0.5, y: 0.5, z: 0 });
  return lm;
};

describe('face normal orientation', () => {
  const p = fitProjection(640, 480, 4 / 3);

  for (const yaw of [0, 45, 60]) {
    for (const detail of ['low', 'full'] as const) {
      it(`faceNormals point outward from the head on at least 98% of triangles (${detail}, yaw ${yaw})`, () => {
        const lm = yawed(yaw);
        const buf = createFaceBuffers(detail);
        updateFaceBuffers(buf, detail, lm, p, buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, 35));
        const P = buf.positions;
        const nTris = FACE_MESHES[detail].tris.length / 3;
        const nCorners = nTris * 3;
        // Scene-space unit direction the face looks along: the canonical +z axis, pushed through the same projection.
        const o = [p.x(lm[1]), -p.y(lm[1]), -p.z(lm[1])];
        const a = (yaw * Math.PI) / 180;
        const k = { x: lm[1].x + Math.sin(a) * 0.02, y: lm[1].y, z: lm[1].z - Math.cos(a) * 0.02 };
        const f = [p.x(k) - o[0], -p.y(k) - o[1], -p.z(k) - o[2]];
        const fm = Math.hypot(f[0], f[1], f[2]);
        const fwd = f.map((v) => v / fm);
        const mean = [0, 0, 0];
        for (let c = 0; c < nCorners; c++) for (let d = 0; d < 3; d++) mean[d] += P[c * 3 + d] / nCorners;
        let lo = Infinity, hi = -Infinity;
        for (let c = 0; c < nCorners; c++) {
          const dd = (P[c * 3] - mean[0]) * fwd[0] + (P[c * 3 + 1] - mean[1]) * fwd[1] + (P[c * 3 + 2] - mean[2]) * fwd[2];
          lo = Math.min(lo, dd); hi = Math.max(hi, dd);
        }
        // Head center: the face's mean pushed back along the head's local -z by half the face depth.
        const center = mean.map((v, d) => v - fwd[d] * (hi - lo) / 2);
        let outward = 0;
        for (let t = 0; t < nTris; t++) {
          let dot = 0;
          for (let d = 0; d < 3; d++) {
            const cen = (P[t * 9 + d] + P[t * 9 + 3 + d] + P[t * 9 + 6 + d]) / 3;
            dot += buf.faceNormals[t * 3 + d] * (cen - center[d]);
          }
          if (dot > 0) outward++;
        }
        expect(outward / nTris).toBeGreaterThanOrEqual(0.98);
      });
    }
  }

  it('stores the negated, normalized smoothed face normal per corner (the inward normal the shader expects)', () => {
    const p2 = fitProjection(640, 480, 4 / 3);
    for (const yaw of [0, 45]) {
      for (const detail of ['low', 'full'] as const) {
        for (const angle of [0, 35]) {
          const groups = buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, angle);
          const buf = createFaceBuffers(detail);
          updateFaceBuffers(buf, detail, yawed(yaw), p2, groups);
          const nCorners = FACE_MESHES[detail].tris.length;
          let single = 0;
          for (let c = 0; c < nCorners; c++) {
            let x = 0, y = 0, z = 0;
            for (let k = groups.offsets[c]; k < groups.offsets[c + 1]; k++) {
              const u = groups.tris[k];
              x += buf.faceNormals[u * 3]; y += buf.faceNormals[u * 3 + 1]; z += buf.faceNormals[u * 3 + 2];
            }
            const m = Math.hypot(x, y, z) || 1;
            expect(buf.normals[c * 3]).toBeCloseTo(-x / m, 5);
            expect(buf.normals[c * 3 + 1]).toBeCloseTo(-y / m, 5);
            expect(buf.normals[c * 3 + 2]).toBeCloseTo(-z / m, 5);
            if (groups.offsets[c + 1] - groups.offsets[c] === 1) single++;
          }
          if (angle === 0) expect(single).toBeGreaterThan(0);
        }
      }
    }
  });

  it('a single-triangle group stores exactly -faceNormal / |faceNormal|', () => {
    const lm = yawed(45);
    const groups = buildCreaseGroups(FACE_MESHES.low.tris, CANONICAL_VERTS, 0);
    const buf = createFaceBuffers('low');
    updateFaceBuffers(buf, 'low', lm, p, groups);
    let checked = 0;
    for (let c = 0; c < FACE_MESHES.low.tris.length; c++) {
      if (groups.offsets[c + 1] - groups.offsets[c] !== 1) continue;
      const u = groups.tris[groups.offsets[c]];
      const m = Math.hypot(buf.faceNormals[u * 3], buf.faceNormals[u * 3 + 1], buf.faceNormals[u * 3 + 2]);
      for (let d = 0; d < 3; d++) expect(buf.normals[c * 3 + d]).toBeCloseTo(-buf.faceNormals[u * 3 + d] / m, 5);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('on a frontal face the outward faceNormals are mostly +z', () => {
    const lm = canonical();
    for (const detail of ['low', 'full'] as const) {
      const buf = createFaceBuffers(detail);
      updateFaceBuffers(buf, detail, lm, p, buildCreaseGroups(FACE_MESHES[detail].tris, CANONICAL_VERTS, 35));
      const nTris = FACE_MESHES[detail].tris.length / 3;
      let front = 0;
      for (let t = 0; t < nTris; t++) if (buf.faceNormals[t * 3 + 2] > 0) front++;
      expect(front / nTris).toBeGreaterThan(0.9);
    }
  });
});

describe('createFaceBuffers shade', () => {
  it('the default shade reproduces the pre-looks gray and lip gray exactly', () => {
    for (const d of ['low', 'full'] as const) {
      const { isLip } = FACE_MESHES[d];
      const buf = createFaceBuffers(d);
      for (let t = 0; t < isLip.length; t++) {
        const g = isLip[t] ? LIP_GRAY : SKIN_GRAY;
        for (let k = 0; k < 9; k++) expect(buf.colors[t * 9 + k]).toBeCloseTo(g, 6);
      }
    }
  });
  it('tint multiplies per channel and lips use the lip tint', () => {
    const shade = { ...DEFAULT_SHADE, skinGray: 1, lipGray: 1, skinTint: 0xff8000, lipTint: 0x0000ff };
    const { isLip } = FACE_MESHES.low;
    const buf = createFaceBuffers('low', shade);
    const t = isLip.indexOf(0), l = isLip.indexOf(1);
    expect([buf.colors[t * 9], buf.colors[t * 9 + 1], buf.colors[t * 9 + 2]].map((x) => +x.toFixed(3))).toEqual([1, 0.502, 0]);
    expect([buf.colors[l * 9], buf.colors[l * 9 + 1], buf.colors[l * 9 + 2]].map((x) => +x.toFixed(3))).toEqual([0, 0, 1]);
  });
  it('cavity darkens only cavity corners, in both meshes (look survives a detail switch)', () => {
    const shade = { ...DEFAULT_SHADE, cavity: 0.5 };
    for (const d of ['low', 'full'] as const) {
      const w = cornerCavity(d);
      const plain = createFaceBuffers(d);
      const dark = createFaceBuffers(d, shade);
      let hit = 0;
      for (let c = 0; c < w.length; c++) {
        for (let k = 0; k < 3; k++) {
          const a = plain.colors[c * 3 + k], b = dark.colors[c * 3 + k];
          if (w[c]) { expect(b).toBeCloseTo(a * 0.5, 6); hit++; } else expect(b).toBeCloseTo(a, 6);
        }
      }
      expect(hit).toBeGreaterThan(0);
    }
  });
});
