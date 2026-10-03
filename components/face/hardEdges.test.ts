/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { hardEdgesFor } from './hardEdges';
import { hardEdgeKey } from './creaseGroups';
import { FACE_MESHES } from './faceGeometry';
import { LIPS_OUTER } from './faceTopology';

const edgesOf = (tris: readonly number[]) => {
  const s = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) s.add(hardEdgeKey(tris[t + k], tris[t + (k + 1) % 3]));
  return s;
};

describe('hardEdgesFor', () => {
  for (const detail of ['low', 'full'] as const) {
    const tris = FACE_MESHES[detail].tris;
    const hard = hardEdgesFor(tris);
    it(`${detail}: every hard edge is a real edge of the mesh`, () => {
      const all = edgesOf(tris);
      expect(hard.size).toBeGreaterThan(30);
      for (const k of hard) expect(all.has(k)).toBe(true);
    });
    it(`${detail}: the whole outer lip ring is hard`, () => {
      for (let i = 0; i + 1 < LIPS_OUTER.length; i++) expect(hard.has(hardEdgeKey(LIPS_OUTER[i], LIPS_OUTER[i + 1]))).toBe(true);
    });
  }
  it('is cached per triangle list', () => {
    expect(hardEdgesFor(FACE_MESHES.low.tris)).toBe(hardEdgesFor(FACE_MESHES.low.tris));
  });
});
