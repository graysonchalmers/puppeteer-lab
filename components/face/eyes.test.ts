/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import { fitProjection } from './projection';
import { eyePose, EYE_RADIUS_OF_WIDTH, EYE_SETBACK, GAZE_MAX } from './eyes';

const CONTOUR = [0, 1, 2, 3];
// A 0.1-wide, 0.04-tall eye centered at (0.5, 0.5), z = 0; iris landmark at index 4.
const eye = (irisX = 0.5, irisY = 0.5): Landmark[] => [
  { x: 0.45, y: 0.5, z: 0 }, { x: 0.5, y: 0.48, z: 0 }, { x: 0.55, y: 0.5, z: 0 }, { x: 0.5, y: 0.52, z: 0 },
  { x: irisX, y: irisY, z: 0 },
];

describe('eyePose', () => {
  const p = fitProjection(1000, 1000, 1);

  it('sits behind the lid opening, sized from the eye width', () => {
    const e = eyePose(eye(), CONTOUR, 4, p);
    expect(e.radius).toBeCloseTo(100 * EYE_RADIUS_OF_WIDTH); // width 0.1 * 1000 px
    expect(e.center[0]).toBeCloseTo(500);
    expect(e.center[1]).toBeCloseTo(-500);
    expect(e.center[2]).toBeCloseTo(-e.radius * EYE_SETBACK);
    expect(e.rx).toBeCloseTo(0);
    expect(e.ry).toBeCloseTo(0);
  });

  it('turns toward the iris (stage is mirrored: iris at lower x = to the right on stage)', () => {
    const e = eyePose(eye(0.48, 0.5), CONTOUR, 4, p);
    expect(e.ry).toBeGreaterThan(0);
  });

  it('clamps the gaze so the iris never rolls out of view', () => {
    const e = eyePose(eye(0.2, 0.5), CONTOUR, 4, p);
    expect(Math.abs(Math.sin(e.ry))).toBeLessThanOrEqual(GAZE_MAX + 1e-9);
  });
});
