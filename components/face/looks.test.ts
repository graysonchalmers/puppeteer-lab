import { describe, expect, it } from 'vitest';
import { LOOKS, DEFAULT_LOOK_ID, lookById, LookId } from './looks';
import { SKIN_GRAY, LIP_GRAY } from './faceGeometry';

const IDS = Object.keys(LOOKS) as LookId[];
const isColor = (c: number) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

describe('looks', () => {
  it('has the default look plus the four candidates, keyed by their own id', () => {
    expect(IDS.sort()).toEqual(['clay', 'default', 'faceted', 'neon', 'toon']);
    for (const id of IDS) expect(LOOKS[id].id).toBe(id);
    expect(DEFAULT_LOOK_ID).toBe('default');
  });

  it('the default look equals the pre-looks constants exactly', () => {
    const d = LOOKS.default;
    expect(d.background).toBe(0x090a0c);
    expect(d.skinGray).toBe(SKIN_GRAY);
    expect(d.lipGray).toBe(LIP_GRAY);
    expect(d.creaseAngle).toBeNull();
    expect(d.skin).toBe('standard');
    expect(d.roughness).toBe(0.75);
    expect(d.cavity).toBe(0);
    expect(d.tint).toEqual({ skin: 0xffffff, lip: 0xffffff });
    expect(d.ambient).toEqual({ color: 0xffffff, intensity: 0.15 });
    expect(d.lights).toEqual([
      { color: 0xffffff, intensity: 3.2, pos: [-0.8, 0.6, 0.7] },
      { color: 0xffffff, intensity: 0.7, pos: [0.8, -0.2, 0.8] },
      { color: 0xffffff, intensity: 2.5, pos: [0.3, 0.8, -1] },
    ]);
    expect(d.hemisphere).toBeUndefined();
    expect(d.outline).toBeUndefined();
    expect(d.handColor).toBe(0xa3a7ad);
  });

  it('every look has in-range values', () => {
    for (const id of IDS) {
      const l = LOOKS[id];
      for (const c of [l.background, l.tint.skin, l.tint.lip, l.ambient.color, l.handColor, ...l.lights.map((x) => x.color)]) expect(isColor(c)).toBe(true);
      for (const g of [l.skinGray, l.lipGray]) { expect(g).toBeGreaterThan(0); expect(g).toBeLessThanOrEqual(1); }
      expect(l.cavity).toBeGreaterThanOrEqual(0);
      expect(l.cavity).toBeLessThanOrEqual(1);
      expect(l.roughness).toBeGreaterThanOrEqual(0);
      expect(l.roughness).toBeLessThanOrEqual(1);
      expect(l.ambient.intensity).toBeGreaterThanOrEqual(0);
      expect(l.lights.length).toBeGreaterThan(0);
      for (const x of l.lights) { expect(x.intensity).toBeGreaterThanOrEqual(0); expect(x.intensity).toBeLessThanOrEqual(10); expect(x.pos).toHaveLength(3); }
      if (l.creaseAngle !== null) { expect(l.creaseAngle).toBeGreaterThanOrEqual(0); expect(l.creaseAngle).toBeLessThanOrEqual(90); }
      if (l.skin === 'toon') expect(l.toonBands).toBeGreaterThanOrEqual(2);
      if (l.outline) { expect(isColor(l.outline.color)).toBe(true); expect(l.outline.width).toBeGreaterThan(0); }
    }
  });

  it('lookById resolves known ids and falls back to default for anything else', () => {
    expect(lookById('clay')).toBe(LOOKS.clay);
    for (const bad of [null, undefined, '', 'CLAY', 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(lookById(bad)).toBe(LOOKS.default);
    }
  });
});
