/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { frameToCapture } from './captureFrame';
import { TrackedFrame, TrackedHand, TrackedFace, Landmark } from '../shared/trackerTypes';
import { buildEnvelope, serializeV3, migrateV2 } from '../shared/recordingSchema';

const pts = (n: number, x: number): Landmark[] => Array.from({ length: n }, (_, i) => ({ x, y: 0.5 + i * 1e-3, z: 0 }));
const v0 = { x: 0, y: 0, z: 0 };

const hand = (side: 'left' | 'right', x: number): TrackedHand => ({
  side,
  score: 0.9,
  landmarks: pts(21, x),
  rawLandmarks: pts(21, x),
  world: pts(21, x),
  tip: v0,
  velocity: v0,
  pinch: 0.1,
});

const face = (): TrackedFace => ({
  landmarks: pts(478, 0.5),
  rawLandmarks: pts(478, 0.5),
  blendshapes: { jawOpen: 0.3 },
  transform: null,
});

const frame = (f: TrackedFace | null, left: TrackedHand | null, right: TrackedHand | null): TrackedFrame => ({
  t: 0,
  dt: 0,
  hands: [right, left].filter((h): h is TrackedHand => h !== null),
  left,
  right,
  face: f,
});

describe('frameToCapture', () => {
  it('returns null for no tracked frame', () => {
    expect(frameToCapture(null)).toBeNull();
  });

  it('returns null when there is neither a face nor a hand', () => {
    expect(frameToCapture(frame(null, null, null))).toBeNull();
  });

  it('captures a face-only frame with no hands', () => {
    const f = face();
    const cap = frameToCapture(frame(f, null, null))!;
    expect(cap.faceLandmarks).toBe(f.landmarks);
    expect(cap.blendshapes).toBe(f.blendshapes);
    expect(cap.landmarks).toEqual([]);
  });

  it('captures a hands-only frame and omits BOTH face keys', () => {
    const cap = frameToCapture(frame(null, hand('left', 0.3), null))!;
    expect(cap).not.toBeNull();
    expect(cap).not.toHaveProperty('faceLandmarks');
    expect(cap).not.toHaveProperty('blendshapes');
    expect(cap.landmarks).toHaveLength(1);
    expect(cap.landmarks![0][0].x).toBe(0.3);
  });

  it('captures face and both hands, right hand first (v3 index 0 = right)', () => {
    const cap = frameToCapture(frame(face(), hand('left', 0.3), hand('right', 0.7)))!;
    expect(cap.faceLandmarks).toHaveLength(478);
    expect(cap.landmarks).toHaveLength(2);
    expect(cap.landmarks![0][0].x).toBe(0.7);
    expect(cap.landmarks![1][0].x).toBe(0.3);
  });

  it('a hands-only frame round-trips through v3 as face: null', () => {
    const cap = frameToCapture(frame(null, null, hand('right', 0.6)))!;
    const json = JSON.parse(serializeV3(buildEnvelope([{ timestamp: 0, ...cap }], 'FACE', { durationMs: 0 })));
    expect(json.frames[0].face).toBeNull();
    const back = migrateV2(json);
    expect(back[0].landmarks).toHaveLength(1);
    expect(back[0]).not.toHaveProperty('faceLandmarks');
  });
});
