/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet looks: the shading, light and material of the head and hands, as pure data (no three.js import).
 * `default` is the pre-looks rendering, value for value. The other four are candidates under design review; the
 * chosen one replaces `default` and the rest are deleted. Colors are 0xRRGGBB; light positions are in the rig's
 * camera-locked frame (+x right, +y up, +z toward the viewer).
 */
import { SKIN_GRAY, LIP_GRAY, FaceShade } from './faceGeometry';

export type LookId = 'default' | 'clay' | 'faceted' | 'toon' | 'neon';

export interface LightSpec { color: number; intensity: number; pos: [number, number, number] }

export interface Look {
  id: LookId;
  background: number;
  /** Base vertex gray for skin and lips (0..1), multiplied by `tint`. */
  skinGray: number;
  lipGray: number;
  /** Crease angle in degrees; null = use the UI slider value. */
  creaseAngle: number | null;
  skin: 'standard' | 'toon';
  /** Number of lighting bands when `skin` is 'toon'. */
  toonBands: number;
  roughness: number;
  /** 0..1 strength of the baked darkening in eye sockets, nostrils and under the lip. */
  cavity: number;
  tint: { skin: number; lip: number };
  ambient: { color: number; intensity: number };
  lights: LightSpec[];
  hemisphere?: { sky: number; ground: number; intensity: number };
  /** Inverted-hull outline; `width` is in scene units (stage pixels). */
  outline?: { color: number; width: number };
  handColor: number;
  /**
   * Shade the face with its outward normals. The mirrored face is drawn back-facing, so three's double-sided shading
   * inverts the stored normals and the face is lit as if every light came from the opposite side (the hands are not).
   * `default` was tuned under that inversion and keeps it (false); the candidates set true so face and hands share
   * the same light directions and specular works.
   */
  trueNormals: boolean;
}

const WHITE = 0xffffff;

export const LOOKS: Record<LookId, Look> = {
  default: {
    id: 'default', background: 0x090a0c, skinGray: SKIN_GRAY, lipGray: LIP_GRAY, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.75, cavity: 0, tint: { skin: WHITE, lip: WHITE },
    ambient: { color: WHITE, intensity: 0.15 },
    lights: [
      { color: WHITE, intensity: 3.2, pos: [-0.8, 0.6, 0.7] },
      { color: WHITE, intensity: 0.7, pos: [0.8, -0.2, 0.8] },
      { color: WHITE, intensity: 2.5, pos: [0.3, 0.8, -1] },
    ],
    handColor: 0xa3a7ad, trueNormals: false,
  },
  // Starting values; tuned on the comparison sheet (scripts/looks-sheet.mjs).
  clay: {
    id: 'clay', background: 0x0d0b0a, skinGray: 0.7, lipGray: 0.52, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.9, cavity: 0.55, tint: { skin: 0xffe3d0, lip: 0xf2c4b4 },
    ambient: { color: 0xfff1e6, intensity: 0.28 },
    lights: [
      { color: 0xfff0e0, intensity: 2.6, pos: [-0.9, 0.7, 0.8] },
      { color: 0xdfe8ff, intensity: 0.6, pos: [0.9, -0.1, 0.7] },
      { color: 0xbcd4ff, intensity: 1.6, pos: [0.4, 0.9, -1] },
    ],
    handColor: 0xc9a791, trueNormals: true,
  },
  faceted: {
    id: 'faceted', background: 0x08090b, skinGray: 0.66, lipGray: 0.48, creaseAngle: 0,
    skin: 'standard', toonBands: 3, roughness: 0.5, cavity: 0, tint: { skin: WHITE, lip: WHITE },
    ambient: { color: WHITE, intensity: 0.05 },
    lights: [
      { color: WHITE, intensity: 4.2, pos: [-0.9, 0.8, 0.5] },
      { color: WHITE, intensity: 1.5, pos: [0.6, 0.4, -1] },
    ],
    hemisphere: { sky: 0xeaf2ff, ground: 0x2a2420, intensity: 0.6 },
    handColor: 0xa9b0ba, trueNormals: true,
  },
  toon: {
    id: 'toon', background: 0x14161b, skinGray: 0.78, lipGray: 0.5, creaseAngle: 60,
    skin: 'toon', toonBands: 3, roughness: 0.8, cavity: 0.2, tint: { skin: 0xffd9c0, lip: 0xe89aa0 },
    ambient: { color: WHITE, intensity: 0.35 },
    lights: [{ color: WHITE, intensity: 2.4, pos: [-0.7, 0.7, 0.8] }],
    outline: { color: 0x050505, width: 3 },
    handColor: 0xe4c3ad, trueNormals: true,
  },
  neon: {
    id: 'neon', background: 0x050508, skinGray: 0.3, lipGray: 0.22, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.4, cavity: 0.8, tint: { skin: 0xb8c4ff, lip: 0xff9ad0 },
    ambient: { color: 0x202040, intensity: 0.12 },
    lights: [
      { color: 0x00e5ff, intensity: 3.6, pos: [-1, 0.4, 0.6] },
      { color: 0xff2bd6, intensity: 3.2, pos: [1, 0.2, 0.5] },
      { color: WHITE, intensity: 1.2, pos: [0, 0.9, -1] },
    ],
    handColor: 0x7a86c8, trueNormals: true,
  },
};

export const DEFAULT_LOOK_ID: LookId = 'default';

/** Own-property lookup so ids like `__proto__` or `constructor` fall back instead of resolving. */
export function lookById(id: string | null | undefined): Look {
  return id != null && Object.hasOwn(LOOKS, id) ? LOOKS[id as LookId] : LOOKS[DEFAULT_LOOK_ID];
}

export function shadeOf(l: Look): FaceShade {
  return { skinGray: l.skinGray, lipGray: l.lipGray, skinTint: l.tint.skin, lipTint: l.tint.lip, cavity: l.cavity };
}
