/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared smoothing-slider maths + presets, extracted so the Air Canvas and
 * Hand Telemetry demos drive one identical Global Smoothing control instead of
 * two copies that could silently drift.
 */

/** Slider preset buttons shown above the smoothing range input. */
export const SMOOTHING_PRESETS = [
  { label: 'RAW', val: 0.0 },
  { label: 'BAL', val: 0.4 },
  { label: 'SMTH', val: 0.75 },
  { label: 'MAX', val: 0.95 },
] as const;

/**
 * Map the 0..1 UI smoothing amount to the per-frame cursor LERP factor fed to
 * useMediaPipe: 0 -> 1.0 (raw passthrough), 1 -> 0.1 (heaviest interpolation).
 * An inverted sign here silently reverses what the slider does, which is why
 * the endpoints are pinned by a test.
 */
export function smoothingToLerp(amount: number): number {
  return 1.0 - amount * 0.9;
}
