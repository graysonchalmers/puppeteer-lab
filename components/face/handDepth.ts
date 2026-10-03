/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face/hand depth for the orbit view. Face and hand landmarks come from separate models, so their z has no common
 * origin. In a pinhole camera depth is inversely proportional to apparent size and the focal length cancels in the
 * ratio, so r = Zhand / Zface = (9.5 / handSize) / (14.5 / faceSize). Sizes are 3D lengths (rotation-invariant) of
 * face 234..454 and hand 0..9 in height-units, smoothed per take; the result is a plausible 3D view, not metric
 * (roughly +-20-30 percent).
 */
import { FrameData } from '../../types';
import { trackHands } from '../shared/handTracks';
import { Channel, fillGaps, makeChannel, medianDt, smoothZeroPhase } from '../shared/series';
import { V3 } from './projection';

export const DEFAULT_R = 0.7;
export const R_MIN = 0.25;
export const R_MAX = 1.3;
export const SIZE_RATIO = 9.5 / 14.5;
export const HFOV_DEG = 63;

const FACE_A = 234;
const FACE_B = 454;
const NOSE = 1;
const MIN_SIZE = 1e-6;
const SIZE_SMOOTH = { minCutoff: 0.5, beta: 0 };

/** Focal length in stage pixels for the assumed horizontal FOV. */
export const focalPx = (drawW: number): number => drawW / 2 / Math.tan(((HFOV_DEG / 2) * Math.PI) / 180);

/** Scene points of one hand -> placed at depth ratio r, about the image center (cx, cy), for focal length f. */
export function placeHandPoints(P: V3[], r: number, cx: number, cy: number, f: number): V3[] {
  return P.map(([x, y, z]) => [cx + r * (x - cx), cy + r * (y - cy), f * (1 - r) + r * z] as V3);
}

export interface TakeDepth {
  /** handR[frameIndex][k] is r for frames[frameIndex].landmarks[k]. */
  handR: number[][];
  /** Median nose tip over the take in normalized landmark space, or null when no frame has a face. */
  pivot: { x: number; y: number; z: number } | null;
}

type Pt = { x: number; y: number; z?: number };
const dist3 = (a: Pt, b: Pt, aspect: number) =>
  Math.hypot((a.x - b.x) * aspect, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * aspect);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

function holdEnds(ch: Channel): void {
  const first = ch.present.indexOf(1);
  if (first < 0) return;
  let last = ch.n - 1;
  while (!ch.present[last]) last--;
  for (let i = 0; i < first; i++) { ch.data[i] = ch.data[first]; ch.present[i] = 1; }
  for (let i = last + 1; i < ch.n; i++) { ch.data[i] = ch.data[last]; ch.present[i] = 1; }
}

export function computeHandDepth(frames: FrameData[], aspect: number): TakeDepth {
  const n = frames.length;
  if (n === 0) return { handR: [], pivot: null };
  const dtMs = medianDt(frames.map((f) => f.timestamp)) || 1000 / 60;
  const slots = trackHands(frames);

  const faceSize = makeChannel(n, 1);
  const handSize = [makeChannel(n, 1), makeChannel(n, 1)];
  const nose: Pt[] = [];
  frames.forEach((f, i) => {
    const fl = f.faceLandmarks;
    if (Array.isArray(fl) && fl.length > FACE_B) {
      const s = dist3(fl[FACE_A], fl[FACE_B], aspect);
      if (s > MIN_SIZE) { faceSize.present[i] = 1; faceSize.data[i] = s; }
      nose.push(fl[NOSE]);
    }
    (f.landmarks ?? []).slice(0, 2).forEach((h, k) => {
      const slot = slots[i][k];
      if (slot < 0) return;
      const s = dist3(h[0], h[9], aspect);
      if (s > MIN_SIZE) { handSize[slot].present[i] = 1; handSize[slot].data[i] = s; }
    });
  });

  const haveFace = faceSize.present.indexOf(1) >= 0;
  if (haveFace) {
    fillGaps(faceSize, dtMs, Infinity, { linear: true });
    holdEnds(faceSize);
    smoothZeroPhase(faceSize, dtMs, SIZE_SMOOTH);
  }
  handSize.forEach((ch) => smoothZeroPhase(ch, dtMs, SIZE_SMOOTH));

  const handR = frames.map((_, i) =>
    slots[i].map((slot) => {
      if (slot < 0 || !haveFace || !handSize[slot].present[i]) return DEFAULT_R;
      const r = (SIZE_RATIO * faceSize.data[i]) / handSize[slot].data[i];
      return Number.isFinite(r) ? Math.min(R_MAX, Math.max(R_MIN, r)) : DEFAULT_R;
    }),
  );

  const pivot = nose.length
    ? { x: median(nose.map((p) => p.x)), y: median(nose.map((p) => p.y)), z: median(nose.map((p) => p.z ?? 0)) }
    : null;
  return { handR, pivot };
}
