import { describe, expect, it } from 'vitest';
import { CAVITY_VERTS, cornerCavity } from './cavity';
import { FACE_MESHES } from './faceGeometry';
import { LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from './faceTopology';

describe('cavity', () => {
  it('includes both eye-socket contours', () => {
    for (const i of [...LEFT_EYE_CONTOUR, ...RIGHT_EYE_CONTOUR]) expect(CAVITY_VERTS.has(i)).toBe(true);
  });
  it('marks exactly the corners whose landmark is in the set, for both meshes', () => {
    for (const d of ['low', 'full'] as const) {
      const { tris } = FACE_MESHES[d];
      const w = cornerCavity(tris);
      expect(w.length).toBe(tris.length);
      let marked = 0;
      for (let c = 0; c < tris.length; c++) {
        expect(w[c]).toBe(CAVITY_VERTS.has(tris[c]) ? 1 : 0);
        marked += w[c];
      }
      expect(marked).toBeGreaterThan(0);
      expect(marked).toBeLessThan(tris.length);
    }
  });
  it('returns the same cached array on repeat calls for the same table, and distinct arrays for distinct tables', () => {
    const low = FACE_MESHES.low.tris, full = FACE_MESHES.full.tris;
    expect(cornerCavity(low)).toBe(cornerCavity(low));
    expect(cornerCavity(full)).toBe(cornerCavity(full));
    expect(cornerCavity(low)).not.toBe(cornerCavity(full));
    const copy = [...low];
    expect(cornerCavity(copy)).not.toBe(cornerCavity(low));
    expect(Array.from(cornerCavity(copy))).toEqual(Array.from(cornerCavity(low)));
  });
});
