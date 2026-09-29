/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Frames per second over a sliding window. Call tick(now) once per frame.
 */
export function createFpsMeter(windowMs = 1000) {
  const stamps: number[] = [];
  return {
    tick(nowMs: number): number {
      stamps.push(nowMs);
      while (stamps.length > 1 && nowMs - stamps[0] > windowMs) stamps.shift();
      const span = nowMs - stamps[0];
      return span > 0 ? ((stamps.length - 1) * 1000) / span : 0;
    },
  };
}
