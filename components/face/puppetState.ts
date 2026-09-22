/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-frame Face Puppet state, stepped in ONE place so the stage and the
 * video export always agree: mouth open (lip ratio + hysteresis), teeth apart
 * (jawOpen blendshape + hysteresis), and a smoothed brow lift per side. Also
 * the brow boost: a render-time copy of the landmarks with the brows (and the
 * forehead above them) pushed along the face's up axis, because raw brow
 * landmarks barely move on camera.
 */
import { Landmark } from '../shared/trackerTypes';
import { mouthOpenRatio, nextMouthOpen } from './mouthState';
import { LEFT_EYEBROW, RIGHT_EYEBROW } from './faceTopology';

export interface PuppetState {
  mouthOpen: boolean;
  teethApart: boolean;
  /** Smoothed lift, -1 (down) .. 1 (up), for [LEFT_EYEBROW, RIGHT_EYEBROW]. */
  brows: [number, number];
}

export const INITIAL_PUPPET_STATE: PuppetState = { mouthOpen: false, teethApart: false, brows: [0, 0] };

export const TEETH_APART_ABOVE = 0.25;   // jawOpen
export const TEETH_TOGETHER_BELOW = 0.15;
// No blendshapes (old takes): fall back to a wider lip gap.
export const TEETH_APART_RATIO_ABOVE = 0.2;
export const TEETH_TOGETHER_RATIO_BELOW = 0.14;
const BROW_ALPHA = 0.35; // EMA per frame; blendshapes arrive unfiltered

/** LEFT_EYEBROW (70..46) sits over the 33..133 eye, the subject's right, and
 * ARKit-style blendshape names are subject-relative. Flip this if raising one
 * brow on camera lifts the other puppet brow. UNVERIFIED on a real face. */
export const BROW_SIDES_SWAPPED = false;

type Blend = Record<string, number> | undefined;

export function browLift(bs: Blend, side: 'Left' | 'Right'): number {
  if (!bs) return 0;
  const g = (k: string) => bs[k] ?? 0;
  const up = 0.5 * g('browInnerUp') + 0.5 * g(`browOuterUp${side}`);
  return Math.max(-1, Math.min(1, up - g(`browDown${side}`)));
}

export function stepPuppetState(
  prev: PuppetState,
  lm: Landmark[] | null | undefined,
  bs: Blend,
  videoAspect: number
): PuppetState {
  if (!lm) return prev;
  const ratio = mouthOpenRatio(lm, videoAspect);
  const mouthOpen = nextMouthOpen(prev.mouthOpen, ratio);
  const jaw = bs?.jawOpen;
  const apart = jaw !== undefined
    ? (prev.teethApart ? jaw >= TEETH_TOGETHER_BELOW : jaw > TEETH_APART_ABOVE)
    : (prev.teethApart ? ratio >= TEETH_TOGETHER_RATIO_BELOW : ratio > TEETH_APART_RATIO_ABOVE);
  const [a, b] = BROW_SIDES_SWAPPED ? ['Left', 'Right'] as const : ['Right', 'Left'] as const;
  const ema = (p: number, t: number) => p + (t - p) * BROW_ALPHA;
  return {
    mouthOpen,
    teethApart: mouthOpen && apart,
    brows: [ema(prev.brows[0], browLift(bs, a)), ema(prev.brows[1], browLift(bs, b))],
  };
}

// Forehead points pulled along with each brow, with weights; eye contours stay put.
const FOREHEAD: readonly [number, number][][] = [
  [[69, 0.5], [104, 0.5], [71, 0.4], [108, 0.3]],
  [[299, 0.5], [333, 0.5], [301, 0.4], [337, 0.3]],
];
const CENTER: readonly [number, number][] = [[9, 0.5], [151, 0.25]];
const CHIN = 152;
const TOP = 10;

/** Full lift at amount 1 moves a brow this share of the face height. */
export const BROW_BOOST_MAX = 0.12;
/** Downward travel is scaled by this: the canonical brow-to-lid gap is only
 * 0.07-0.09 face heights, so a full frown at full boost would cross the eye. */
export const BROW_DOWN_SCALE = 0.4;

/**
 * Copy of `lm` with each brow moved by brows[side] * amount * BROW_BOOST_MAX
 * face heights along the chin-to-forehead axis. Never mutates `lm` (it is the
 * tracker frame / recorder buffer). amount is the 0..1 UI slider.
 */
export function boostBrows(lm: Landmark[], brows: readonly [number, number], amount: number, videoAspect: number): Landmark[] {
  if (amount <= 0 || (brows[0] === 0 && brows[1] === 0) || !lm[CHIN] || !lm[TOP]) return lm;
  // Measure in height units (x is in width units), like mouthOpenRatio.
  const ux = (lm[TOP].x - lm[CHIN].x) * videoAspect;
  const uy = lm[TOP].y - lm[CHIN].y;
  const faceH = Math.hypot(ux, uy);
  if (faceH < 1e-6) return lm;
  const out = lm.slice();
  const move = (i: number, lift: number) => {
    const p = lm[i];
    if (!p) return;
    const d = (lift < 0 ? lift * BROW_DOWN_SCALE : lift) * amount * BROW_BOOST_MAX; // share of face height
    out[i] = { ...p, x: p.x + (ux * d) / videoAspect, y: p.y + uy * d };
  };
  [LEFT_EYEBROW, RIGHT_EYEBROW].forEach((brow, s) => {
    for (const i of brow) move(i, brows[s]);
    for (const [i, w] of FOREHEAD[s]) move(i, brows[s] * w);
  });
  const mid = (brows[0] + brows[1]) / 2;
  for (const [i, w] of CENTER) move(i, mid * w);
  return out;
}
