/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline cleanup of a recorded take: resample onto a uniform grid, fill short dropouts, then smooth with a
 * zero-phase pass. Pure and non-destructive: the input frames are never touched. Spec:
 * docs/superpowers/specs/2026-10-02-take-cleanup-and-orbit-design.md.
 */
import { FrameData } from '../../types';
import { FACE_ONE_EURO_DEFAULTS, faceSmoothingToMinCutoff } from './oneEuro';
import { trackHands } from './handTracks';
import { Channel, fillGaps, makeChannel, medianDt, smoothZeroPhase } from './series';

export const DEFAULT_MAX_GAP_MS = 300;
/** 100 s at 60 fps. At 6000 slots a 478-point face is a ~69 MB channel plus ~2.9M output point objects (roughly 100-150 MB
 * together, beside the raw take). Beyond this the cleaned copy is too heavy for a phone tab: the take is returned unchanged. */
export const MAX_GRID_SLOTS = 6000;

const HAND_POINTS = 21;
/** A wrist moving this far (normalized units) in one sample is a re-detection, not motion: never smooth across it. */
const HAND_JUMP = 0.2;
/** A dropout is only reported when the source frames either side of it are more than this many grid intervals apart in
 * SOURCE time. Smaller holes are resampling artefacts (the median interval differs a little from the true mean and
 * timestamps are quantized to 1 ms, so source frames drift against the grid and leave one-slot holes), not lost data.
 * Calibrated on a real 768-frame, 13 s take with no missing face frames: its ordinary source intervals reach 27.4 ms =
 * 1.64 x the 16.7 ms median, so 1.5 reported 3 gaps there (one real 117 ms stall, two jitter); 1.75 reports only the stall.
 * One lost 60 fps frame leaves an interval of ~2 x dt, still well above 1.75. */
const GAP_BRACKET_DT = 1.75;

export interface CleanOptions {
  strength: number; // 0 = no smoothing pass, 0..1 otherwise
  maxGapMs?: number;
}

export interface CleanReport {
  gapsFilled: number;
  gapsLeft: number;
  filledMs: number;
  skipped?: boolean;
}

export interface CleanResult {
  frames: FrameData[];
  report: CleanReport;
}

const passThrough = (frames: FrameData[], skipped = false): CleanResult => ({
  frames,
  report: { gapsFilled: 0, gapsLeft: 0, filledMs: 0, ...(skipped ? { skipped: true } : {}) },
});

type Pt = { x: number; y: number; z?: number };

const writePoints = (dst: Float64Array, off: number, pts: Pt[], count: number) => {
  for (let i = 0; i < count; i++) {
    dst[off + i * 3] = pts[i].x;
    dst[off + i * 3 + 1] = pts[i].y;
    dst[off + i * 3 + 2] = pts[i].z ?? 0;
  }
};

const readPoints = (src: Float64Array, off: number, count: number): Pt[] => {
  const out: Pt[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = { x: src[off + i * 3], y: src[off + i * 3 + 1], z: src[off + i * 3 + 2] };
  return out;
};

export function cleanTake(frames: FrameData[], opts: CleanOptions): CleanResult {
  if (frames.length < 2) return passThrough(frames);
  const t0 = frames[0].timestamp;
  const dt = medianDt(frames.map((f) => f.timestamp));
  if (!(dt > 0)) return passThrough(frames);
  const K = Math.floor((frames[frames.length - 1].timestamp - t0) / dt + 1e-6) + 1;
  if (K > MAX_GRID_SLOTS) return passThrough(frames, true);
  if (K < 2) return passThrough(frames);

  // grid slot -> source frame (later frames win a shared slot)
  const src = new Int32Array(K).fill(-1);
  // Gap reporting works in SOURCE time. Per slot: the earliest and latest source timestamp that landed there (NaN where
  // none did). A slot can hold more than one source frame (the later one supplies the data); a dropout is measured from
  // the latest frame in the slot before it to the earliest in the slot after it, so a frame that lost its slot to a
  // neighbour still counts as data being present, not as a hole.
  const srcTFirst = new Float64Array(K).fill(NaN);
  const srcTLast = new Float64Array(K).fill(NaN);
  frames.forEach((f, j) => {
    const g = Math.min(K - 1, Math.max(0, Math.round((f.timestamp - t0) / dt)));
    src[g] = j;
    srcTFirst[g] = Number.isNaN(srcTFirst[g]) ? f.timestamp : Math.min(srcTFirst[g], f.timestamp);
    srcTLast[g] = Number.isNaN(srcTLast[g]) ? f.timestamp : Math.max(srcTLast[g], f.timestamp);
  });

  const faceLen = frames.reduce((n, f) => n || (Array.isArray(f.faceLandmarks) ? f.faceLandmarks.length : 0), 0);
  const keySet = new Set<string>();
  for (const f of frames) if (f.blendshapes) for (const k of Object.keys(f.blendshapes)) keySet.add(k);
  const keys = [...keySet].sort();

  const slots = trackHands(frames);
  const face = faceLen > 0 ? makeChannel(K, faceLen * 3) : null;
  const blend = keys.length > 0 ? makeChannel(K, keys.length) : null;
  const hands = [makeChannel(K, HAND_POINTS * 3), makeChannel(K, HAND_POINTS * 3)];

  for (let g = 0; g < K; g++) {
    const j = src[g];
    if (j < 0) continue;
    const f = frames[j];
    if (face && Array.isArray(f.faceLandmarks) && f.faceLandmarks.length === faceLen) {
      face.present[g] = 1;
      writePoints(face.data, g * face.dim, f.faceLandmarks, faceLen);
    }
    if (blend && f.blendshapes) {
      blend.present[g] = 1;
      keys.forEach((k, d) => {
        blend.data[g * blend.dim + d] = f.blendshapes![k] ?? 0;
      });
    }
    (f.landmarks ?? []).slice(0, 2).forEach((h, i) => {
      const s = slots[j][i];
      if (s < 0) return;
      hands[s].present[g] = 1;
      writePoints(hands[s].data, g * hands[s].dim, h, HAND_POINTS);
    });
  }

  const maxGap = opts.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  // Gap intervals for the report, in source time, from the face and hand channels only (blendshapes stay out, as before).
  const gaps: { a: number; b: number; filled: boolean }[] = [];
  const onGap = (i0: number, i1: number, filled: boolean) => {
    const a = srcTLast[i0];
    const b = srcTFirst[i1];
    if (b - a > GAP_BRACKET_DT * dt) gaps.push({ a, b, filled }); // NaN compares false: never counted
  };
  if (face) fillGaps(face, dt, maxGap, { onGap });
  for (const h of hands) fillGaps(h, dt, maxGap, { onGap });
  if (blend) fillGaps(blend, dt, maxGap, { linear: true, clamp01: true });

  if (opts.strength > 0) {
    const p = { minCutoff: faceSmoothingToMinCutoff(opts.strength), beta: FACE_ONE_EURO_DEFAULTS.beta };
    const jump = (ch: Channel) => (a: number, b: number) =>
      Math.hypot(ch.data[b * ch.dim] - ch.data[a * ch.dim], ch.data[b * ch.dim + 1] - ch.data[a * ch.dim + 1]) > HAND_JUMP;
    if (face) smoothZeroPhase(face, dt, p);
    for (const h of hands) smoothZeroPhase(h, dt, p, { breakBetween: jump(h) });
    if (blend) smoothZeroPhase(blend, dt, p, { clamp01: true });
  }

  const out: FrameData[] = new Array(K);
  for (let g = 0; g < K; g++) {
    const fr: FrameData = { timestamp: t0 + g * dt };
    if (face && face.present[g]) fr.faceLandmarks = readPoints(face.data, g * face.dim, faceLen);
    if (blend && blend.present[g]) {
      const rec: Record<string, number> = {};
      keys.forEach((k, d) => {
        rec[k] = blend.data[g * blend.dim + d];
      });
      fr.blendshapes = rec;
    }
    const hs = hands.filter((h) => h.present[g]).map((h) => readPoints(h.data, g * h.dim, HAND_POINTS));
    if (hs.length > 0) fr.landmarks = hs;
    const j = src[g];
    if (j >= 0) {
      if (frames[j].leftHand !== undefined) fr.leftHand = frames[j].leftHand;
      if (frames[j].rightHand !== undefined) fr.rightHand = frames[j].rightHand;
    }
    out[g] = fr;
  }

  return { frames: out, report: summarizeGaps(gaps, dt) };
}

/**
 * Counts dropout EVENTS on the time axis. Gap intervals from all channels are merged into unions, so one total
 * dropout is one event however many channels it hit. An event counts as filled only if every channel gap inside it was
 * filled, otherwise as left. `filledMs` is the missing time inside the filled events: the span between the bracketing
 * source frames minus one frame interval, i.e. the same quantity as filled samples x dt on a clean timeline.
 */
function summarizeGaps(gaps: { a: number; b: number; filled: boolean }[], dt: number): CleanReport {
  gaps.sort((x, y) => x.a - y.a);
  const events: { a: number; b: number; filled: boolean }[] = [];
  for (const g of gaps) {
    const last = events[events.length - 1];
    if (last && g.a <= last.b) {
      last.b = Math.max(last.b, g.b);
      last.filled = last.filled && g.filled;
    } else {
      events.push({ ...g });
    }
  }
  const filled = events.filter((e) => e.filled);
  return {
    gapsFilled: filled.length,
    gapsLeft: events.length - filled.length,
    filledMs: Math.round(filled.reduce((s, e) => s + Math.max(0, e.b - e.a - dt), 0)),
  };
}
