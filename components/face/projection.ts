/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Camera-to-stage mapping for the Face Puppet (contain-fit, X mirrored) and
 * stage-to-scene conversion for the Three.js renderer: scene units are stage
 * pixels with y flipped up and z flipped toward the camera.
 */
import { Landmark } from '../shared/trackerTypes';

export interface Projection {
  x(lm: Landmark): number;
  y(lm: Landmark): number;
  z(lm: Landmark): number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
}

export type V3 = [number, number, number];

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

/** Stage pixels -> scene units: +Y up, +Z toward the camera. */
export function toScene(lm: Landmark, p: Projection): V3 {
  return [p.x(lm), -p.y(lm), -p.z(lm)];
}
