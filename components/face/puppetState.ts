/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-frame Face Puppet state, stepped in ONE place so the stage and the
 * video export always agree: mouth open (lip ratio + hysteresis), a smoothed
 * jaw value (jawOpen blendshape) and a smoothed brow lift per side. Also the
 * brow and jaw boosts: a render-time copy of the landmarks with the brows (and
 * forehead) pushed up the face and the lower lip/chin pushed down it, because
 * raw landmarks barely move on camera.
 */
import { Landmark } from '../shared/trackerTypes';
import { mouthOpenRatio, nextMouthOpen } from './mouthState';
import {
  LEFT_EYEBROW, RIGHT_EYEBROW, LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS,
  LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR,
} from './faceTopology';

export interface PuppetState {
  mouthOpen: boolean;
  /** Smoothed jawOpen, 0..1 (lip-gap estimate for takes without blendshapes). */
  jaw: number;
  /** Smoothed lift, -1 (down) .. 1 (up), for [LEFT_EYEBROW, RIGHT_EYEBROW]. */
  brows: [number, number];
  /** Smoothed raw blink 0..1 for [LEFT_EYE_CONTOUR eye, RIGHT_EYE_CONTOUR eye]. */
  blinks: [number, number];
  /** Snapped shut (hysteresis on the boosted closure). */
  lidsShut: [boolean, boolean];
}

export const INITIAL_PUPPET_STATE: PuppetState = {
  mouthOpen: false, jaw: 0, brows: [0, 0], blinks: [0, 0], lidsShut: [false, false],
};

// Teeth part continuously: boosted jaw at JAW_REST = touching, JAW_FULL = fully apart.
export const JAW_REST = 0.04;
export const JAW_FULL = 0.3;
/** Jaw Boost slider 0..1 multiplies jawOpen by 1 + amount * JAW_GAIN (speech
 * often reads only 0.05-0.2 jawOpen, so unboosted teeth stay stuck together).
 * Rescaled 2026-09-22: Grayson liked the old 100% (gain 3) and wanted ~120% of
 * it, so the default 0.75 now equals old 120% and the top of the slider old 160%. */
export const JAW_GAIN = 4.8;
const BROW_ALPHA = 0.35; // EMA per frame; blendshapes arrive unfiltered
const JAW_ALPHA = 0.6;   // faster: speech moves quickly

/** LEFT_EYEBROW (70..46) sits over the 33..133 eye, the subject's right, but
 * MediaPipe's brow blendshapes name sides by image position, not the subject:
 * verified on a real face 2026-09-22 (raising one brow lifted the other puppet
 * brow until this was flipped). Applies to brows AND blinks (eyeBlinkLeft/Right). */
export const BLENDSHAPE_SIDES_SWAPPED = true;

type Blend = Record<string, number> | undefined;

export function browLift(bs: Blend, side: 'Left' | 'Right'): number {
  if (!bs) return 0;
  const g = (k: string) => bs[k] ?? 0;
  const up = 0.5 * g('browInnerUp') + 0.5 * g(`browOuterUp${side}`);
  return Math.max(-1, Math.min(1, up - g(`browDown${side}`)));
}

export const BLINK_GAIN = 1;
export const BLINK_SNAP_CLOSE = 0.8;
export const BLINK_SNAP_OPEN = 0.6;
/** Closed lids meet this share of the way up from the lower lid. */
export const LID_MEET = 0.2;
const BLINK_ALPHA = 0.7; // light: quick blinks must survive

/** Lid aperture fallback for takes without blendshapes: 0 open .. 1 shut. */
function apertureBlink(lm: Landmark[], contour: readonly number[]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of contour) {
    minX = Math.min(minX, lm[i].x); maxX = Math.max(maxX, lm[i].x);
    minY = Math.min(minY, lm[i].y); maxY = Math.max(maxY, lm[i].y);
  }
  const ratio = (maxY - minY) / Math.max(maxX - minX, 1e-6);
  return Math.max(0, Math.min(1, (0.28 - ratio) / 0.2));
}

const boostedBlink = (raw: number, blinkBoost: number) => Math.min(1, raw * (1 + blinkBoost * BLINK_GAIN));

export function eyeClosure(state: PuppetState, side: 0 | 1, blinkBoost: number): number {
  return state.lidsShut[side] ? 1 : boostedBlink(state.blinks[side], blinkBoost);
}

export function stepPuppetState(
  prev: PuppetState,
  lm: Landmark[] | null | undefined,
  bs: Blend,
  videoAspect: number,
  blinkBoost = 0.5
): PuppetState {
  if (!lm) return prev;
  const ratio = mouthOpenRatio(lm, videoAspect);
  const mouthOpen = nextMouthOpen(prev.mouthOpen, ratio);
  // No blendshapes (old takes): estimate the jaw from the lip gap.
  const jaw = bs?.jawOpen ?? Math.max(0, Math.min(1, (ratio - 0.05) * 1.5));
  const [a, b] = BLENDSHAPE_SIDES_SWAPPED ? ['Left', 'Right'] as const : ['Right', 'Left'] as const;
  const ema = (p: number, t: number, k = BROW_ALPHA) => p + (t - p) * k;
  const rawBlink = (side: 'Left' | 'Right', contour: readonly number[]) =>
    bs && bs[`eyeBlink${side}`] !== undefined ? bs[`eyeBlink${side}`] : apertureBlink(lm, contour);
  const blinks: [number, number] = [
    ema(prev.blinks[0], rawBlink(a, LEFT_EYE_CONTOUR), BLINK_ALPHA),
    ema(prev.blinks[1], rawBlink(b, RIGHT_EYE_CONTOUR), BLINK_ALPHA),
  ];
  const shut = (s: 0 | 1): boolean => {
    const c = boostedBlink(blinks[s], blinkBoost);
    return prev.lidsShut[s] ? c >= BLINK_SNAP_OPEN : c > BLINK_SNAP_CLOSE;
  };
  return {
    mouthOpen,
    jaw: ema(prev.jaw, jaw, JAW_ALPHA),
    brows: [ema(prev.brows[0], browLift(bs, a)), ema(prev.brows[1], browLift(bs, b))],
    blinks,
    lidsShut: [shut(0), shut(1)],
  };
}

/** 0 = teeth touching, 1 = fully apart; 0 whenever the lips are closed. */
export function teethGap(state: PuppetState, jawBoost: number): number {
  if (!state.mouthOpen) return 0;
  const j = state.jaw * (1 + jawBoost * JAW_GAIN);
  return Math.max(0, Math.min(1, (j - JAW_REST) / (JAW_FULL - JAW_REST)));
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

/** Chin-to-forehead axis in height units (x is in width units, like mouthOpenRatio). */
const faceAxis = (lm: Landmark[], videoAspect: number) => {
  if (!lm[CHIN] || !lm[TOP]) return null;
  const ux = (lm[TOP].x - lm[CHIN].x) * videoAspect;
  const uy = lm[TOP].y - lm[CHIN].y;
  return Math.hypot(ux, uy) < 1e-6 ? null : { ux, uy };
};

/** Moves out[i] by `d` face heights along the up axis (negative = down). */
const nudge = (out: Landmark[], lm: Landmark[], i: number, d: number, ax: { ux: number; uy: number }, videoAspect: number) => {
  const p = lm[i];
  if (!p || d === 0) return;
  out[i] = { ...p, x: p.x + (ax.ux * d) / videoAspect, y: p.y + ax.uy * d };
};

/**
 * Copy of `lm` with each brow moved by brows[side] * amount * BROW_BOOST_MAX
 * face heights along the chin-to-forehead axis. Never mutates `lm` (it is the
 * tracker frame / recorder buffer). amount is the 0..1 UI slider.
 */
export function boostBrows(lm: Landmark[], brows: readonly [number, number], amount: number, videoAspect: number): Landmark[] {
  if (amount <= 0 || (brows[0] === 0 && brows[1] === 0)) return lm;
  const ax = faceAxis(lm, videoAspect);
  if (!ax) return lm;
  const out = lm.slice();
  const move = (i: number, lift: number) =>
    nudge(out, lm, i, (lift < 0 ? lift * BROW_DOWN_SCALE : lift) * amount * BROW_BOOST_MAX, ax, videoAspect);
  [LEFT_EYEBROW, RIGHT_EYEBROW].forEach((brow, s) => {
    for (const i of brow) move(i, brows[s]);
    for (const [i, w] of FOREHEAD[s]) move(i, brows[s] * w);
  });
  const mid = (brows[0] + brows[1]) / 2;
  for (const [i, w] of CENTER) move(i, mid * w);
  return out;
}

/** Full jaw at full boost drops the lower lip this share of the face height. */
export const JAW_BOOST_MAX = 0.096; // old 0.06 * 1.6, same rescale as JAW_GAIN

// Lower lip rides fully; chin a little less; jaw sides less again. Mouth corners stay put.
const JAW_POINTS: readonly [number, number][] = [
  ...[95, 88, 178, 87, 14, 317, 402, 318, 324].map((i) => [i, 1] as [number, number]),
  ...[146, 91, 181, 84, 17, 314, 405, 321, 375].map((i) => [i, 1] as [number, number]),
  ...[18, 200, 199, 175, 152, 32, 262, 83, 313].map((i) => [i, 0.85] as [number, number]),
  ...[148, 377, 176, 400, 171, 396, 208, 428].map((i) => [i, 0.6] as [number, number]),
  ...[149, 378, 150, 379, 136, 365].map((i) => [i, 0.3] as [number, number]),
];

/** Copy of `lm` with the lower lip and chin dropped by jaw * amount * JAW_BOOST_MAX
 * face heights. Only while the mouth is open, so a closed mouth never gapes. */
export function boostJaw(lm: Landmark[], state: PuppetState, amount: number, videoAspect: number): Landmark[] {
  if (amount <= 0 || !state.mouthOpen || state.jaw <= 0) return lm;
  const ax = faceAxis(lm, videoAspect);
  if (!ax) return lm;
  const out = lm.slice();
  const d = -Math.min(1, state.jaw) * amount * JAW_BOOST_MAX;
  for (const [i, w] of JAW_POINTS) nudge(out, lm, i, d * w, ax, videoAspect);
  return out;
}

/** Copy of `lm` with each eye's upper and lower lids drawn toward their meeting
 * line by eyeClosure. Returns `lm` itself when both eyes are open. */
export function boostBlink(lm: Landmark[], state: PuppetState, blinkBoost: number): Landmark[] {
  const closure = [eyeClosure(state, 0, blinkBoost), eyeClosure(state, 1, blinkBoost)];
  if (closure[0] <= 0 && closure[1] <= 0) return lm;
  const out = lm.slice();
  [LEFT_EYE_LID_PAIRS, RIGHT_EYE_LID_PAIRS].forEach((pairs, s) => {
    const k = closure[s];
    if (k <= 0) return;
    for (const [u, l] of pairs) {
      const U = lm[u], L = lm[l];
      if (!U || !L) continue;
      const mx = L.x + (U.x - L.x) * LID_MEET, my = L.y + (U.y - L.y) * LID_MEET, mz = L.z + (U.z - L.z) * LID_MEET;
      out[u] = { ...U, x: U.x + (mx - U.x) * k, y: U.y + (my - U.y) * k, z: U.z + (mz - U.z) * k };
      out[l] = { ...L, x: L.x + (mx - L.x) * k, y: L.y + (my - L.y) * k, z: L.z + (mz - L.z) * k };
    }
  });
  return out;
}
