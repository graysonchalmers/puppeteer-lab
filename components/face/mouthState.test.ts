/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { mouthOpenRatio, nextMouthOpen, MOUTH_OPEN_ABOVE, MOUTH_CLOSE_BELOW } from './mouthState';

// 478 landmarks, all at the center, with the four mouth points placed.
const face = (gap: number, width: number, cx = 0.5, cy = 0.6) => {
  const lm = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  lm[61] = { x: cx - width / 2, y: cy, z: 0 };
  lm[291] = { x: cx + width / 2, y: cy, z: 0 };
  lm[13] = { x: cx, y: cy - gap / 2, z: 0 };
  lm[14] = { x: cx, y: cy + gap / 2, z: 0 };
  return lm;
};

describe('mouthOpenRatio', () => {
  it('is gap over width with x scaled by aspect', () => {
    // width 0.1 normalized at aspect 2 = 0.2 height units; gap 0.02 -> 0.1
    expect(mouthOpenRatio(face(0.02, 0.1), 2)).toBeCloseTo(0.1);
  });

  it('is scale invariant (same face at 2x is the same ratio)', () => {
    expect(mouthOpenRatio(face(0.04, 0.2), 4 / 3)).toBeCloseTo(mouthOpenRatio(face(0.02, 0.1), 4 / 3));
  });

  it('returns 0 for a degenerate mouth width', () => {
    expect(mouthOpenRatio(face(0.02, 0), 4 / 3)).toBe(0);
  });
});

describe('nextMouthOpen', () => {
  const mid = (MOUTH_OPEN_ABOVE + MOUTH_CLOSE_BELOW) / 2;
  it('opens only above the upper threshold', () => {
    expect(nextMouthOpen(false, mid)).toBe(false);
    expect(nextMouthOpen(false, MOUTH_OPEN_ABOVE + 0.001)).toBe(true);
  });
  it('closes only below the lower threshold', () => {
    expect(nextMouthOpen(true, mid)).toBe(true);
    expect(nextMouthOpen(true, MOUTH_CLOSE_BELOW - 0.001)).toBe(false);
  });
});
