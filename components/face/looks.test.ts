import { describe, expect, it } from 'vitest';
import { LOOK, shadeOf } from './looks';

const isColor = (c: number) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

describe('look', () => {
  it('is the shipped neon look, value for value', () => {
    expect(LOOK).toEqual({
      background: 0x050508, skinGray: 0.3, lipGray: 0.22, roughness: 0.4, cavity: 0.8,
      tint: { skin: 0xb8c4ff, lip: 0xff9ad0 },
      ambient: { color: 0x202040, intensity: 0.12 },
      lights: [
        { color: 0x00e5ff, intensity: 7, pos: [-1, 0.15, -0.8] },
        { color: 0xff2bd6, intensity: 7, pos: [1, 0.1, -0.8] },
        { color: 0x6878b0, intensity: 2.2, pos: [0, 0.6, 1] },
      ],
      handColor: 0x9aa0c0,
    });
  });

  it('has in-range values', () => {
    const l = LOOK;
    for (const c of [l.background, l.tint.skin, l.tint.lip, l.ambient.color, l.handColor, ...l.lights.map((x) => x.color)]) expect(isColor(c)).toBe(true);
    for (const g of [l.skinGray, l.lipGray]) { expect(g).toBeGreaterThan(0); expect(g).toBeLessThanOrEqual(1); }
    for (const v of [l.cavity, l.roughness]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(l.ambient.intensity).toBeGreaterThanOrEqual(0);
    expect(l.lights.length).toBeGreaterThan(0);
    for (const x of l.lights) { expect(x.intensity).toBeGreaterThanOrEqual(0); expect(x.intensity).toBeLessThanOrEqual(10); expect(x.pos).toHaveLength(3); }
  });

  it('shadeOf maps gray, tint and cavity into the face shade', () => {
    expect(shadeOf(LOOK)).toEqual({ skinGray: 0.3, lipGray: 0.22, skinTint: 0xb8c4ff, lipTint: 0xff9ad0, cavity: 0.8 });
  });
});
