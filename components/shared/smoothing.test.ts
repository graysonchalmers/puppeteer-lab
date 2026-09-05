/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { smoothingToLerp, SMOOTHING_PRESETS } from './smoothing';

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

describe('SMOOTHING_PRESETS', () => {
  it('exposes the four RAW..MAX presets, all in 0..1', () => {
    expect(SMOOTHING_PRESETS.map((p) => p.label)).toEqual(['RAW', 'BAL', 'SMTH', 'MAX']);
    for (const p of SMOOTHING_PRESETS) {
      expect(p.val).toBeGreaterThanOrEqual(0);
      expect(p.val).toBeLessThanOrEqual(1);
    }
  });
});
