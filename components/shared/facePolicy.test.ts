/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { updateAvgDt, nextAlternating } from './facePolicy';

describe('updateAvgDt', () => {
  it('passes the first sample through, then EMA 0.9/0.1', () => {
    expect(updateAvgDt(0, 20)).toBe(20);
    expect(updateAvgDt(20, 30)).toBeCloseTo(21);
  });
});

describe('nextAlternating', () => {
  it('never alternates unless both landmarkers run', () => {
    expect(nextAlternating(false, 100, false)).toBe(false);
    expect(nextAlternating(true, 100, false)).toBe(false);
  });
  it('turns on under 30 fps and off only above 45 fps (hysteresis)', () => {
    expect(nextAlternating(false, 34, true)).toBe(true);
    expect(nextAlternating(false, 30, true)).toBe(false);
    expect(nextAlternating(true, 25, true)).toBe(true);
    expect(nextAlternating(true, 21, true)).toBe(false);
  });
});
