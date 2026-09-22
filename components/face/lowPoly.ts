/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure low-poly maths for the Face Puppet: camera-to-stage projection
 * (contain-fit, mirrored), flat Lambert shading on one gray ramp, and the
 * sorted, shaded face triangle list. No canvas calls; FaceMeshRenderer draws
 * what this returns.
 */
import { Landmark } from '../shared/trackerTypes';
import { FACE_TRIS, FACE_TRI_IS_LIP } from './faceTopology';

export interface Projection {
  x(lm: Landmark): number;
  y(lm: Landmark): number;
  z(lm: Landmark): number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
}

/** Fit the camera frame (videoAspect = width / height) inside the stage without
 * stretching, centered. X is mirrored so the puppet moves like a mirror. */
export function fitProjection(w: number, h: number, videoAspect: number): Projection {
  let drawW: number;
  let drawH: number;
  if (w / h > videoAspect) {
    drawH = h;
    drawW = h * videoAspect;
  } else {
    drawW = w;
    drawH = w / videoAspect;
  }
  const offsetX = (w - drawW) / 2;
  const offsetY = (h - drawH) / 2;
  return {
    x: (lm) => offsetX + (1 - lm.x) * drawW,
    y: (lm) => offsetY + lm.y * drawH,
    z: (lm) => lm.z * drawW,
    drawW,
    drawH,
    offsetX,
    offsetY,
  };
}

const norm = (x: number, y: number, z: number): [number, number, number] => {
  const m = Math.hypot(x, y, z);
  return [x / m, y / m, z / m];
};

/** Toward the light, in stage space: left, up, toward the camera (-z). */
export const LIGHT_DIR: readonly [number, number, number] = norm(-0.45, -0.55, -0.7);
const AMBIENT = 0.2;

/** Two-sided Lambert: the normal is flipped to face the camera (-z) first, so
 * triangle winding (which the X mirror flips) never matters. */
export function lambert(nx: number, ny: number, nz: number): number {
  const m = Math.hypot(nx, ny, nz);
  if (m < 1e-9) return AMBIENT;
  let [x, y, z] = [nx / m, ny / m, nz / m];
  if (z > 0) [x, y, z] = [-x, -y, -z];
  const d = x * LIGHT_DIR[0] + y * LIGHT_DIR[1] + z * LIGHT_DIR[2];
  return AMBIENT + (1 - AMBIENT) * Math.max(0, d);
}

const RAMP_DARK = [0x2a, 0x2d, 0x33];
const RAMP_LIGHT = [0xd9, 0xdc, 0xe1];

export function shadeColor(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const c = RAMP_DARK.map((d, i) => Math.round(d + (RAMP_LIGHT[i] - d) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export const LIP_DARKEN = 0.15;

export interface ShadedTri {
  ax: number; ay: number;
  bx: number; by: number;
  cx: number; cy: number;
  depth: number;  // average z in stage units; larger = farther
  color: string;
}

type P3 = [number, number, number];

export function triIntensity(a: P3, b: P3, c: P3): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return lambert(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
}

export function buildFaceTriangles(lm: Landmark[], proj: Projection): ShadedTri[] {
  const pt = (i: number): P3 => [proj.x(lm[i]), proj.y(lm[i]), proj.z(lm[i])];
  const out: ShadedTri[] = [];
  for (let k = 0, t = 0; k < FACE_TRIS.length; k += 3, t++) {
    const a = pt(FACE_TRIS[k]);
    const b = pt(FACE_TRIS[k + 1]);
    const c = pt(FACE_TRIS[k + 2]);
    const intensity = triIntensity(a, b, c) - (FACE_TRI_IS_LIP[t] ? LIP_DARKEN : 0);
    out.push({
      ax: a[0], ay: a[1], bx: b[0], by: b[1], cx: c[0], cy: c[1],
      depth: (a[2] + b[2] + c[2]) / 3,
      color: shadeColor(intensity),
    });
  }
  return out.sort((p, q) => q.depth - p.depth);
}
