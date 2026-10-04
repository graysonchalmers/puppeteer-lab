/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { nextAlternating } from './facePolicy';

describe('nextAlternating', () => {
  it('never alternates unless both landmarkers run', () => {
    expect(nextAlternating(false, 100, false)).toBe(false);
    expect(nextAlternating(true, 100, false)).toBe(false);
  });
  it('turns on when model cost exceeds a 30 fps frame and off only under a 45 fps one (hysteresis)', () => {
    expect(nextAlternating(false, 34, true)).toBe(true);
    expect(nextAlternating(false, 30, true)).toBe(false);
    expect(nextAlternating(true, 25, true)).toBe(true);
    expect(nextAlternating(true, 21, true)).toBe(false);
  });
  it('stays off on a 30 fps camera when the models are cheap (ticks follow camera frames)', () => {
    let alt = false;
    for (let i = 0; i < 100; i++) alt = nextAlternating(alt, 10, true); // 10 ms of inference per 33 ms frame
    expect(alt).toBe(false);
  });
});
