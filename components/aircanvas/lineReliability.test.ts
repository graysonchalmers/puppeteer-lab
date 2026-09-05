/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  reliabilityParams,
  densify,
  resampleAndSmooth,
  relaxToward,
  bridgeGap,
  type Pt,
} from './lineReliability';

// Total variation: sum of segment lengths. A jagged line has more than a smooth one.
const totalVariation = (pts: Pt[]): number => {
  let v = 0;
  for (let i = 1; i < pts.length; i++) {
    v += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return v;
};

describe('reliabilityParams', () => {
  it('at 0 collapses to raw passthrough (no grace, no smoothing, no densify, instant display)', () => {
    const p = reliabilityParams(0);
    expect(p.graceMs).toBe(0);
    expect(p.smoothingStrength).toBe(0);
    expect(p.densifySpacing).toBe(Infinity);
    expect(p.relaxAlpha).toBe(1);
  });

  it('increases grace and smoothing as the slider rises', () => {
    const lo = reliabilityParams(0.25);
    const hi = reliabilityParams(1);
    expect(hi.graceMs).toBeGreaterThan(lo.graceMs);
    expect(hi.smoothingStrength).toBeGreaterThan(lo.smoothingStrength);
    // A slower relax (smaller alpha) at higher settings = more visible settling.
    expect(hi.relaxAlpha).toBeLessThan(lo.relaxAlpha);
  });
});

describe('densify', () => {
  it('inserts interpolated points so no segment exceeds the spacing', () => {
    const raw: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const out = densify(raw, 20);
    expect(out.length).toBeGreaterThan(2);
    for (let i = 1; i < out.length; i++) {
      const seg = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
      expect(seg).toBeLessThanOrEqual(20 + 1e-6);
    }
    // Endpoints preserved.
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('is a no-op when spacing is Infinity', () => {
    const raw: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(densify(raw, Infinity)).toEqual(raw);
  });
});

describe('resampleAndSmooth', () => {
  it('reduces jitter while preserving endpoints', () => {
    const zig: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: -20 },
      { x: 30, y: 20 },
      { x: 40, y: -20 },
      { x: 50, y: 0 },
    ];
    const params = reliabilityParams(1);
    const out = resampleAndSmooth(zig, params);
    expect(totalVariation(out)).toBeLessThan(totalVariation(zig));
    expect(out[0]).toEqual(zig[0]);
    expect(out[out.length - 1]).toEqual(zig[zig.length - 1]);
  });

  it('returns the points unchanged at slider 0', () => {
    const line: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 10 },
    ];
    expect(resampleAndSmooth(line, reliabilityParams(0))).toEqual(line);
  });
});

describe('relaxToward', () => {
  it('eases display halfway toward the target at alpha 0.5', () => {
    const display: Pt[] = [{ x: 0, y: 0 }];
    const target: Pt[] = [{ x: 10, y: 20 }];
    const out = relaxToward(display, target, 0.5);
    expect(out[0].x).toBeCloseTo(5);
    expect(out[0].y).toBeCloseTo(10);
  });

  it('snaps to the target when alpha is 1', () => {
    const display: Pt[] = [{ x: 0, y: 0 }];
    const target: Pt[] = [{ x: 7, y: 3 }];
    expect(relaxToward(display, target, 1)).toEqual(target);
  });

  it('returns a copy of the target when lengths differ', () => {
    const display: Pt[] = [{ x: 0, y: 0 }];
    const target: Pt[] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    const out = relaxToward(display, target, 0.2);
    expect(out).toEqual(target);
    expect(out).not.toBe(target); // copy, not the same reference
  });
});

describe('bridgeGap', () => {
  const params = reliabilityParams(1);

  it('returns null for an implausible far jump', () => {
    const last: Pt = { x: 0, y: 0 };
    const vel = { vx: 0.1, vy: 0 }; // px/ms, moving slowly right
    const far: Pt = { x: 5000, y: 5000 };
    expect(bridgeGap(last, vel, far, 100, params)).toBeNull();
  });

  it('bridges a plausible gap with endpoints intact and a bounded point count', () => {
    const last: Pt = { x: 0, y: 0 };
    const vel = { vx: 1, vy: 0 }; // px/ms rightward
    const resume: Pt = { x: 120, y: 10 }; // ~120px away after 100ms is plausible
    const bridge = bridgeGap(last, vel, resume, 100, params);
    expect(bridge).not.toBeNull();
    const b = bridge as Pt[];
    expect(b.length).toBeGreaterThan(0);
    expect(b.length).toBeLessThanOrEqual(params.maxBridgePoints);
    // Last bridge point lands on the resume point.
    expect(b[b.length - 1].x).toBeCloseTo(resume.x);
    expect(b[b.length - 1].y).toBeCloseTo(resume.y);
  });
});
