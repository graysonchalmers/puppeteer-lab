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
      const { minCutoff, beta, dCutoff } = bank.params;
      const aD = smoothingFactor(dCutoff, dtS);

      const out: Landmark[] = new Array(points.length);
      for (let i = 0; i < points.length; i++) {
        const raw = [points[i].x, points[i].y, points[i].z];
        const res = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const k = i * 3 + c;
          const d = (raw[c] - x[k]) / dtS;
          dx[k] = dx[k] + aD * (d - dx[k]);
          const a = smoothingFactor(minCutoff + beta * Math.abs(dx[k]), dtS);
          x[k] = x[k] + a * (raw[c] - x[k]);
          res[c] = x[k];
        }
        out[i] = { x: res[0], y: res[1], z: res[2] };
      }
      return out;
    },
  };
  return bank;
}
