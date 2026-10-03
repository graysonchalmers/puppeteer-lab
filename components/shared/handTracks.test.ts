/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FrameData } from '../../types';
import { trackHands } from './handTracks';

const hand = (wristX: number) =>
  Array.from({ length: 21 }, (_, i) => ({ x: i === 0 ? wristX : wristX + 0.01, y: 0.5, z: 0 }));
const f = (t: number, ...wrists: number[]): FrameData => ({ timestamp: t, landmarks: wrists.map(hand) });

describe('trackHands', () => {
  it('maps two hands to slots 0 and 1 in capture order', () => {
    expect(trackHands([f(0, 0.8, 0.2), f(20, 0.2, 0.8)])).toEqual([[0, 1], [0, 1]]);
  });

  it('puts a lone hand with no history in slot 0', () => {
    expect(trackHands([f(0, 0.4)])).toEqual([[0]]);
  });

  it('gives a lone hand the slot whose last wrist is nearer', () => {
    const frames = [f(0, 0.8, 0.2), f(20, 0.21), f(40, 0.79), f(60, 0.25)];
    expect(trackHands(frames)).toEqual([[0, 1], [1], [0], [1]]);
  });

  it('keeps a lone hand in its slot while it moves slowly', () => {
    const frames = [f(0, 0.8, 0.2), f(20, 0.2), f(40, 0.22), f(60, 0.25), f(80, 0.3)];
    expect(trackHands(frames).slice(1)).toEqual([[1], [1], [1], [1]]);
  });

  it('returns an empty list for frames without hands', () => {
    expect(trackHands([{ timestamp: 0 }, { timestamp: 20, landmarks: [] }])).toEqual([[], []]);
  });

  it('marks an invalid hand -1 and still tracks the valid one', () => {
    const frame: FrameData = { timestamp: 0, landmarks: [[{ x: 0, y: 0, z: 0 }], hand(0.3)] };
    expect(trackHands([frame])).toEqual([[-1, 0]]);
  });

  it('ignores a third hand', () => {
    expect(trackHands([f(0, 0.8, 0.2, 0.5)])[0]).toEqual([0, 1]);
  });
});
