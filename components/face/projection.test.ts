/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { fitProjection, toScene } from './projection';

describe('fitProjection', () => {
  it('contain-fits a 4:3 camera into a wide stage, centered and mirrored', () => {
    const p = fitProjection(800, 400, 4 / 3);
    expect(p.drawH).toBe(400);
    expect(p.drawW).toBeCloseTo(533.333, 2);
    expect(p.offsetX).toBeCloseTo(133.333, 2);
    expect(p.x({ x: 0, y: 0, z: 0 })).toBeCloseTo(133.333 + 533.333, 2);
    expect(p.x({ x: 1, y: 1, z: 0 })).toBeCloseTo(133.333, 2);
    expect(p.y({ x: 1, y: 1, z: 0 })).toBe(400);
  });

  it('letterboxes vertically on a tall stage', () => {
    const p = fitProjection(400, 800, 4 / 3);
    expect(p.drawW).toBe(400);
    expect(p.drawH).toBe(300);
    expect(p.offsetY).toBe(250);
  });

  it('scales z by drawn width', () => {
    const p = fitProjection(800, 600, 4 / 3);
    expect(p.z({ x: 0, y: 0, z: -0.1 })).toBeCloseTo(-80);
  });
});

describe('toScene', () => {
  it('flips y up and z toward the camera', () => {
    const p = fitProjection(800, 600, 4 / 3);
    const [x, y, z] = toScene({ x: 0.5, y: 0.25, z: -0.1 }, p);
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(-150);
    expect(z).toBeCloseTo(80);
  });
});
