/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { createTrackerStats, createTickHistory, ema } from './trackerStats';

describe('ema', () => {
  it('takes the first sample as is, then moves a fraction toward each new one', () => {
    expect(ema(0, 20)).toBe(20);
    expect(ema(20, 30, 0.5)).toBe(25);
    expect(ema(25, 25)).toBe(25);
  });
});

describe('createTickHistory', () => {
  it('reads back oldest to newest and keeps only the last `size` ticks', () => {
    const h = createTickHistory(3);
    expect(h.read()).toEqual([]);
    for (let i = 1; i <= 5; i++) h.push({ ms: i * 10, hands: i % 3, handRan: i % 2 === 0 });
    expect(h.read().map((s) => s.ms)).toEqual([30, 40, 50]);
    expect(h.read().map((s) => s.hands)).toEqual([0, 1, 2]);
    expect(h.read().map((s) => s.handRan)).toEqual([false, true, false]);
  });
  it('a partly filled ring reads only what was pushed', () => {
    const h = createTickHistory(60);
    h.push({ ms: 12, hands: 0, handRan: true });
    h.push({ ms: 34, hands: 2, handRan: false });
    expect(h.read()).toEqual([{ ms: 12, hands: 0, handRan: true }, { ms: 34, hands: 2, handRan: false }]);
  });
});

describe('createTrackerStats', () => {
  it('starts zeroed with no delegate and the cost policy off', () => {
    expect(createTrackerStats()).toEqual({ trackFps: 0, cameraFps: 0, handFps: 0, delegate: null, handMs: 0, faceMs: 0, tickMs: 0, alternating: false, hands: 0, face: false });
  });
});
