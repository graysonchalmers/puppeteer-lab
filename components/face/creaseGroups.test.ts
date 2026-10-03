/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildCreaseGroups, hardEdgeKey } from './creaseGroups';
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
  it('crease angle 0 builds groups where every corner only sees its own triangle', () => {
    const g = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 0);
    const corners = FACE_TRIS.length;
    expect(g.offsets.length).toBe(corners + 1);
    for (let c = 0; c < corners; c++) expect(g.offsets[c + 1] - g.offsets[c]).toBe(1);
  });

  it('never smooths across a hard edge, at any angle, and keeps the other fans smooth', () => {
    const hard = new Set([hardEdgeKey(0, 1)]);
    for (const angle of [60, 91, 180]) {
      const g = buildCreaseGroups(FOLD_TRIS, FOLD_VERTS, angle, hard);
      for (let c = 0; c < 6; c++) expect(group(g, c)).toEqual([Math.floor(c / 3)]);
    }
  });

  it('a hard edge only splits the vertices it touches: a flat three-triangle fan stays smooth around the far vertex', () => {
    // Fan around vertex 0: triangles (0,1,2) (0,2,3) (0,3,4), coplanar. Hard edge 0-2 splits fans at vertex 0 and 2 only.
    const tris = [0, 1, 2, 0, 2, 3, 0, 3, 4];
    const verts = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, -1, 1, 0];
    const g = buildCreaseGroups(tris, verts, 90, new Set([hardEdgeKey(0, 2)]));
    expect(group(g, 0)).toEqual([0]);           // corner of vertex 0 in tri 0: cut from tris 1 and 2
    expect(group(g, 3).sort()).toEqual([1, 2]); // vertex 0 in tri 1 still smooths with tri 2 (edge 0-3 is soft)
    expect(group(g, 4)).toEqual([1]);           // vertex 2 in tri 1: cut from tri 0
    expect(group(g, 5).sort()).toEqual([1, 2]); // vertex 3 sits on soft edges only
  });

  it('with no hard edges the result equals the plain build', () => {
    const a = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 35);
    const b = buildCreaseGroups(FACE_TRIS, CANONICAL_VERTS, 35, new Set());
    expect(Array.from(b.offsets)).toEqual(Array.from(a.offsets));
    expect(Array.from(b.tris)).toEqual(Array.from(a.tris));
  });
});
