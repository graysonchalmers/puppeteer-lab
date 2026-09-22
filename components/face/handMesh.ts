/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Low-poly hand for the Face Puppet, same look as the head: a flat-shaded
 * palm fan plus one tapered quad (two triangles) per finger bone, two tones
 * from the bone's angle to the light. Chirality-agnostic (two-sided), so a
 * hand's side label never matters for drawing.
 */
import { Landmark } from '../shared/trackerTypes';
import { Projection, ShadedTri, triIntensity, shadeColor, LIGHT_DIR } from './lowPoly';

export const HAND_PALM_TRIS: readonly [number, number, number][] = [[0, 1, 5], [0, 5, 9], [0, 9, 13], [0, 13, 17]];
export const HAND_FINGERS: readonly number[][] = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
export const FINGER_TAPER: readonly number[] = [1.0, 0.9, 0.82, 0.77];
export const FINGER_HALF_WIDTH_OF_PALM = 0.07;

const LIGHT_2D = (() => {
  const m = Math.hypot(LIGHT_DIR[0], LIGHT_DIR[1]);
  return [LIGHT_DIR[0] / m, LIGHT_DIR[1] / m];
})();

type P3 = [number, number, number];

export function buildHandTriangles(lm: Landmark[], proj: Projection): ShadedTri[] {
  const pt = (i: number): P3 => [proj.x(lm[i]), proj.y(lm[i]), proj.z(lm[i])];
  const tri = (a: P3, b: P3, c: P3, color: string): ShadedTri => ({
    ax: a[0], ay: a[1], bx: b[0], by: b[1], cx: c[0], cy: c[1],
    depth: (a[2] + b[2] + c[2]) / 3,
    color,
  });

  const out: ShadedTri[] = [];
  for (const [i, j, k] of HAND_PALM_TRIS) {
    const a = pt(i), b = pt(j), c = pt(k);
    out.push(tri(a, b, c, shadeColor(triIntensity(a, b, c))));
  }

  const wrist = pt(0);
  const mid = pt(9);
  const halfBase = Math.hypot(mid[0] - wrist[0], mid[1] - wrist[1]) * FINGER_HALF_WIDTH_OF_PALM;

  for (const finger of HAND_FINGERS) {
    for (let s = 0; s < finger.length - 1; s++) {
      const a = pt(finger[s]);
      const b = pt(finger[s + 1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / len;
      const dy = (b[1] - a[1]) / len;
      const px = -dy, py = dx; // perpendicular
      const wa = halfBase * FINGER_TAPER[s];
      const wb = halfBase * FINGER_TAPER[s + 1];
      const aL: P3 = [a[0] + px * wa, a[1] + py * wa, a[2]];
      const aR: P3 = [a[0] - px * wa, a[1] - py * wa, a[2]];
      const bL: P3 = [b[0] + px * wb, b[1] + py * wb, b[2]];
      const bR: P3 = [b[0] - px * wb, b[1] - py * wb, b[2]];
      const color = shadeColor(0.45 + 0.35 * Math.abs(dx * LIGHT_2D[0] + dy * LIGHT_2D[1]));
      out.push(tri(aL, bL, bR, color));
      out.push(tri(aL, bR, aR, color));
    }
  }
  return out;
}
