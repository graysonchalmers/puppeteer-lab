/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { buildCreaseGroups } from './creaseGroups';
import { FACE_MESHES, createFaceBuffers, updateFaceBuffers, SKIN_GRAY, LIP_GRAY } from './faceGeometry';
import { CANONICAL_VERTS } from './faceTopology';

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

  it('writes unit normals that mostly face the camera (+Z) on a frontal face', () => {
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
        if (z > 0) front++;
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
