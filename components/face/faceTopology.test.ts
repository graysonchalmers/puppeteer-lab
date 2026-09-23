/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  FACE_TRIS, FACE_TRI_IS_LIP, LIPS_INNER_UPPER, LIPS_INNER_LOWER,
  LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LIPS_INNER,
  FACE_TRIS_FULL, FACE_TRI_IS_LIP_FULL, CANONICAL_VERTS,
  LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS,
} from './faceTopology';

const tris: number[][] = [];
for (let i = 0; i < FACE_TRIS.length; i += 3) tris.push([FACE_TRIS[i], FACE_TRIS[i + 1], FACE_TRIS[i + 2]]);
const spans = (t: number[], a: readonly number[], b: readonly number[]) =>
  t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));

describe('faceTopology', () => {
  it('is a whole number of triangles with one lip flag each', () => {
    expect(FACE_TRIS.length % 3).toBe(0);
    expect(FACE_TRI_IS_LIP.length).toBe(tris.length);
  });

  it('is low-poly: between 250 and 450 triangles', () => {
    expect(tris.length).toBeGreaterThan(250);
    expect(tris.length).toBeLessThan(450);
  });

  it('only uses face-mesh landmark indices (0..467)', () => {
    expect(FACE_TRIS.every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
  });

  it('never bridges the mouth hole', () => {
    expect(tris.some((t) => spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER))).toBe(false);
  });

  it('never bridges an eye hole', () => {
    const lidsL = [LEFT_EYE_CONTOUR.slice(1, 8), LEFT_EYE_CONTOUR.slice(9, 16)];
    const lidsR = [RIGHT_EYE_CONTOUR.slice(1, 8), RIGHT_EYE_CONTOUR.slice(9, 16)];
    expect(tris.some((t) => spans(t, lidsL[0], lidsL[1]) || spans(t, lidsR[0], lidsR[1]))).toBe(false);
  });

  it('has lip triangles, and the inner-lip ring is closed', () => {
    expect(FACE_TRI_IS_LIP.filter((f) => f === 1).length).toBeGreaterThan(10);
    expect(LIPS_INNER[0]).toBe(LIPS_INNER[LIPS_INNER.length - 1]);
    expect(LIPS_INNER_UPPER.length).toBe(LIPS_INNER_LOWER.length);
  });
});

const trisOf = (flat: readonly number[]) => {
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
};

describe('faceTopology FULL mesh', () => {
  const full = trisOf(FACE_TRIS_FULL);

  it('is the dense mesh: between 800 and 900 triangles, one lip flag each', () => {
    expect(full.length).toBeGreaterThan(800);
    expect(full.length).toBeLessThanOrEqual(898);
    expect(FACE_TRI_IS_LIP_FULL.length).toBe(full.length);
    expect(FACE_TRI_IS_LIP_FULL.filter((f) => f === 1).length).toBeGreaterThan(10);
  });

  it('only uses face-mesh landmark indices (0..467)', () => {
    expect(FACE_TRIS_FULL.every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
  });

  it('never bridges the mouth or an eye hole', () => {
    const lidsL = [LEFT_EYE_CONTOUR.slice(1, 8), LEFT_EYE_CONTOUR.slice(9, 16)];
    const lidsR = [RIGHT_EYE_CONTOUR.slice(1, 8), RIGHT_EYE_CONTOUR.slice(9, 16)];
    expect(full.some((t) => spans(t, LIPS_INNER_UPPER, LIPS_INNER_LOWER))).toBe(false);
    expect(full.some((t) => spans(t, lidsL[0], lidsL[1]) || spans(t, lidsR[0], lidsR[1]))).toBe(false);
  });
});

describe('faceTopology neutral vertices and lid pairs', () => {
  it('has 468 xyz vertices', () => {
    expect(CANONICAL_VERTS.length).toBe(468 * 3);
    expect(CANONICAL_VERTS.every(Number.isFinite)).toBe(true);
  });

  it('pairs 7 upper-lid points with 7 lower-lid points per eye, outer corner first', () => {
    expect(LEFT_EYE_LID_PAIRS).toEqual([[246, 7], [161, 163], [160, 144], [159, 145], [158, 153], [157, 154], [173, 155]]);
    expect(RIGHT_EYE_LID_PAIRS).toEqual([[466, 249], [388, 390], [387, 373], [386, 374], [385, 380], [384, 381], [398, 382]]);
  });
});
