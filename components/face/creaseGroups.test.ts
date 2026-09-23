/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildCreaseGroups } from './creaseGroups';
import { FACE_TRIS, CANONICAL_VERTS } from './faceTopology';

const group = (g: ReturnType<typeof buildCreaseGroups>, c: number) =>
  Array.from(g.tris.subarray(g.offsets[c], g.offsets[c + 1]));

// Two triangles sharing edge 0-1, folded 90 degrees along it.
const FOLD_TRIS = [0, 1, 2, 1, 0, 3];
const FOLD_VERTS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('buildCreaseGroups', () => {
  it('at 0 degrees every corner smooths only with its own triangle (flat shading)', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 0);
    const n = FACE_TRIS.length;
    for (let c = 0; c < n; c++) expect(group(g, c)).toEqual([Math.floor(c / 3)]);
  });

  it('keeps a 90-degree fold hard below 90 and smooth at 90+', () => {
    expect(group(buildCreaseGroups(FOLD_TRIS, FOLD_VERTS, 60), 0)).toEqual([0]);
    expect(group(buildCreaseGroups(FOLD_TRIS, FOLD_VERTS, 91), 0).sort()).toEqual([0, 1]);
  });

  it('is symmetric: if A smooths with B at a shared vertex, B smooths with A', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 35);
    for (let c = 0; c < FACE_TRIS.length; c++) {
      const a = Math.floor(c / 3);
      const v = FACE_TRIS[c];
      for (const b of group(g, c)) {
        const cb = [0, 1, 2].map((k) => b * 3 + k).find((x) => FACE_TRIS[x] === v)!;
        expect(group(g, cb)).toContain(a);
      }
    }
  });

  it('smooths most of the face at 90 degrees', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 90);
    let shared = 0;
    for (let c = 0; c < FACE_TRIS.length; c++) if (g.offsets[c + 1] - g.offsets[c] > 1) shared++;
    expect(shared / FACE_TRIS.length).toBeGreaterThan(0.9);
  });
});
