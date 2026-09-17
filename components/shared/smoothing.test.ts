/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { smoothingToLerp, lerpToSmoothing, SMOOTHING_PRESETS } from './smoothing';

describe('smoothingToLerp', () => {
  it('maps 0 (raw) to a 1.0 passthrough LERP', () => {
    expect(smoothingToLerp(0)).toBe(1.0);
  });

  it('maps 1 (max) to the heaviest 0.1 LERP', () => {
    expect(smoothingToLerp(1)).toBeCloseTo(0.1, 10);
  });

  it('decreases as smoothing rises (guards against a flipped sign)', () => {
    expect(smoothingToLerp(0.75)).toBeLessThan(smoothingToLerp(0.4));
  });
});

describe('lerpToSmoothing', () => {
  it('is the exact inverse of smoothingToLerp at each SMOOTHING_PRESETS value', () => {
    for (const p of SMOOTHING_PRESETS) {
      const alpha = smoothingToLerp(p.val);
      expect(lerpToSmoothing(alpha)).toBeCloseTo(p.val, 10);
    }
  });

  it('round-trips the useMediaPipe adapter default alpha (0.6)', () => {
    const uiAmount = lerpToSmoothing(0.6);
    expect(smoothingToLerp(uiAmount)).toBeCloseTo(0.6, 10);
  });
});

describe('SMOOTHING_PRESETS', () => {
  it('exposes the four RAW..MAX presets, all in 0..1', () => {
    expect(SMOOTHING_PRESETS.map((p) => p.label)).toEqual(['RAW', 'BAL', 'SMTH', 'MAX']);
    for (const p of SMOOTHING_PRESETS) {
      expect(p.val).toBeGreaterThanOrEqual(0);
      expect(p.val).toBeLessThanOrEqual(1);
    }
  });
});

import { smoothLandmarks } from './smoothing';

describe('smoothLandmarks', () => {
  const prev = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }];
  const next = [{ x: 10, y: 10, z: 10 }, { x: 2, y: 2, z: 2 }];

  it('alpha 1 returns next unchanged (RAW passthrough)', () => {
    expect(smoothLandmarks(prev, next, 1.0)).toEqual(next);
  });

  it('alpha 0.1 moves 10% toward next', () => {
    const out = smoothLandmarks(prev, next, 0.1);
    expect(out[0].x).toBeCloseTo(1);
    expect(out[0].y).toBeCloseTo(1);
    expect(out[0].z).toBeCloseTo(1);
    expect(out[1].x).toBeCloseTo(1.1);
  });

  it('null prev returns next (first frame)', () => {
    expect(smoothLandmarks(null, next, 0.1)).toEqual(next);
  });

  it('length mismatch returns next', () => {
    expect(smoothLandmarks([{ x: 0, y: 0, z: 0 }], next, 0.1)).toEqual(next);
  });
});
