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
  it('cleans 400 frames of a 478-point face in a few seconds', () => {
    // Kept deliberately light: a heavier run in a parallel worker contends with the 100 ms timing gate in
    // recordingSchema.test.ts and made it fail intermittently (it passed alone). 4000 ms is a generous bound.
    const big = Array.from({ length: 478 }, (_, k) => ({ x: (k % 50) / 50, y: Math.floor(k / 50) / 10, z: 0 }));
    const src = take(400, (i) => ({ faceLandmarks: big.map((p) => ({ x: p.x + 0.001 * Math.sin(i / 10), y: p.y, z: p.z })), landmarks: [hand(0.5)] }));
    const t0 = performance.now();
    const r = cleanTake(src, { strength: 0.5 });
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(r.frames).toHaveLength(400);
  });
});

describe('cleanTake: resampling', () => {
  // Source frame i carries x = faceX(i), so the value in an output slot says which source frame landed there.
  const withTimestamps = (ts: number[]): FrameData[] => ts.map((t, i) => ({ timestamp: t, faceLandmarks: face(faceX(i)) }));

  it('puts jittered timestamps in the nearest slot (round, not floor)', () => {
    // frames 1, 4, 7, 10 sit 1 ms early or late; the median interval is still 20 ms
    const jitter: Record<number, number> = { 1: -1, 4: 1, 7: -1, 10: 1 };
    const src = withTimestamps(Array.from({ length: 40 }, (_, i) => i * DT + (jitter[i] ?? 0)));
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(40);
    // floor() would send frame 1 (19 ms) to slot 0 and leave slot 1 to be interpolated
    for (let i = 0; i < 40; i++) expect(frames[i].faceLandmarks![0].x).toBeCloseTo(faceX(i), 6);
  });

  it('lets the later of two frames in one slot win and drops the earlier one', () => {
    const ts = Array.from({ length: 40 }, (_, i) => i * DT);
    ts.splice(16, 0, 15 * DT + 1); // extra frame at 301 ms, rounds to slot 15 like the frame at 300 ms
    const src = withTimestamps(ts);
    src[16] = { timestamp: ts[16], faceLandmarks: face(0.9) };
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(40);
    expect(frames[15].faceLandmarks![0].x).toBeCloseTo(0.9, 9);
    expect(frames[15].faceLandmarks![0].x).not.toBeCloseTo(faceX(15), 6);
    expect(frames[14].faceLandmarks![0].x).toBeCloseTo(faceX(14), 6);
  });

  it('keeps the last slot when the span is a hair under a whole number of intervals', () => {
    const ts = Array.from({ length: 60 }, (_, i) => i * DT);
    ts[59] = 59 * DT - 1e-7; // span / dt = 58.9999999995: floor() alone would drop the last slot
    const src = withTimestamps(ts);
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(60);
    expect(frames[59].faceLandmarks![0].x).toBeCloseTo(faceX(59), 6);
  });

  it('clamps a frame whose rounded slot is past the last one', () => {
    // last frame at 58.6 intervals: K = 59 (slots 0..58) but round() gives slot 59
    const ts = [...Array.from({ length: 59 }, (_, i) => i * DT), 58 * DT + 12];
    const src = withTimestamps(ts);
    src[59] = { timestamp: ts[59], faceLandmarks: face(0.95) };
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(59);
    expect(frames[58].timestamp).toBe(58 * DT);
    expect(frames[58].faceLandmarks![0].x).toBeCloseTo(0.95, 9); // the clamped, later frame wins slot 58
  });
});

describe('cleanTake: gap report counts real dropouts, not resampling holes', () => {
  // A real 60 fps clock: intervals are whole milliseconds, so the median interval differs from the true mean and source
  // frames drift against the grid. 16,16,17 ms (median 16, mean 16.33) leaves a one-slot hole every ~48 frames;
  // 17,17,16 ms (median 17, mean 16.67) makes frames share slots instead. Neither is a dropout.
  const clock = (n: number, pattern: number[]): number[] => {
    const ts = [0];
    for (let i = 1; i < n; i++) ts.push(ts[i - 1] + pattern[(i - 1) % pattern.length]);
    return ts;
  };
  const PATTERNS: [string, number[]][] = [
    ['16,16,17 (holes)', [16, 16, 17]],
    ['17,17,16 (collisions)', [17, 17, 16]],
  ];
  const medianInterval = (pattern: number[]) => [...pattern].sort((a, b) => a - b)[pattern.length >> 1];
  const build = (pattern: number[], drop?: { from: number; count: number; keepFrames: boolean }): FrameData[] => {
    const ts = clock(600, pattern);
    const out: FrameData[] = [];
    ts.forEach((t, i) => {
      const dropped = drop && i >= drop.from && i < drop.from + drop.count;
      if (dropped && !drop!.keepFrames) return; // frame missing from the array entirely
      out.push(dropped ? { timestamp: t } : { timestamp: t, faceLandmarks: face(faceX(i)), landmarks: [hand(0.8)] });
    });
    return out;
  };
  const gridSize = (src: FrameData[], pattern: number[]) =>
    Math.floor((src[src.length - 1].timestamp - src[0].timestamp) / medianInterval(pattern) + 1e-6) + 1;

  it.each(PATTERNS)('reports nothing on a clean 1 ms-quantized timeline: %s', (_name, pattern) => {
    const src = build(pattern);
    const { frames, report } = cleanTake(src, { strength: 0 });
    expect(report.gapsFilled).toBe(0);
    expect(report.gapsLeft).toBe(0);
    expect(report.filledMs).toBe(0);
    expect(frames).toHaveLength(gridSize(src, pattern));
  });

  it.each(PATTERNS)('rounding holes are still filled in the output, only not reported: %s', (_name, pattern) => {
    const { frames } = cleanTake(build(pattern), { strength: 0 });
    expect(frames.every((f) => f.faceLandmarks && f.landmarks)).toBe(true);
  });

  it.each([
    ['frames present but empty', true],
    ['frames missing from the array', false],
  ])('one ~100 ms dropout of every channel is one filled event, not one per channel: %s', (_name, keepFrames) => {
    const pattern = [16, 16, 17];
    const src = build(pattern, { from: 300, count: 6, keepFrames });
    const { report } = cleanTake(src, { strength: 0 });
    expect(report.gapsFilled).toBe(1);
    expect(report.gapsLeft).toBe(0);
    // six absent frames at ~16.3 ms: the missing time is ~98 ms
    expect(Math.abs(report.filledMs - 100)).toBeLessThanOrEqual(medianInterval(pattern));
  });

  it('a 400 ms dropout is one event left unfilled', () => {
    const src = build([16, 16, 17], { from: 300, count: 25, keepFrames: true });
    const { frames, report } = cleanTake(src, { strength: 0 });
    expect(report.gapsLeft).toBe(1);
    expect(report.gapsFilled).toBe(0);
    expect(report.filledMs).toBe(0);
    expect(frames[310].faceLandmarks).toBeUndefined();
  });

  it('a filled dropout and a too-long one are two separate events', () => {
    const ts = clock(600, [16, 16, 17]);
    const src: FrameData[] = ts.map((t, i) =>
      (i >= 100 && i < 106) || (i >= 300 && i < 325) ? { timestamp: t } : { timestamp: t, faceLandmarks: face(faceX(i)) },
    );
    const { report } = cleanTake(src, { strength: 0 });
    expect(report.gapsFilled).toBe(1);
    expect(report.gapsLeft).toBe(1);
  });

  it('an event is left unless every overlapping channel gap was filled', () => {
    // face absent 150 ms (fillable), the hand absent over a longer, overlapping 400 ms (not fillable): one event, left
    const ts = clock(600, [16, 16, 17]);
    const src: FrameData[] = ts.map((t, i) => ({
      timestamp: t,
      ...(i >= 300 && i < 309 ? {} : { faceLandmarks: face(faceX(i)) }),
      ...(i >= 298 && i < 323 ? {} : { landmarks: [hand(0.8)] }),
    }));
    const { report } = cleanTake(src, { strength: 0 });
    expect(report.gapsLeft).toBe(1);
    expect(report.gapsFilled).toBe(0);
  });

  it('a single lost frame (interval ~2 x dt) is still reported', () => {
    const src = build([16, 16, 17]).filter((_, i) => i !== 300);
    const { report } = cleanTake(src, { strength: 0 });
    expect(report.gapsFilled).toBe(1);
    expect(report.gapsLeft).toBe(0);
    expect(Math.abs(report.filledMs - 16)).toBeLessThanOrEqual(16);
  });

  it('one frame arriving late (1.6 x dt interval) over a rounding hole is jitter, not a dropout', () => {
    // frame 300 is delayed 10 ms and now shares a slot with frame 301. The hole it leaves is bracketed by frames
    // 299 and 300 (26 ms, 1.6 x dt), not by the surviving frames 299 and 301 (32 ms, 2 x dt).
    const ts = clock(600, [16, 16, 17]);
    ts[300] += 10;
    const src: FrameData[] = ts.map((t, i) => ({ timestamp: t, faceLandmarks: face(faceX(i)), landmarks: [hand(0.8)] }));
    const { report } = cleanTake(src, { strength: 0 });
    expect(report.gapsFilled).toBe(0);
    expect(report.gapsLeft).toBe(0);
  });
});
