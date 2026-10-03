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
  // Candidates, tuned on the comparison sheet (scripts/looks-sheet.mjs). Tints are linear multipliers on the vertex
  // gray; light and hand colors are sRGB hex. handColor is the sRGB of skinGray * tint so hands match the face.
  clay: {
    id: 'clay', background: 0x16120f, skinGray: 0.64, lipGray: 0.5, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.9, cavity: 0.5, tint: { skin: 0xffa47c, lip: 0xe88a72 },
    ambient: { color: 0xfff0e4, intensity: 0.12 },
    lights: [
      { color: 0xfff0e2, intensity: 3.8, pos: [-0.85, 0.6, 0.6] },
      { color: 0xffe6d6, intensity: 0.55, pos: [0.9, -0.1, 0.6] },
      { color: 0xc8dcff, intensity: 2.4, pos: [0.6, 0.6, -0.8] },
    ],
    hemisphere: { sky: 0xfff4ea, ground: 0x4a3226, intensity: 0.35 },
    handColor: 0xd1ac97, trueNormals: true,
  },
  faceted: {
    id: 'faceted', background: 0x07090c, skinGray: 0.72, lipGray: 0.5, creaseAngle: 0,
    skin: 'standard', toonBands: 3, roughness: 0.35, cavity: 0, tint: { skin: 0xdde8ff, lip: 0xd8c8d8 },
    ambient: { color: WHITE, intensity: 0.04 },
    lights: [
      { color: WHITE, intensity: 4.6, pos: [-0.7, 0.75, 0.6] },
      { color: 0xcfe0ff, intensity: 1.0, pos: [0.8, -0.1, 0.5] },
      { color: WHITE, intensity: 2.2, pos: [0.6, 0.5, -0.8] },
    ],
    hemisphere: { sky: 0xeaf2ff, ground: 0x1a1814, intensity: 0.5 },
    handColor: 0xcfd4dd, trueNormals: true,
  },
  toon: {
    id: 'toon', background: 0x2a2e38, skinGray: 0.8, lipGray: 0.55, creaseAngle: 60,
    skin: 'toon', toonBands: 3, roughness: 0.8, cavity: 0.15, tint: { skin: 0xffb890, lip: 0xe07870 },
    ambient: { color: 0x9aa8d0, intensity: 0.55 },
    lights: [{ color: 0xfff4e8, intensity: 3.0, pos: [-0.6, 0.8, 0.7] }],
    outline: { color: 0x14100e, width: 4.5 },
    handColor: 0xe7c8b3, trueNormals: true,
  },
  neon: {
    id: 'neon', background: 0x050508, skinGray: 0.3, lipGray: 0.22, creaseAngle: null,
    skin: 'standard', toonBands: 3, roughness: 0.4, cavity: 0.8, tint: { skin: 0xb8c4ff, lip: 0xff9ad0 },
    ambient: { color: 0x202040, intensity: 0.12 },
    lights: [
      { color: 0x00e5ff, intensity: 7, pos: [-1, 0.15, -0.8] },
      { color: 0xff2bd6, intensity: 7, pos: [1, 0.1, -0.8] },
      { color: 0x6878b0, intensity: 2.2, pos: [0, 0.6, 1] },
    ],
    handColor: 0x9aa0c0, trueNormals: true,
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
