/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { makeChannel, fillGaps, smoothZeroPhase, medianDt, Channel } from './series';

const DT = 20;

const chan = (values: (number | null)[], dim = 1): Channel => {
  const ch = makeChannel(values.length, dim);
  values.forEach((v, i) => {
    if (v !== null) {
      ch.present[i] = 1;
      ch.data[i * dim] = v;
    }
  });
  return ch;
};

const closeAll = (actual: ArrayLike<number>, expected: number[], digits = 9) =>
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits));

describe('medianDt', () => {
  it('is the median positive interval', () => expect(medianDt([0, 20, 40, 100, 120])).toBe(20));
  it('is 0 when there is no positive interval', () => {
    expect(medianDt([5])).toBe(0);
    expect(medianDt([5, 5, 5])).toBe(0);
    expect(medianDt([])).toBe(0);
  });
});

describe('fillGaps', () => {
  it('reconstructs a straight line exactly across a short gap', () => {
    const ch = chan([0, 1, 2, null, null, null, 6, 7, 8]);
    const s = fillGaps(ch, DT, 300);
    closeAll(ch.data, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(ch.present)).toEqual(Array(9).fill(1));
    expect(s).toEqual({ filled: 1, left: 0, filledSamples: 3 });
  });

  it('bridges a curved gap near a sine peak within 3 percent', () => {
    const n = 50;
    const truth = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / 50));
    const ch = chan(truth.map((v, i) => (i >= 10 && i <= 14 ? null : v)));
    fillGaps(ch, DT, 300);
    for (let i = 10; i <= 14; i++) expect(Math.abs(ch.data[i] - truth[i])).toBeLessThan(0.03);
  });

  it('leaves a gap longer than maxGapMs absent and counts it', () => {
    const values: (number | null)[] = [0, 1, ...Array(20).fill(null), 22, 23];
    const ch = chan(values);
    const s = fillGaps(ch, DT, 300); // span 21 samples = 420 ms
    expect(s).toEqual({ filled: 0, left: 1, filledSamples: 0 });
    expect(ch.present[5]).toBe(0);
  });

  it('calls onGap once per interior gap, filled or left, and leaves the stats unchanged', () => {
    const calls: [number, number, boolean][] = [];
    const values: (number | null)[] = [null, 0, 1, null, null, 4, 5, ...Array(20).fill(null), 26, 27, null];
    const ch = chan(values);
    const s = fillGaps(ch, DT, 300, { onGap: (a, b, f) => calls.push([a, b, f]) });
    expect(calls).toEqual([
      [2, 5, true],
      [6, 27, false],
    ]);
    expect(s).toEqual({ filled: 1, left: 1, filledSamples: 2 });
  });

  it('never fills leading or trailing absence', () => {
    const ch = chan([null, null, 3, 4, null, null]);
    const s = fillGaps(ch, DT, 300);
    expect(Array.from(ch.present)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(s).toEqual({ filled: 0, left: 0, filledSamples: 0 });
  });

  it('clamps to 0..1 when asked', () => {
    // neighbour slopes make the cubic overshoot to 1.75 at the middle of the gap
    const ch = chan([0, 1, null, null, 1, 0]);
    fillGaps(ch, DT, 300, { clamp01: true });
    for (let i = 0; i < 6; i++) expect(ch.data[i]).toBeLessThanOrEqual(1);
  });

  it('linear mode ignores neighbour slopes', () => {
    const ch = chan([0, 1, null, null, 1, 0]);
    fillGaps(ch, DT, 300, { linear: true });
    closeAll(ch.data, [0, 1, 1, 1, 1, 0]);
  });

  it('fills every dimension of a multi-dim channel', () => {
    const ch = makeChannel(5, 2);
    [0, 1, 4].forEach((i) => {
      ch.present[i] = 1;
      ch.data[i * 2] = i;
      ch.data[i * 2 + 1] = 10 + i;
    });
    fillGaps(ch, DT, 300, { linear: true });
    expect(ch.data[2 * 2]).toBeCloseTo(2);
    expect(ch.data[2 * 2 + 1]).toBeCloseTo(12);
  });

  it.each([0, NaN, -20])('fills nothing and reports zero stats when dtMs is %s', (bad) => {
    const ch = chan([0, 1, ...Array(20).fill(null), 22, 23]);
    const s = fillGaps(ch, bad, 300);
    expect(s).toEqual({ filled: 0, left: 0, filledSamples: 0 });
    expect(ch.present[5]).toBe(0);
    expect(ch.data[5]).toBe(0);
  });
});

describe('smoothZeroPhase', () => {
  const sine = (n: number, period: number) => Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / period));
  const argmax = (a: ArrayLike<number>, lo: number, hi: number) => {
    let best = lo;
    for (let i = lo; i < hi; i++) if (a[i] > a[best]) best = i;
    return best;
  };
  const P = { minCutoff: 3, beta: 0 };

  it('keeps the peak in place while a causal pass of the same filter lags', () => {
    const x = sine(250, 40); // peaks at 10 + 40k
    const ch = chan(x);
    smoothZeroPhase(ch, DT, P);
    expect(argmax(ch.data, 110, 150)).toBe(130);

    const r = 2 * Math.PI * P.minCutoff * (DT / 1000);
    const a = r / (r + 1);
    const causal = [x[0]];
    for (let i = 1; i < x.length; i++) causal.push(causal[i - 1] + a * (x[i] - causal[i - 1]));
    expect(argmax(causal, 110, 150)).toBeGreaterThan(130);
  });

  it('reduces noise on a slow signal', () => {
    let s = 12345;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s / 2147483648) * 2 - 1;
    };
    const truth = sine(400, 200);
    const noisy = truth.map((v) => v + 0.1 * rnd());
    const ch = chan(noisy);
    smoothZeroPhase(ch, DT, P);
    const rms = (xs: ArrayLike<number>) => Math.sqrt(Array.from(xs).reduce((a, b) => a + b * b, 0) / xs.length);
    const errBefore = rms(noisy.map((v, i) => v - truth[i]));
    const errAfter = rms(Array.from(ch.data).map((v, i) => v - truth[i]));
    expect(errAfter).toBeLessThan(0.7 * errBefore);
  });

  it('does not bleed across an absent run', () => {
    const ch = chan([...Array(20).fill(5), ...Array(5).fill(null), ...Array(20).fill(1)]);
    smoothZeroPhase(ch, DT, { minCutoff: 2, beta: 0 });
    for (let i = 25; i < 45; i++) expect(ch.data[i]).toBeCloseTo(1, 9);
    for (let i = 0; i < 20; i++) expect(ch.data[i]).toBeCloseTo(5, 9);
  });

  it('breakBetween splits a segment so a step is not smeared', () => {
    const ch = chan([...Array(10).fill(0), ...Array(10).fill(1)]);
    smoothZeroPhase(ch, DT, { minCutoff: 2, beta: 0 }, { breakBetween: (_a, b) => b === 10 });
    expect(ch.data[9]).toBeCloseTo(0, 9);
    expect(ch.data[10]).toBeCloseTo(1, 9);
  });

  it('smoothing without a break does smear the same step (so the break test discriminates)', () => {
    const ch = chan([...Array(10).fill(0), ...Array(10).fill(1)]);
    smoothZeroPhase(ch, DT, { minCutoff: 2, beta: 0 });
    expect(ch.data[9]).toBeGreaterThan(0.05);
  });

  it('clamps to 0..1 when asked, given out-of-range input', () => {
    const input = [1.5, 1.5, 1.5, 1.5, -0.5, -0.5, -0.5, -0.5, 1.5, 1.5];
    const control = chan(input);
    smoothZeroPhase(control, DT, { minCutoff: 50, beta: 0 });
    expect(Array.from(control.data).some((v) => v < 0 || v > 1)).toBe(true); // control: unclamped leaves [0,1]
    const ch = chan(input);
    smoothZeroPhase(ch, DT, { minCutoff: 50, beta: 0 }, { clamp01: true });
    for (let i = 0; i < 10; i++) {
      expect(ch.data[i]).toBeGreaterThanOrEqual(0);
      expect(ch.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it.each([0, NaN, -20])('is a no-op when dtMs is %s (no NaN written)', (bad) => {
    const values = [1, 2, 3, 4, 5, 6];
    const ch = chan(values);
    smoothZeroPhase(ch, bad, { minCutoff: 3, beta: 0 });
    expect(Array.from(ch.data)).toEqual(values);
    expect(Array.from(ch.present)).toEqual(Array(6).fill(1));
  });

  it('leaves single-sample segments alone', () => {
    const ch = chan([null, 7, null]);
    smoothZeroPhase(ch, DT, P);
    expect(ch.data[1]).toBe(7);
  });
});
