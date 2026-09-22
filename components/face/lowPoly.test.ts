/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitProjection, lambert, shadeColor, buildFaceTriangles, triIntensity } from './lowPoly';
import { FACE_TRIS } from './faceTopology';

// Load canonical face vertices from .obj file
const objPath = resolve(fileURLToPath(import.meta.url), '../../../tools/data/canonical_face_model.obj');
const objLines = readFileSync(objPath, 'utf-8').split('\n');
const vertices: [number, number, number][] = [];
for (const line of objLines) {
  if (line.startsWith('v ')) {
    const parts = line.split(/\s+/).slice(1, 4);
    const [x, y, z] = parts.map(Number);
    vertices.push([x, y, z]);
  }
}

describe('fitProjection', () => {
  it('contain-fits a 4:3 camera into a wide stage, centered and mirrored', () => {
    const p = fitProjection(800, 400, 4 / 3);
    expect(p.drawH).toBe(400);
    expect(p.drawW).toBeCloseTo(533.333, 2);
    expect(p.offsetX).toBeCloseTo(133.333, 2);
    expect(p.x({ x: 0, y: 0, z: 0 })).toBeCloseTo(133.333 + 533.333, 2); // x=0 lands on the right (mirror)
    expect(p.x({ x: 1, y: 1, z: 0 })).toBeCloseTo(133.333, 2);
    expect(p.y({ x: 1, y: 1, z: 0 })).toBe(400);
  });

  it('letterboxes vertically on a tall stage', () => {
    const p = fitProjection(400, 800, 4 / 3);
    expect(p.drawW).toBe(400);
    expect(p.drawH).toBe(300);
    expect(p.offsetY).toBe(250);
  });

  it('scales z by drawn width', () => {
    expect(fitProjection(800, 600, 4 / 3).z({ x: 0, y: 0, z: 0.1 })).toBeCloseTo(80);
  });
});

describe('lambert', () => {
  it('is two-sided and stays in 0.2..1', () => {
    expect(lambert(0, 0, -1)).toBeCloseTo(lambert(0, 0, 1));
    for (const n of [[0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0]]) {
      const v = lambert(n[0], n[1], n[2]);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is brighter facing the (upper-left) light than facing away from it', () => {
    const towardLight = lambert(-0.5, -0.5, -0.7);
    const facingCamera = lambert(0, 0, -1);
    const awayFromLight = lambert(0.7, 0.3, -0.6);
    expect(towardLight).toBeGreaterThan(facingCamera);
    expect(facingCamera).toBeGreaterThan(awayFromLight);
  });

  it('returns the ambient floor for a zero normal', () => {
    expect(triIntensity([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBe(0.2);
  });
});

describe('shadeColor', () => {
  it('maps the ramp ends and clamps', () => {
    expect(shadeColor(0)).toBe('rgb(42, 45, 51)');
    expect(shadeColor(1)).toBe('rgb(217, 220, 225)');
    expect(shadeColor(-5)).toBe(shadeColor(0));
    expect(shadeColor(5)).toBe(shadeColor(1));
  });
});

describe('buildFaceTriangles', () => {
  // Canonical face flattened: map 3D vertices to 2D plane at z=0, normalized to 0..1 range
  const flat = [
    ...vertices.map((v) => ({
      x: 0.5 + v[0] * 0.02,
      y: 0.5 - v[1] * 0.02,
      z: 0,
    })),
    // Pad to 478 entries only so the array matches MediaPipe's 478-landmark
    // shape (the 468 canonical vertices + 10 iris points); not required by
    // buildFaceTriangles itself, since FACE_TRIS's max index is 466.
    ...Array.from({ length: 10 }, () => ({
      x: 0.5 + vertices[0][0] * 0.02,
      y: 0.5 - vertices[0][1] * 0.02,
      z: 0,
    })),
  ];

  it('emits one triangle per topology triangle', () => {
    expect(buildFaceTriangles(flat, fitProjection(640, 480, 4 / 3)).length).toBe(FACE_TRIS.length / 3);
  });

  it('on a flat face, shades skin one tone and lips one darker tone', () => {
    const colors = new Set(buildFaceTriangles(flat, fitProjection(640, 480, 4 / 3)).map((t) => t.color));
    expect(colors.size).toBe(2);
  });

  it('sorts back to front (depth non-increasing)', () => {
    const tilted = flat.map((p) => ({ ...p, z: p.x - 0.5 }));
    const tris = buildFaceTriangles(tilted, fitProjection(640, 480, 4 / 3));
    for (let i = 1; i < tris.length; i++) expect(tris[i].depth).toBeLessThanOrEqual(tris[i - 1].depth);
  });
});
