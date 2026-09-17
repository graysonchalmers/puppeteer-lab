/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { pinchProximityColor } from './pinchTracer';

describe('pinchProximityColor', () => {
  it('is neutral gray at or beyond the far cutoff', () => {
    expect(pinchProximityColor(120, '#EE3B2B')).toBe('rgb(156, 163, 175)');
    expect(pinchProximityColor(500, '#EE3B2B')).toBe('rgb(156, 163, 175)');
  });

  it('is the solid accent at or inside the pinch threshold', () => {
    expect(pinchProximityColor(30, '#EE3B2B')).toBe('rgb(238, 59, 43)');
    expect(pinchProximityColor(0, '#EE3B2B')).toBe('rgb(238, 59, 43)');
  });

  it('interpolates halfway between neutral and accent at the midpoint distance', () => {
    // farPx=120, nearPx=30 by default -> midpoint dist = 75
    expect(pinchProximityColor(75, '#EE3B2B')).toBe('rgb(197, 111, 109)');
  });

  it('treats a non-finite distance (hand not tracked) as fully open/neutral', () => {
    expect(pinchProximityColor(Infinity, '#EE3B2B')).toBe('rgb(156, 163, 175)');
  });

  it('works with a different accent color (left hand)', () => {
    expect(pinchProximityColor(30, '#38BDF8')).toBe('rgb(56, 189, 248)');
  });
});
