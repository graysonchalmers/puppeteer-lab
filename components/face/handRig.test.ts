/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { handRig, HAND_SEGMENTS } from './handRig';

// Flat open hand facing the camera: wrist at the bottom, fingers up (image y down).
const hand = (): Landmark[] => {
  const pts: [number, number][] = [[0.5, 0.8],
    [0.44, 0.76], [0.4, 0.72], [0.37, 0.68], [0.35, 0.64],
    [0.46, 0.64], [0.46, 0.58], [0.46, 0.54], [0.46, 0.5],
    [0.5, 0.63], [0.5, 0.56], [0.5, 0.52], [0.5, 0.48],
    [0.54, 0.64], [0.54, 0.58], [0.54, 0.54], [0.54, 0.51],
    [0.58, 0.66], [0.58, 0.61], [0.58, 0.58], [0.58, 0.55]];
  return pts.map(([x, y]) => ({ x, y, z: 0 }));
};

describe('handRig', () => {
  const p = fitProjection(1000, 1000, 1);

  it('makes 16 finger segments from the landmark pairs', () => {
    const r = handRig(hand(), p);
    expect(r.segments.length).toBe(HAND_SEGMENTS.length);
    expect(HAND_SEGMENTS.length).toBe(16);
    const s = r.segments[HAND_SEGMENTS.findIndex(([a, b]) => a === 9 && b === 10)];
    expect(s.a[0]).toBeCloseTo(p.x(hand()[9]));
    expect(s.b[1]).toBeCloseTo(-p.y(hand()[10]));
  });

  it('makes the thumb thickest and the pinky thinnest, tapering to the tip', () => {
    const r = handRig(hand(), p);
    const seg = (a: number, b: number) => r.segments[HAND_SEGMENTS.findIndex(([x, y]) => x === a && y === b)];
    expect(seg(2, 3).radius).toBeGreaterThan(seg(18, 19).radius);
    expect(seg(9, 10).radius).toBeGreaterThan(seg(11, 12).radius);
  });

  it('orients the palm pad: normal toward the camera for a hand facing it, thickness a third of width', () => {
    const r = handRig(hand(), p);
    expect(Math.abs(r.palm.n[2])).toBeCloseTo(1, 5);
    expect(r.palm.sn * 2).toBeCloseTo((r.palm.sv * 2) / 3, 5);
    expect(r.palm.u[1]).toBeGreaterThan(0.9); // wrist -> middle knuckle points up on screen
  });

  it('has a joint for every landmark used by a segment', () => {
    const r = handRig(hand(), p);
    expect(r.joints.length).toBe(new Set(HAND_SEGMENTS.flatMap(([a, b]) => [a, b])).size);
  });
});
