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

/**
 * Inverse of smoothingToLerp: recovers the 0..1 UI amount from a per-frame
 * LERP alpha. Used at the useMediaPipe adapter boundary, which stores the
 * alpha directly (as the pre-Phase-2 hook always did) but must hand
 * useTracker a UI amount (useTracker applies smoothingToLerp itself).
 */
export function lerpToSmoothing(alpha: number): number {
  return (1 - alpha) / 0.9;
}

export interface LandmarkLike { x: number; y: number; z: number }

/**
 * Per-landmark lerp from prev toward next. alpha is the per-frame LERP factor
 * (1.0 = raw passthrough, 0.1 = heavy). Returns next untouched when there is
 * nothing to blend against, so the first frame and hand re-entry never swoop.
 */
export function smoothLandmarks(
  prev: LandmarkLike[] | null,
  next: LandmarkLike[],
  alpha: number
): LandmarkLike[] {
  if (!prev || prev.length !== next.length || alpha >= 1) return next;
  const a = Math.max(0.01, alpha);
  return next.map((n, i) => ({
    x: prev[i].x + (n.x - prev[i].x) * a,
    y: prev[i].y + (n.y - prev[i].y) * a,
    z: prev[i].z + (n.z - prev[i].z) * a,
  }));
}
