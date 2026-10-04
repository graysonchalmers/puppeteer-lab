/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD-001 cost policy: when hands and face landmarkers both run and their
 * combined inference cost no longer fits a 30 fps frame, run the hand
 * landmarker on alternate ticks and reuse the previous hands (the face drives
 * the puppet, hands are secondary). Measured on model cost, not on the tick
 * interval: ticks follow camera frames, so a 30 fps camera always reads ~33 ms
 * apart however fast the device is. Hysteresis (on above 33 ms, off below
 * 22 ms); the skipped hand model keeps its last measured cost, so the policy
 * does not flap.
 */
const ON_ABOVE_MS = 1000 / 30;
const OFF_BELOW_MS = 1000 / 45;

export function nextAlternating(alternating: boolean, costMs: number, bothEnabled: boolean): boolean {
  if (!bothEnabled) return false;
  return alternating ? costMs >= OFF_BELOW_MS : costMs > ON_ABOVE_MS;
}
