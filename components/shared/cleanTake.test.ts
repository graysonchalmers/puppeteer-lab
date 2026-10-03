/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FrameData } from '../../types';
import { cleanTake, MAX_GRID_SLOTS, DEFAULT_MAX_GAP_MS } from './cleanTake';

const DT = 20;
const face = (x: number) => [
  { x, y: 0.5, z: 0 },
  { x: x + 0.1, y: 0.5, z: 0 },
  { x, y: 0.6, z: 0 },
];
const hand = (wx: number) => Array.from({ length: 21 }, (_, i) => ({ x: wx + i * 0.001, y: 0.5, z: 0 }));
const take = (n: number, make: (i: number) => Partial<FrameData>): FrameData[] =>
  Array.from({ length: n }, (_, i) => ({ timestamp: i * DT, ...make(i) }));
const faceX = (i: number) => 0.2 + 0.001 * i;

describe('cleanTake: gap fill', () => {
  it('fills a 200 ms face dropout and reports it', () => {
    const src = take(60, (i) => ({ landmarks: [hand(0.8)], ...(i >= 20 && i <= 29 ? {} : { faceLandmarks: face(faceX(i)) }) }));
    const { frames, report } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(60);
    for (let i = 20; i <= 29; i++) expect(frames[i].faceLandmarks![0].x).toBeCloseTo(faceX(i), 6);
    expect(report.gapsFilled).toBe(1);
    expect(report.gapsLeft).toBe(0);
    expect(report.filledMs).toBeCloseTo(10 * DT, 6);
  });

  it('fills frames that are missing from the array entirely', () => {
    const full = take(60, (i) => ({ faceLandmarks: face(faceX(i)) }));
    const src = full.filter((_, i) => i < 20 || i > 29);
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(60);
    for (let i = 20; i <= 29; i++) expect(frames[i].faceLandmarks![0].x).toBeCloseTo(faceX(i), 6);
  });

  it('leaves a 400 ms dropout absent and counts it', () => {
    const src = take(60, (i) => ({ landmarks: [hand(0.8)], ...(i >= 20 && i <= 39 ? {} : { faceLandmarks: face(faceX(i)) }) }));
    const { frames, report } = cleanTake(src, { strength: 0 });
    for (let i = 20; i <= 39; i++) expect(frames[i].faceLandmarks).toBeUndefined();
    expect(report.gapsFilled).toBe(0);
    expect(report.gapsLeft).toBe(1);
  });

  it('uses a 300 ms default cap', () => expect(DEFAULT_MAX_GAP_MS).toBe(300));
});

describe('cleanTake: pass-through and safety', () => {
  it('strength 0 on a gap-free take returns the same values and timestamps', () => {
    const src = take(30, (i) => ({ faceLandmarks: face(faceX(i)), landmarks: [hand(0.7), hand(0.2)], blendshapes: { jawOpen: i / 30 } }));
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(30);
    frames.forEach((f, i) => {
      expect(f.timestamp).toBe(src[i].timestamp);
      expect(f.faceLandmarks).toEqual(src[i].faceLandmarks);
      expect(f.landmarks).toEqual(src[i].landmarks);
      expect(f.blendshapes).toEqual(src[i].blendshapes);
    });
  });

  it('does not mutate its input', () => {
    const src = take(40, (i) => ({ faceLandmarks: face(faceX(i)), landmarks: [hand(0.7)] }));
    const before = JSON.stringify(src);
    cleanTake(src, { strength: 0.8 });
    expect(JSON.stringify(src)).toBe(before);
  });

  it('returns degenerate takes unchanged with a zero report and no NaN', () => {
    const zero = { gapsFilled: 0, gapsLeft: 0, filledMs: 0 };
    const empty: FrameData[] = [];
    expect(cleanTake(empty, { strength: 0.5 })).toEqual({ frames: empty, report: zero });
    const one = [{ timestamp: 0, faceLandmarks: face(0.5) }];
    expect(cleanTake(one, { strength: 0.5 }).frames).toBe(one);
    const same = [{ timestamp: 100 }, { timestamp: 100 }, { timestamp: 100 }];
    expect(cleanTake(same, { strength: 0.5 }).frames).toBe(same);
  });

  it('skips a take over the grid cap', () => {
    const src = take(MAX_GRID_SLOTS + 100, () => ({ landmarks: [hand(0.5)] }));
    const r = cleanTake(src, { strength: 0.5 });
    expect(r.frames).toBe(src);
    expect(r.report.skipped).toBe(true);
  });

  it('grid spans the first to the last timestamp', () => {
    const src = take(40, (i) => ({ faceLandmarks: face(faceX(i)) })).map((f) => ({ ...f, timestamp: f.timestamp + 1000 }));
    const { frames } = cleanTake(src, { strength: 0.5 });
    expect(frames[0].timestamp).toBe(1000);
    const lastRaw = src[src.length - 1].timestamp;
    const lastOut = frames[frames.length - 1].timestamp;
    expect(lastOut).toBeLessThanOrEqual(lastRaw);
    expect(lastOut).toBeGreaterThan(lastRaw - DT);
  });

  it('handles hands-only, face-only and key-less frames', () => {
    const handsOnly = cleanTake(take(30, () => ({ landmarks: [hand(0.5)] })), { strength: 0.5 }).frames;
    expect(handsOnly.every((f) => f.faceLandmarks === undefined && f.blendshapes === undefined && f.landmarks!.length === 1)).toBe(true);
    const faceOnly = cleanTake(take(30, (i) => ({ faceLandmarks: face(faceX(i)) })), { strength: 0.5 }).frames;
    expect(faceOnly.every((f) => f.landmarks === undefined && f.faceLandmarks!.length === 3)).toBe(true);
    const bare = cleanTake(take(30, () => ({})), { strength: 0.5 }).frames;
    expect(bare).toHaveLength(30);
    expect(bare.every((f) => Object.keys(f).join() === 'timestamp')).toBe(true);
  });
});

describe('cleanTake: blendshapes', () => {
  it('stay inside 0..1 after fill and smoothing, and keep their keys', () => {
    const src = take(60, (i) => (i >= 25 && i <= 30 ? {} : { blendshapes: { jawOpen: i % 2 === 0 ? 1 : 0, eyeBlinkLeft: i % 3 === 0 ? 1 : 0 } }));
    const { frames } = cleanTake(src, { strength: 0.8 });
    for (const f of frames) {
      if (!f.blendshapes) continue;
      expect(Object.keys(f.blendshapes).sort()).toEqual(['eyeBlinkLeft', 'jawOpen']);
      for (const v of Object.values(f.blendshapes)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(frames[27].blendshapes).toBeDefined();
  });
});

describe('cleanTake: hands', () => {
  it('keeps hand identity and capture order across a one-hand dropout', () => {
    // right hand at 0.8 always; left hand at 0.2 drops out for frames 10..14 (100 ms)
    const src = take(30, (i) => ({ landmarks: i >= 10 && i <= 14 ? [hand(0.8)] : [hand(0.8), hand(0.2)] }));
    const { frames, report } = cleanTake(src, { strength: 0 });
    for (let i = 10; i <= 14; i++) {
      expect(frames[i].landmarks).toHaveLength(2);
      expect(frames[i].landmarks![0][0].x).toBeCloseTo(0.8, 6);
      expect(frames[i].landmarks![1][0].x).toBeCloseTo(0.2, 6);
    }
    expect(report.gapsFilled).toBe(1);
  });

  it('does not smear a hand that jumps across the frame', () => {
    const src = take(20, (i) => ({ landmarks: [hand(i < 10 ? 0.1 : 0.9)] }));
    const { frames } = cleanTake(src, { strength: 0.5 });
    expect(frames[9].landmarks![0][0].x).toBeCloseTo(0.1, 6);
    expect(frames[10].landmarks![0][0].x).toBeCloseTo(0.9, 6);
  });

  it('passes legacy leftHand/rightHand through from the source frame', () => {
    const lh = { x: 1, y: 2, z: 3 };
    const src = take(10, (i) => (i === 4 ? { leftHand: lh as any, landmarks: [hand(0.5)] } : { landmarks: [hand(0.5)] }));
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames[4].leftHand).toBe(lh);
  });
});

describe('cleanTake: smoothing', () => {
  it('reduces jitter on a stationary face when strength is high', () => {
    let s = 7;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s / 2147483648) * 2 - 1;
    };
    // amplitude 0.0005: the speed-adaptive cutoff (beta 40) opens up for larger jitter by design, so a bigger
    // amplitude would be treated as motion and barely smoothed
    const src = take(120, () => ({ faceLandmarks: face(0.5 + 0.0005 * rnd()) }));
    const spread = (fs: FrameData[]) => {
      const xs = fs.map((f) => f.faceLandmarks![0].x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const out = cleanTake(src, { strength: 0.9 }).frames;
    expect(spread(out)).toBeLessThan(0.5 * spread(src));
  });
});

describe('cleanTake: size', () => {
  it('cleans 1200 frames of a 478-point face in a few seconds', () => {
    const big = Array.from({ length: 478 }, (_, k) => ({ x: (k % 50) / 50, y: Math.floor(k / 50) / 10, z: 0 }));
    const src = take(1200, (i) => ({ faceLandmarks: big.map((p) => ({ x: p.x + 0.001 * Math.sin(i / 10), y: p.y, z: p.z })), landmarks: [hand(0.5)] }));
    const t0 = performance.now();
    const r = cleanTake(src, { strength: 0.5 });
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(r.frames).toHaveLength(1200);
  });
});
