/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { createOneEuroBank, faceSmoothingToMinCutoff, FACE_ONE_EURO_DEFAULTS } from './oneEuro';

const pt = (x: number) => [{ x, y: 0.5, z: 0 }];
const FRAME_MS = 1000 / 60;

// Deterministic pseudo-noise in [-1, 1] (LCG), so the test never flakes.
const noise = (() => {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 - 1;
  };
})();

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe('createOneEuroBank', () => {
  it('passes the first sample through untouched', () => {
    const bank = createOneEuroBank();
    expect(bank.filter(pt(0.3), 0)[0].x).toBe(0.3);
  });

  it('suppresses jitter on a still point', () => {
    const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS });
    const inputs: number[] = [];
    const outputs: number[] = [];
    for (let i = 0; i < 180; i++) {
      const x = 0.5 + noise() * 0.003;
      const out = bank.filter(pt(x), i * FRAME_MS)[0].x;
      if (i >= 60) { inputs.push(x); outputs.push(out); }
    }
    expect(std(outputs)).toBeLessThan(std(inputs) * 0.5);
  });

  it('tracks a step within 200 ms', () => {
    const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS });
    let t = 0;
    for (let i = 0; i < 30; i++) bank.filter(pt(0), (t += FRAME_MS));
    let out = 0;
    for (let i = 0; i < 12; i++) out = bank.filter(pt(0.3), (t += FRAME_MS))[0].x;
    expect(out).toBeGreaterThan(0.24);
  });

  it('lags more with a lower minCutoff', () => {
    const run = (minCutoff: number) => {
      const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS, minCutoff });
      let out = 0;
      for (let i = 0; i < 60; i++) out = bank.filter(pt(i * 0.001), i * FRAME_MS)[0].x;
      return out;
    };
    expect(run(0.05)).toBeLessThan(run(5));
  });

  it('reads params live, so a slider can retune minCutoff mid-stream', () => {
    const bank = createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS });
    bank.params.minCutoff = 0.05;
    expect(bank.params.minCutoff).toBe(0.05);
  });

  it('passes through again after reset', () => {
    const bank = createOneEuroBank();
    bank.filter(pt(0.1), 0);
    bank.filter(pt(0.1), FRAME_MS);
    bank.reset();
    expect(bank.filter(pt(0.9), 2 * FRAME_MS)[0].x).toBe(0.9);
  });

  it('filters x, y and z independently and keeps array length', () => {
    const bank = createOneEuroBank();
    const out = bank.filter([{ x: 0.1, y: 0.2, z: 0.3 }, { x: 0.4, y: 0.5, z: 0.6 }], 0);
    expect(out).toEqual([{ x: 0.1, y: 0.2, z: 0.3 }, { x: 0.4, y: 0.5, z: 0.6 }]);
  });
});

describe('faceSmoothingToMinCutoff', () => {
  it('maps 0 to 5 Hz and 1 to 0.05 Hz, decreasing, clamped', () => {
    expect(faceSmoothingToMinCutoff(0)).toBeCloseTo(5);
    expect(faceSmoothingToMinCutoff(1)).toBeCloseTo(0.05);
    expect(faceSmoothingToMinCutoff(0.5)).toBeLessThan(faceSmoothingToMinCutoff(0.25));
    expect(faceSmoothingToMinCutoff(-1)).toBeCloseTo(5);
    expect(faceSmoothingToMinCutoff(2)).toBeCloseTo(0.05);
  });
});
