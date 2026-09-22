/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import {
  INITIAL_PUPPET_STATE, stepPuppetState, browLift, boostBrows, BROW_BOOST_MAX,
  TEETH_APART_ABOVE, TEETH_TOGETHER_BELOW,
} from './puppetState';
import { LEFT_EYEBROW, RIGHT_EYEBROW, LEFT_EYE_CONTOUR } from './faceTopology';

/** 478 points; chin 152 at y=0.8, forehead 10 at y=0.2; lip gap `gap` over width 0.2. */
const face = (gap = 0): Landmark[] => {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[152] = { x: 0.5, y: 0.8, z: 0 };
  lm[10] = { x: 0.5, y: 0.2, z: 0 };
  lm[61] = { x: 0.4, y: 0.6, z: 0 };
  lm[291] = { x: 0.6, y: 0.6, z: 0 };
  lm[13] = { x: 0.5, y: 0.6, z: 0 };
  lm[14] = { x: 0.5, y: 0.6 + gap, z: 0 };
  return lm;
};

describe('stepPuppetState', () => {
  it('keeps the previous state when there is no face', () => {
    const prev = { ...INITIAL_PUPPET_STATE, mouthOpen: true };
    expect(stepPuppetState(prev, undefined, {}, 1)).toBe(prev);
  });

  it('lips open with jaw low shows teeth together; jaw high shows them apart', () => {
    const open = face(0.04); // ratio 0.2 at aspect 1
    const together = stepPuppetState(INITIAL_PUPPET_STATE, open, { jawOpen: 0.05 }, 1);
    expect(together.mouthOpen).toBe(true);
    expect(together.teethApart).toBe(false);
    const apart = stepPuppetState(together, open, { jawOpen: TEETH_APART_ABOVE + 0.1 }, 1);
    expect(apart.teethApart).toBe(true);
  });

  it('teeth-apart has hysteresis on jawOpen', () => {
    const open = face(0.04);
    const apart = stepPuppetState(INITIAL_PUPPET_STATE, open, { jawOpen: 0.5 }, 1);
    const mid = (TEETH_APART_ABOVE + TEETH_TOGETHER_BELOW) / 2;
    expect(stepPuppetState(apart, open, { jawOpen: mid }, 1).teethApart).toBe(true);
    expect(stepPuppetState(INITIAL_PUPPET_STATE, open, { jawOpen: mid }, 1).teethApart).toBe(false);
  });

  it('never shows teeth apart with the lips closed', () => {
    expect(stepPuppetState(INITIAL_PUPPET_STATE, face(0), { jawOpen: 0.9 }, 1).teethApart).toBe(false);
  });

  it('falls back to the lip gap when a take has no jawOpen', () => {
    expect(stepPuppetState(INITIAL_PUPPET_STATE, face(0.06), {}, 1).teethApart).toBe(true);
    expect(stepPuppetState(INITIAL_PUPPET_STATE, face(0.02), {}, 1).teethApart).toBe(false);
  });

  it('smooths brows toward the blendshape lift', () => {
    const bs = { browInnerUp: 1, browOuterUpLeft: 1, browOuterUpRight: 1 };
    let s = INITIAL_PUPPET_STATE;
    s = stepPuppetState(s, face(), bs, 1);
    expect(s.brows[0]).toBeGreaterThan(0);
    expect(s.brows[0]).toBeLessThan(1);
    for (let i = 0; i < 40; i++) s = stepPuppetState(s, face(), bs, 1);
    expect(s.brows[0]).toBeCloseTo(1, 3);
  });
});

describe('browLift', () => {
  it('is up minus down, clamped', () => {
    expect(browLift({ browDownLeft: 1 }, 'Left')).toBe(-1);
    expect(browLift({ browInnerUp: 1, browOuterUpRight: 1 }, 'Right')).toBe(1);
    expect(browLift(undefined, 'Left')).toBe(0);
  });
});

describe('boostBrows', () => {
  it('never mutates the input landmarks', () => {
    const lm = face();
    const before = JSON.stringify(lm);
    boostBrows(lm, [1, 1], 1, 4 / 3);
    expect(JSON.stringify(lm)).toBe(before);
  });

  it('returns the input untouched when there is nothing to boost', () => {
    const lm = face();
    expect(boostBrows(lm, [0, 0], 1, 1)).toBe(lm);
    expect(boostBrows(lm, [1, 1], 0, 1)).toBe(lm);
  });

  it('lifts brows up the face by lift * amount * max face heights, eyes fixed', () => {
    const lm = face();
    const out = boostBrows(lm, [1, -1], 0.5, 1);
    const d = 0.6 * 0.5 * BROW_BOOST_MAX; // face height 0.6
    expect(out[LEFT_EYEBROW[0]].y).toBeCloseTo(0.5 - d);
    expect(out[RIGHT_EYEBROW[0]].y).toBeCloseTo(0.5 + d);
    for (const i of LEFT_EYE_CONTOUR) expect(out[i]).toBe(lm[i]);
  });

  it('follows the face axis when the head rolls, with x corrected for aspect', () => {
    const lm = face();
    const aspect = 2;
    // Head rolled 90deg: chin to forehead points along +x in height units.
    lm[152] = { x: 0.4, y: 0.5, z: 0 };
    lm[10] = { x: 0.6, y: 0.5, z: 0 }; // 0.2 width units = 0.4 height units
    const out = boostBrows(lm, [1, 1], 1, aspect);
    const i = LEFT_EYEBROW[0];
    expect(out[i].y).toBeCloseTo(0.5);
    expect((out[i].x - 0.5) * aspect).toBeCloseTo(0.4 * BROW_BOOST_MAX);
  });
});
