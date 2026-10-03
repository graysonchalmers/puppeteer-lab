/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Numeric primitives behind the take cleanup layer. A Channel is n samples x dim values with a presence mask;
 * gap fill and zero-phase smoothing both work in place and never touch absent samples except to fill a short,
 * bounded gap between two present ones.
 */

export interface Channel {
  /** n samples x dim values, row-major. */
  data: Float64Array;
  /** 1 where the sample exists (recorded or filled). */
  present: Uint8Array;
  n: number;
  dim: number;
}

export function makeChannel(n: number, dim: number): Channel {
  return { data: new Float64Array(n * dim), present: new Uint8Array(n), n, dim };
}

export interface GapStats {
  filled: number;
  left: number;
  filledSamples: number;
}

/** Median of the positive intervals between timestamps; 0 when there are none. */
export function medianDt(timestamps: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const x = timestamps[i] - timestamps[i - 1];
    if (x > 0) d.push(x);
  }
  if (d.length === 0) return 0;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/**
 * Fills gaps in place. A gap is a run of absent samples with a present sample on both sides; it is filled only when
 * the time between those two samples is at most `maxGapMs`. Landmarks use cubic Hermite with one-sided neighbour
 * slopes (secant when a neighbour is absent); `linear` interpolates straight. Leading and trailing absence is
 * never filled (no extrapolation).
 */
export function fillGaps(
  ch: Channel,
  dtMs: number,
  maxGapMs: number,
  opts: { linear?: boolean; clamp01?: boolean } = {},
): GapStats {
  const { data, present, n, dim } = ch;
  const stats: GapStats = { filled: 0, left: 0, filledSamples: 0 };
  let i = 0;
  while (i < n) {
    if (present[i]) {
      i++;
      continue;
    }
    const i0 = i - 1;
    let i1 = i;
    while (i1 < n && !present[i1]) i1++;
    i = i1;
    if (i0 < 0 || i1 >= n) continue; // leading or trailing: never filled
    const span = i1 - i0;
    if (span * dtMs > maxGapMs) {
      stats.left++;
      continue;
    }
    const hasPrev = i0 >= 1 && present[i0 - 1] === 1;
    const hasNext = i1 + 1 < n && present[i1 + 1] === 1;
    for (let d = 0; d < dim; d++) {
      const v0 = data[i0 * dim + d];
      const v1 = data[i1 * dim + d];
      const secant = (v1 - v0) / span;
      const m0 = !opts.linear && hasPrev ? v0 - data[(i0 - 1) * dim + d] : secant;
      const m1 = !opts.linear && hasNext ? data[(i1 + 1) * dim + d] - v1 : secant;
      for (let k = 1; k < span; k++) {
        const s = k / span;
        let v: number;
        if (opts.linear) {
          v = v0 + (v1 - v0) * s;
        } else {
          const s2 = s * s;
          const s3 = s2 * s;
          v =
            (2 * s3 - 3 * s2 + 1) * v0 +
            (s3 - 2 * s2 + s) * span * m0 +
            (-2 * s3 + 3 * s2) * v1 +
            (s3 - s2) * span * m1;
        }
        data[(i0 + k) * dim + d] = opts.clamp01 ? Math.min(1, Math.max(0, v)) : v;
      }
    }
    for (let k = 1; k < span; k++) present[i0 + k] = 1;
    stats.filled++;
    stats.filledSamples += span - 1;
  }
  return stats;
}

export interface SmoothParams {
  minCutoff: number; // Hz at rest
  beta: number; // speed coefficient, as in the One Euro filter
}

/**
 * Zero-phase smoothing in place: per contiguous present segment (optionally split where `breakBetween(prev, next)`
 * is true), a forward then a backward exponential pass whose per-sample alpha comes from a speed-adaptive cutoff
 * (`minCutoff + beta * |v|`, v a central difference over +-2 samples). Segments never bleed into each other.
 */
export function smoothZeroPhase(
  ch: Channel,
  dtMs: number,
  p: SmoothParams,
  opts: { breakBetween?: (prev: number, next: number) => boolean; clamp01?: boolean } = {},
): void {
  const { data, present, n, dim } = ch;
  const dt = dtMs / 1000;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const a = new Float64Array(n);
  const out = (v: number) => (opts.clamp01 ? Math.min(1, Math.max(0, v)) : v);
  let s = 0;
  while (s < n) {
    if (!present[s]) {
      s++;
      continue;
    }
    let e = s + 1;
    while (e < n && present[e] && !(opts.breakBetween && opts.breakBetween(e - 1, e))) e++;
    const len = e - s;
    if (len >= 2) {
      for (let d = 0; d < dim; d++) {
        for (let j = 0; j < len; j++) x[j] = data[(s + j) * dim + d];
        for (let j = 0; j < len; j++) {
          const lo = Math.max(0, j - 2);
          const hi = Math.min(len - 1, j + 2);
          const v = (x[hi] - x[lo]) / ((hi - lo) * dt);
          const r = 2 * Math.PI * (p.minCutoff + p.beta * Math.abs(v)) * dt;
          a[j] = r / (r + 1);
        }
        y[0] = x[0];
        for (let j = 1; j < len; j++) y[j] = y[j - 1] + a[j] * (x[j] - y[j - 1]);
        let z = y[len - 1];
        data[(s + len - 1) * dim + d] = out(z);
        for (let j = len - 2; j >= 0; j--) {
          z = z + a[j] * (y[j] - z);
          data[(s + j) * dim + d] = out(z);
        }
      }
    }
    s = e;
  }
}
