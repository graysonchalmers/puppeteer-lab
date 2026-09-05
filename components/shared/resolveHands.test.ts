/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { resolveHands } from './resolveHands';

const hand = (tag: string) => [{ x: 0, y: 0, tag }]; // minimal stand-in landmark array
const rightHandedness = [{ categoryName: 'Right', score: 0.9 }];
const leftHandedness = [{ categoryName: 'Left', score: 0.9 }];

describe('resolveHands', () => {
  it('assigns right and left from handedness category', () => {
    const r = resolveHands([hand('a'), hand('b')], [rightHandedness, leftHandedness], 0.5, false);
    expect(r.right).toEqual(hand('a'));
    expect(r.left).toEqual(hand('b'));
    expect(r.drawnCount).toBe(2);
    expect(r.hands.map((h) => h.isRight)).toEqual([true, false]);
  });

  it('falls back to index 0 = right when handedness is missing', () => {
    const r = resolveHands([hand('a'), hand('b')], [], 0.5, false);
    expect(r.right).toEqual(hand('a'));
    expect(r.left).toEqual(hand('b'));
  });

  it('skips a hand below the confidence threshold', () => {
    const lowRight = [{ categoryName: 'Right', score: 0.2 }];
    const r = resolveHands([hand('a'), hand('b')], [lowRight, leftHandedness], 0.5, false);
    expect(r.right).toBeNull();
    expect(r.left).toEqual(hand('b'));
    expect(r.drawnCount).toBe(1);
  });

  it('bypasses the gate for playback (keeps a low-score hand)', () => {
    const lowRight = [{ categoryName: 'Right', score: 0.2 }];
    const r = resolveHands([hand('a')], [lowRight], 0.5, true);
    expect(r.right).toEqual(hand('a'));
    expect(r.drawnCount).toBe(1);
  });

  it('returns empty result for no hands', () => {
    const r = resolveHands([], [], 0.5, false);
    expect(r).toEqual({ hands: [], left: null, right: null, drawnCount: 0 });
  });
});
