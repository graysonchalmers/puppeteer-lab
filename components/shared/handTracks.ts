/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Re-establishes hand identity in a saved take. Takes carry no handedness: hands are stored right-first, but a
 * lone hand is always index 0 whichever hand it is. Two hands in one frame are therefore trusted as [slot 0,
 * slot 1] (the capture order); a lone hand joins the slot whose last wrist position is nearer.
 */
import { FrameData } from '../../types';

type Pt = { x: number; y: number };

const isHand = (h: any): boolean => Array.isArray(h) && h.length >= 21;
const wrist = (h: any[]): Pt => ({ x: h[0].x, y: h[0].y });
const dist = (a: Pt | null, b: Pt) => (a ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

export function trackHands(frames: FrameData[]): number[][] {
  const last: (Pt | null)[] = [null, null];
  return frames.map((fr) => {
    const hs = (fr.landmarks ?? []).slice(0, 2);
    const ok = hs.map(isHand);
    if (hs.length === 2 && ok[0] && ok[1]) {
      last[0] = wrist(hs[0]);
      last[1] = wrist(hs[1]);
      return [0, 1];
    }
    return hs.map((h, i) => {
      if (!ok[i]) return -1;
      const w = wrist(h);
      const slot = dist(last[1], w) < dist(last[0], w) ? 1 : 0;
      last[slot] = w;
      return slot;
    });
  });
}
