/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { mapHandToWorld } from './mapHandToWorld';

describe('mapHandToWorld', () => {
  it('maps normalized center with zero depth to the Y-offset baseline', () => {
    const v = mapHandToWorld(0.5, 0.5, 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0.8);
    expect(v.z).toBeCloseTo(0);
  });

  it('maps the top-left normalized corner with positive depth', () => {
    const v = mapHandToWorld(0, 0, 1);
    expect(v.x).toBeCloseTo(2.5);
    expect(v.y).toBeCloseTo(2.55);
    expect(v.z).toBeCloseTo(8);
  });

  it('clamps Y to a 0.1 floor instead of going negative', () => {
    const v = mapHandToWorld(1, 1, 1);
    expect(v.x).toBeCloseTo(-2.5);
    expect(v.y).toBeCloseTo(0.1);
    expect(v.z).toBeCloseTo(8);
  });
});
