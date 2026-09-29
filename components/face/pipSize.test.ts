import { describe, it, expect } from 'vitest';
import { pipDims } from './pipSize';

describe('pipDims', () => {
  it('sizes a landscape frame by its long side, aspect-true', () => {
    expect(pipDims(4 / 3, 192)).toEqual({ w: 192, h: 144 });
  });
  it('sizes a portrait phone frame without stretching it', () => {
    expect(pipDims(3 / 4, 192)).toEqual({ w: 144, h: 192 });
  });
  it('handles square and junk aspects', () => {
    expect(pipDims(1, 100)).toEqual({ w: 100, h: 100 });
    expect(pipDims(NaN, 192)).toEqual({ w: 192, h: 144 });
    expect(pipDims(0, 192)).toEqual({ w: 192, h: 144 });
  });
});
