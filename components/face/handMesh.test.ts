/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildHandTriangles, FINGER_TAPER } from './handMesh';
import { fitProjection } from './lowPoly';

// Open hand: wrist at (cx, cy), fingers pointing up, `s` = size in normalized units.
const hand = (cx: number, cy: number, s: number) => {
  const pts: [number, number][] = [[0,0],[-0.35,0.25],[-0.6,0.5],[-0.8,0.7],[-0.95,0.9],
    [-0.25,0.9],[-0.3,1.3],[-0.33,1.55],[-0.35,1.75],[0,0.95],[0,1.4],[0,1.7],[0,1.9],
    [0.22,0.9],[0.26,1.3],[0.28,1.55],[0.3,1.72],[0.4,0.8],[0.5,1.1],[0.56,1.3],[0.6,1.45]];
  return pts.map(([x, y], i) => ({ x: cx + x * s, y: cy - y * s, z: -0.01 * (i % 4) }));
};
const proj = fitProjection(800, 600, 4 / 3);

// Triangle 4 is the first finger bone's first triangle: (a+p*wa, b+p*wb, b-p*wb).
// Its a-side width is the distance between vertex A of tri 4 and vertex C of tri 5 (a-p*wa).
const knuckleWidth = (lm: ReturnType<typeof hand>) => {
  const t = buildHandTriangles(lm, proj);
  return Math.hypot(t[4].ax - t[5].cx, t[4].ay - t[5].cy);
};

describe('buildHandTriangles', () => {
  it('emits 4 palm + 30 finger triangles', () => {
    expect(buildHandTriangles(hand(0.5, 0.8, 0.1), proj).length).toBe(34);
  });

  it('scales finger width with palm size', () => {
    expect(knuckleWidth(hand(0.5, 0.8, 0.2))).toBeCloseTo(knuckleWidth(hand(0.5, 0.8, 0.1)) * 2, 1);
  });

  it('tapers about 1.3x from knuckle to tip', () => {
    expect(FINGER_TAPER[0] / FINGER_TAPER[FINGER_TAPER.length - 1]).toBeCloseTo(1.3, 1);
  });

  it('uses gray-ramp colors only', () => {
    for (const t of buildHandTriangles(hand(0.5, 0.8, 0.1), proj)) expect(t.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});
