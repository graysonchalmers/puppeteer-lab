/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mouth open/closed for the Face Puppet: a scale-invariant ratio (inner-lip
 * gap over mouth-corner width) with hysteresis, so the state never flickers
 * at the boundary and does not change with distance to the camera. Replaces
 * the old absolute `mouthOpenDist > 4` pixel test.
 */
import { Landmark } from '../shared/trackerTypes';

export const MOUTH_OPEN_ABOVE = 0.08;
export const MOUTH_CLOSE_BELOW = 0.05;

const UPPER_INNER_LIP = 13;
const LOWER_INNER_LIP = 14;
const LEFT_CORNER = 61;
const RIGHT_CORNER = 291;

/** Normalized x is in image-width units and y in image-height units, so x is
 * scaled by the video aspect (width / height) to measure both in height units. */
export function mouthOpenRatio(lm: Landmark[], videoAspect: number): number {
  const d = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * videoAspect, a.y - b.y);
  const width = d(lm[LEFT_CORNER], lm[RIGHT_CORNER]);
  if (width < 1e-6) return 0;
  return d(lm[UPPER_INNER_LIP], lm[LOWER_INNER_LIP]) / width;
}

/** Raw jawOpen blendshape gate. Speech reads 0.05-0.2 while the lip ratio,
 * measured on smoothed landmarks, often stays under MOUTH_OPEN_ABOVE. A closed
 * mouth reads 0.005-0.02 (Grayson's 2026-09-22 take), so these sit above it. */
export const JAW_OPEN_ABOVE = 0.06;
export const JAW_CLOSE_BELOW = 0.03;

/** Open when the lips part OR the jaw drops; closed only when both are shut.
 * `jawOpen` is undefined for takes without blendshapes (lip ratio only). */
export function nextMouthOpen(wasOpen: boolean, ratio: number, jawOpen?: number): boolean {
  const jaw = jawOpen ?? 0;
  return wasOpen
    ? ratio >= MOUTH_CLOSE_BELOW || jaw >= JAW_CLOSE_BELOW
    : ratio > MOUTH_OPEN_ABOVE || jaw > JAW_OPEN_ABOVE;
}
