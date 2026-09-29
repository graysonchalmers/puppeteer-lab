/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Aspect-true picture-in-picture size: the long side is fixed, the short side
 * follows the camera (a phone's portrait frame must not be stretched wide).
 */
export function pipDims(aspect: number, longSide: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return a >= 1 ? { w: longSide, h: Math.round(longSide / a) } : { w: Math.round(longSide * a), h: longSide };
}
