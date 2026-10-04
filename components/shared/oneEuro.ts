/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One Euro filter (Casiez et al. 2012) over landmark arrays: an adaptive
 * low-pass that smooths heavily when a point is still and opens up (less
 * lag) when it moves fast. Used for face landmarks (Face Puppet); hands keep
 * the slider-driven lerp in smoothing.ts.
 */
import { Landmark } from './trackerTypes';

export interface OneEuroParams {
  minCutoff: number; // Hz, smoothing at rest (lower = smoother, more lag)
  beta: number;      // speed coefficient (higher = less lag when moving)
  dCutoff: number;   // Hz, cutoff for the derivative estimate
  /** Optional lighter filtering for some points (the lips: speech is small and fast). */
  fast?: { points: readonly number[]; minCutoffScale: number; dCutoff: number };
}

export const FACE_ONE_EURO_DEFAULTS: OneEuroParams = { minCutoff: 0.5, beta: 40, dCutoff: 1 };

/** Face Smoothing slider (0..1) to minCutoff: 0 -> 5 Hz (light), 1 -> 0.05 Hz (heavy), log scale. */
export function faceSmoothingToMinCutoff(amount01: number): number {
  const a = Math.max(0, Math.min(1, amount01));
  return 5 * Math.pow(0.01, a);
}

export interface OneEuroBank {
  params: OneEuroParams;
  filter(points: Landmark[], tMs: number): Landmark[];
  reset(): void;
}

const smoothingFactor = (cutoffHz: number, dtS: number) => {
  const r = 2 * Math.PI * cutoffHz * dtS;
  return r / (r + 1);
};

export function createOneEuroBank(params: OneEuroParams = { ...FACE_ONE_EURO_DEFAULTS }): OneEuroBank {
  let x: Float64Array | null = null;  // filtered values, 3 per point
  let dx: Float64Array | null = null; // filtered derivatives
  let lastT = 0;
  let fastMask: Uint8Array | null = null;
  let fastMaskFor: OneEuroParams['fast'] | null = null;

  const bank: OneEuroBank = {
    params,
    reset() {
      x = null;
      dx = null;
    },
    filter(points, tMs) {
      const n = points.length * 3;
      if (!x || !dx || x.length !== n) {
        x = new Float64Array(n);
        dx = new Float64Array(n);
        points.forEach((p, i) => {
          x![i * 3] = p.x;
          x![i * 3 + 1] = p.y;
          x![i * 3 + 2] = p.z;
        });
        lastT = tMs;
        return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      }

      const dtS = Math.max(1e-3, (tMs - lastT) / 1000);
      lastT = tMs;
      const { minCutoff, beta, dCutoff, fast } = bank.params;
      if (fast && (fastMaskFor !== fast || fastMask!.length !== points.length)) {
        fastMask = new Uint8Array(points.length);
        for (const i of fast.points) if (i < points.length) fastMask[i] = 1;
        fastMaskFor = fast;
      }
      const aD = smoothingFactor(dCutoff, dtS);
      const aDFast = fast ? smoothingFactor(fast.dCutoff, dtS) : aD;
      const minFast = fast ? minCutoff * fast.minCutoffScale : minCutoff;

      const out: Landmark[] = new Array(points.length);
      const step = (k: number, raw: number, ad: number, mc: number) => {
        dx![k] += ad * ((raw - x![k]) / dtS - dx![k]);
        x![k] += smoothingFactor(mc + beta * Math.abs(dx![k]), dtS) * (raw - x![k]);
        return x![k];
      };
      for (let i = 0; i < points.length; i++) {
        const isFast = fast !== undefined && fastMask![i] === 1;
        const ad = isFast ? aDFast : aD;
        const mc = isFast ? minFast : minCutoff;
        const p = points[i];
        const k = i * 3;
        out[i] = { x: step(k, p.x, ad, mc), y: step(k + 1, p.y, ad, mc), z: step(k + 2, p.z, ad, mc) };
      }
      return out;
    },
  };
  return bank;
}
