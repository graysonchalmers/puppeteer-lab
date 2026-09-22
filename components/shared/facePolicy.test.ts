/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { updateAvgDt, nextFaceAlternating } from './facePolicy';

describe('updateAvgDt', () => {
  it('passes the first sample through, then EMA 0.9/0.1', () => {
    expect(updateAvgDt(0, 20)).toBe(20);
    expect(updateAvgDt(20, 30)).toBeCloseTo(21);
  });
});

describe('nextFaceAlternating', () => {
  it('never alternates unless both landmarkers run', () => {
    expect(nextFaceAlternating(false, 100, false)).toBe(false);
    expect(nextFaceAlternating(true, 100, false)).toBe(false);
  });
  it('turns on under 30 fps and off only above 45 fps (hysteresis)', () => {
    expect(nextFaceAlternating(false, 34, true)).toBe(true);
    expect(nextFaceAlternating(false, 30, true)).toBe(false);
    expect(nextFaceAlternating(true, 25, true)).toBe(true);
    expect(nextFaceAlternating(true, 21, true)).toBe(false);
  });
});
