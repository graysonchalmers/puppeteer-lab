/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Face Puppet look: the shading, light and material of the head and hands, as pure data (no three.js import).
 * "Neon", picked by Grayson from four candidates on 2026-10-03: dark navy skin, cyan and magenta rim lights from
 * either side behind the head, a faint cool fill, strong baked cavity darkening, near-black background. Colors are
 * 0xRRGGBB; light positions are in the rig's camera-locked frame (+x right, +y up, +z toward the viewer).
 */
import { FaceShade } from './faceGeometry';

export interface LightSpec { color: number; intensity: number; pos: [number, number, number] }

export interface Look {
  background: number;
  /** Base vertex gray for skin and lips (0..1), multiplied by `tint`. */
  skinGray: number;
  lipGray: number;
  roughness: number;
  /** 0..1 strength of the baked darkening in eye sockets, nostrils and under the lip. */
  cavity: number;
  /** Linear multipliers on the vertex gray. */
  tint: { skin: number; lip: number };
  ambient: { color: number; intensity: number };
  lights: LightSpec[];
  /** sRGB of skinGray * tint, so the hands match the face. */
  handColor: number;
}

export const LOOK: Look = {
  background: 0x050508, skinGray: 0.3, lipGray: 0.22, roughness: 0.4, cavity: 0.8,
  tint: { skin: 0xb8c4ff, lip: 0xff9ad0 },
  ambient: { color: 0x202040, intensity: 0.12 },
  lights: [
    { color: 0x00e5ff, intensity: 7, pos: [-1, 0.15, -0.8] },
    { color: 0xff2bd6, intensity: 7, pos: [1, 0.1, -0.8] },
    { color: 0x6878b0, intensity: 2.2, pos: [0, 0.6, 1] },
  ],
  handColor: 0x9aa0c0,
};

export function shadeOf(l: Look): FaceShade {
  return { skinGray: l.skinGray, lipGray: l.lipGray, skinTint: l.tint.skin, lipTint: l.tint.lip, cavity: l.cavity };
}
