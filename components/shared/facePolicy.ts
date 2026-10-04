/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD-001 cost policy: when hands and face landmarkers both run and the loop
 * drops under ~30 fps, run the hand landmarker on alternate ticks and reuse
 * the previous hands (the face drives the puppet, hands are secondary). Hysteresis (on under 30 fps, off above 45 fps) so the
 * faster alternating loop does not immediately flip the policy back.
 */
const ON_ABOVE_MS = 1000 / 30;
const OFF_BELOW_MS = 1000 / 45;

export function updateAvgDt(avgMs: number, dtMs: number): number {
  return avgMs === 0 ? dtMs : avgMs * 0.9 + dtMs * 0.1;
}

export function nextAlternating(alternating: boolean, avgDtMs: number, bothEnabled: boolean): boolean {
  if (!bothEnabled) return false;
  return alternating ? avgDtMs >= OFF_BELOW_MS : avgDtMs > ON_ABOVE_MS;
}
