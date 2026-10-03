/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FrameData } from '../../types';
import { DEFAULT_R, R_MAX, R_MIN, SIZE_RATIO, computeHandDepth, focalPx, placeHandPoints } from './handDepth';
import { V3 } from './projection';

const face = (width: number) => {
  const a = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  a[234] = { x: 0.5 - width / 2, y: 0.5, z: 0 };
  a[454] = { x: 0.5 + width / 2, y: 0.5, z: 0 };
  a[1] = { x: 0.5, y: 0.45, z: -0.02 };
  return a;
};
const hand = (size: number) => {
  const a = Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.7, z: 0 }));
  a[9] = { x: 0.8, y: 0.7 - size, z: 0 };
  return a;
};
const fr = (t: number, faceW: number | null, ...handSizes: number[]): FrameData => ({
  timestamp: t,
  ...(faceW === null ? {} : { faceLandmarks: face(faceW) }),
  landmarks: handSizes.map(hand),
});
const run = (n: number, make: (i: number) => FrameData) => Array.from({ length: n }, (_, i) => make(i));

describe('constants', () => {
  it('derives the focal length from a 63 degree horizontal FOV', () => expect(focalPx(1000)).toBeCloseTo(815.9, 0));
  it('uses the 9.5 cm / 14.5 cm size ratio', () => expect(SIZE_RATIO).toBeCloseTo(0.6552, 4));
});

describe('placeHandPoints', () => {
  const pts: V3[] = [[100, -50, 12], [300, -200, -30], [640, -480, 0]];
  const cx = 320;
  const cy = -240;
  const f = 800;

  it('r = 1 is the identity', () => {
    placeHandPoints(pts, 1, cx, cy, f).forEach((q, i) => q.forEach((v, d) => expect(v).toBeCloseTo(pts[i][d], 9)));
  });

  it('reprojects through the capture-pose camera to the original image position, for any r and z', () => {
    const project = (q: V3) => [cx + ((q[0] - cx) * f) / (f - q[2]), cy + ((q[1] - cy) * f) / (f - q[2])];
    for (const r of [0.3, 0.7, 1, 1.3]) {
      const placed = placeHandPoints(pts, r, cx, cy, f);
      placed.forEach((q, i) => {
        const [px, py] = project(q);
        const [ox, oy] = project(pts[i]);
        expect(px).toBeCloseTo(ox, 6);
        expect(py).toBeCloseTo(oy, 6);
      });
    }
  });

  it('a closer hand (r < 1) moves toward the camera', () => {
    expect(placeHandPoints([[cx, cy, 0]], 0.5, cx, cy, f)[0][2]).toBeCloseTo(400, 6);
  });
});

describe('computeHandDepth', () => {
  it('follows r = 0.655 * faceSize / handSize', () => {
    const d = computeHandDepth(run(20, (i) => fr(i * 20, 0.15, 0.15)), 1);
    expect(d.handR[10][0]).toBeCloseTo(9.5 / 14.5, 4);
  });

  it('applies the aspect to horizontal lengths', () => {
    const d = computeHandDepth(run(20, (i) => fr(i * 20, 0.15, 0.2)), 4 / 3); // face 0.2, hand 0.2
    expect(d.handR[10][0]).toBeCloseTo(9.5 / 14.5, 4);
  });

  it('clamps to [0.25, 1.3]', () => {
    expect(computeHandDepth(run(20, (i) => fr(i * 20, 0.3, 0.1)), 1).handR[10][0]).toBe(R_MAX);
    expect(computeHandDepth(run(20, (i) => fr(i * 20, 0.02, 0.3)), 1).handR[10][0]).toBe(R_MIN);
  });

  it('falls back to 0.7 when the take has no face', () => {
    const d = computeHandDepth(run(20, (i) => fr(i * 20, null, 0.15)), 1);
    expect(d.handR[5][0]).toBe(DEFAULT_R);
    expect(d.pivot).toBeNull();
  });

  it('holds the face size through a dropout (hand over the face)', () => {
    const d = computeHandDepth(run(30, (i) => fr(i * 20, i >= 10 && i <= 19 ? null : 0.15, 0.15)), 1);
    for (let i = 8; i <= 21; i++) expect(d.handR[i][0]).toBeCloseTo(9.5 / 14.5, 4);
  });

  it('keeps handR aligned with each frame\'s hand list', () => {
    const frames = [fr(0, 0.15), fr(20, 0.15, 0.15), fr(40, 0.15, 0.15, 0.2)];
    const d = computeHandDepth(frames, 1);
    expect(d.handR.map((r) => r.length)).toEqual([0, 1, 2]);
  });

  it('never returns NaN or Infinity for a collapsed hand or a zero-width face (review focus 5)', () => {
    const collapsed = run(20, (i) => fr(i * 20, 0.15, 0));
    const zeroFace = run(20, (i) => fr(i * 20, 1e-12, 0.15));
    for (const frames of [collapsed, zeroFace]) {
      for (const row of computeHandDepth(frames, 1).handR) {
        for (const r of row) {
          expect(Number.isFinite(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(R_MIN);
          expect(r).toBeLessThanOrEqual(R_MAX);
        }
      }
    }
  });

  it('pivot is the median nose tip', () => {
    const d = computeHandDepth(run(21, (i) => fr(i * 20, 0.15, 0.15)), 1);
    expect(d.pivot!.x).toBeCloseTo(0.5, 6);
    expect(d.pivot!.y).toBeCloseTo(0.45, 6);
    expect(d.pivot!.z).toBeCloseTo(-0.02, 6);
  });

  it('handles an empty take', () => expect(computeHandDepth([], 1)).toEqual({ handR: [], pivot: null }));
});
