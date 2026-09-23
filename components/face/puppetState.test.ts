/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Landmark } from '../shared/trackerTypes';
import {
  INITIAL_PUPPET_STATE, stepPuppetState, browLift, boostBrows, BROW_BOOST_MAX,
  BROW_DOWN_SCALE, teethGap, boostJaw, JAW_BOOST_MAX, JAW_REST, JAW_FULL, JAW_GAIN,
  eyeClosure, boostBlink, BLINK_GAIN, LID_MEET,
} from './puppetState';
import { LEFT_EYEBROW, RIGHT_EYEBROW, LEFT_EYE_CONTOUR, LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS } from './faceTopology';

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

  it('smooths the jaw toward jawOpen', () => {
    let s = stepPuppetState(INITIAL_PUPPET_STATE, face(0.04), { jawOpen: 0.5 }, 1);
    expect(s.jaw).toBeGreaterThan(0);
    expect(s.jaw).toBeLessThan(0.5);
    for (let i = 0; i < 20; i++) s = stepPuppetState(s, face(0.04), { jawOpen: 0.5 }, 1);
    expect(s.jaw).toBeCloseTo(0.5, 3);
  });

  it('estimates the jaw from the lip gap when a take has no jawOpen', () => {
    let s = INITIAL_PUPPET_STATE;
    for (let i = 0; i < 20; i++) s = stepPuppetState(s, face(0.06), {}, 1);
    expect(s.jaw).toBeGreaterThan(0.2);
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

describe('brow sides (verified on camera 2026-09-22)', () => {
  it('browOuterUpLeft drives LEFT_EYEBROW, browOuterUpRight drives RIGHT_EYEBROW', () => {
    const l = stepPuppetState(INITIAL_PUPPET_STATE, face(), { browOuterUpLeft: 1 }, 1);
    expect(l.brows[0]).toBeGreaterThan(0);
    expect(l.brows[1]).toBe(0);
    const r = stepPuppetState(INITIAL_PUPPET_STATE, face(), { browOuterUpRight: 1 }, 1);
    expect(r.brows[1]).toBeGreaterThan(0);
    expect(r.brows[0]).toBe(0);
  });
});

describe('teethGap', () => {
  const st = (jaw: number, mouthOpen = true) => ({ ...INITIAL_PUPPET_STATE, mouthOpen, jaw });

  it('is 0 with the lips closed, whatever the jaw', () => {
    expect(teethGap(st(0.9, false), 1)).toBe(0);
  });

  it('parts continuously: touching at rest, partial in between, full at JAW_FULL', () => {
    expect(teethGap(st(JAW_REST), 0)).toBe(0);
    expect(teethGap(st((JAW_REST + JAW_FULL) / 2), 0)).toBeCloseTo(0.5);
    expect(teethGap(st(JAW_FULL), 0)).toBe(1);
  });

  it('Jaw Boost parts the teeth for a speech-sized jaw', () => {
    expect(teethGap(st(0.1), 0)).toBeLessThan(0.3);
    expect(teethGap(st(0.1), 0.5)).toBeGreaterThan(0.5);
    expect(teethGap(st(0.1), 1)).toBeCloseTo(Math.min(1, (0.1 * (1 + JAW_GAIN) - JAW_REST) / (JAW_FULL - JAW_REST)));
  });
});

describe('boostJaw', () => {
  const st = (jaw: number, mouthOpen = true) => ({ ...INITIAL_PUPPET_STATE, mouthOpen, jaw });

  it('drops the lower lip down the face, never mutating, corners fixed', () => {
    const lm = face(0.04);
    const before = JSON.stringify(lm);
    const out = boostJaw(lm, st(1), 1, 1);
    expect(JSON.stringify(lm)).toBe(before);
    expect(out[14].y).toBeCloseTo(0.64 + 0.6 * JAW_BOOST_MAX); // face height 0.6
    expect(out[61]).toBe(lm[61]);
    expect(out[13]).toBe(lm[13]);
  });

  it('does nothing with the lips closed or the slider at 0', () => {
    const lm = face();
    expect(boostJaw(lm, st(1, false), 1, 1)).toBe(lm);
    expect(boostJaw(lm, st(1), 0, 1)).toBe(lm);
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
    expect(out[RIGHT_EYEBROW[0]].y).toBeCloseTo(0.5 + d * BROW_DOWN_SCALE);
    for (const i of LEFT_EYE_CONTOUR) expect(out[i]).toBe(lm[i]);
  });

  it('moves brows down less than up, so a frown never crosses the eye', () => {
    const lm = face();
    const up = 0.5 - boostBrows(lm, [1, 1], 1, 1)[LEFT_EYEBROW[0]].y;
    const down = boostBrows(lm, [-1, -1], 1, 1)[LEFT_EYEBROW[0]].y - 0.5;
    expect(down).toBeLessThan(up);
    expect(down / 0.6).toBeLessThan(0.07); // under the canonical brow-to-lid gap
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

describe('blink', () => {
  const blinkBs = (l: number, r: number) => ({ eyeBlinkLeft: l, eyeBlinkRight: r });
  const settle = (bs: Record<string, number>, boost = 0.5) => {
    let s = INITIAL_PUPPET_STATE;
    for (let i = 0; i < 30; i++) s = stepPuppetState(s, face(), bs, 1, boost);
    return s;
  };

  it('maps eyeBlinkLeft to the LEFT_EYE_CONTOUR eye (same verified sides as the brows)', () => {
    const s = settle(blinkBs(1, 0));
    expect(s.blinks[0]).toBeCloseTo(1, 2);
    expect(s.blinks[1]).toBeCloseTo(0, 2);
  });

  it('boosts closure and snaps a real blink fully shut', () => {
    const s = settle(blinkBs(0.6, 0.6)); // 0.6 * (1 + 0.5 * BLINK_GAIN) = 0.9 > snap
    expect(s.lidsShut).toEqual([true, true]);
    expect(eyeClosure(s, 0, 0.5)).toBe(1);
  });

  it('leaves a squint partial', () => {
    const s = settle(blinkBs(0.3, 0.3));
    expect(s.lidsShut).toEqual([false, false]);
    expect(eyeClosure(s, 0, 0.5)).toBeCloseTo(0.3 * (1 + 0.5 * BLINK_GAIN), 2);
  });

  it('holds shut until closure drops below the release threshold', () => {
    let s = settle(blinkBs(0.6, 0.6));
    for (let i = 0; i < 30; i++) s = stepPuppetState(s, face(), blinkBs(0.45, 0.45), 1, 0.5); // 0.675: between 0.6 and 0.8
    expect(s.lidsShut[0]).toBe(true);
    for (let i = 0; i < 30; i++) s = stepPuppetState(s, face(), blinkBs(0.2, 0.2), 1, 0.5);
    expect(s.lidsShut[0]).toBe(false);
  });
});

describe('boostBlink', () => {
  const lidFace = (): Landmark[] => {
    const lm = face();
    for (const [u, l] of [...LEFT_EYE_LID_PAIRS, ...RIGHT_EYE_LID_PAIRS]) {
      lm[u] = { x: 0.5, y: 0.40, z: 0 };
      lm[l] = { x: 0.5, y: 0.45, z: 0 };
    }
    return lm;
  };
  const shut = { ...INITIAL_PUPPET_STATE, lidsShut: [true, true] as [boolean, boolean] };

  it('closes both lids to the meeting line when shut, never mutating', () => {
    const lm = lidFace();
    const before = JSON.stringify(lm);
    const out = boostBlink(lm, shut, 0.5);
    expect(JSON.stringify(lm)).toBe(before);
    const [u, l] = LEFT_EYE_LID_PAIRS[3];
    const meet = 0.45 + (0.40 - 0.45) * LID_MEET;
    expect(out[u].y).toBeCloseTo(meet);
    expect(out[l].y).toBeCloseTo(meet);
  });

  it('returns the input untouched with eyes open', () => {
    const lm = lidFace();
    expect(boostBlink(lm, INITIAL_PUPPET_STATE, 0.5)).toBe(lm);
  });
});
