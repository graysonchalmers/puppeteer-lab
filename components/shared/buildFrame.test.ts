/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildFrame, RawHandResult, RawFaceResult } from './buildFrame';
import { TrackedFrame } from './trackerTypes';
import { createOneEuroBank } from './oneEuro';

const landmarks21 = (fill: (i: number) => { x: number; y: number; z: number }) =>
  Array.from({ length: 21 }, (_, i) => fill(i));

// Wrist (0) and middle-MCP (9) far apart -> a large depth proxy, easy to distinguish from baseline.
const handAt = (originX: number, originY: number): { x: number; y: number; z: number }[] =>
  landmarks21((i) => {
    if (i === 0) return { x: originX, y: originY, z: 0 };
    if (i === 9) return { x: originX, y: originY + 0.3, z: 0 };
    if (i === 4) return { x: originX, y: originY, z: 0 }; // thumb tip
    if (i === 8) return { x: originX + 0.05, y: originY, z: 0 }; // index tip, 0.05 normalized away from thumb
    return { x: originX, y: originY, z: 0 };
  });

const rightHandedness = [{ categoryName: 'Right', score: 0.95 }];
const leftHandedness = [{ categoryName: 'Left', score: 0.95 }];

describe('buildFrame', () => {
  it('assigns left and right from handedness and leaves the other side null', () => {
    const handResult: RawHandResult = {
      landmarks: [handAt(0.6, 0.5)],
      handedness: [rightHandedness],
    };
    const frame = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(frame.right).not.toBeNull();
    expect(frame.left).toBeNull();
    expect(frame.hands).toHaveLength(1);
    expect(frame.right!.side).toBe('right');
  });

  it('computes dt from consecutive timestamps, and 0 on the first frame', () => {
    const handResult: RawHandResult = { landmarks: [handAt(0.6, 0.5)], handedness: [rightHandedness] };
    const first = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(first.dt).toBe(0);
    expect(first.t).toBe(1000);

    const second = buildFrame(first, handResult, null, 1033, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(second.dt).toBe(33);
  });

  it('pairs smoothing continuity by side across an index swap between frames', () => {
    // Frame 1: index 0 = Left, index 1 = Right.
    const frame1Result: RawHandResult = {
      landmarks: [handAt(0.3, 0.5), handAt(0.7, 0.5)],
      handedness: [leftHandedness, rightHandedness],
    };
    const frame1 = buildFrame(null, frame1Result, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });

    // Frame 2: MediaPipe reordered its array -- index 0 is now Right, index 1 is now Left.
    // Heavy smoothing (alpha 0.1) should pull each side's landmarks toward ITS OWN previous
    // frame, not toward whatever sat at the same array index last time.
    const rightMoved = handAt(0.75, 0.5); // right hand moved a little
    const leftMoved = handAt(0.32, 0.5); // left hand moved a little
    const frame2Result: RawHandResult = {
      landmarks: [rightMoved, leftMoved],
      handedness: [rightHandedness, leftHandedness],
    };
    const frame2 = buildFrame(frame1, frame2Result, null, 1016, { confidence: 0.5, smoothingAlpha: 0.1 });

    // Right hand's smoothed landmark[0].x should sit between frame1.right's x (0.7) and the new
    // raw x (0.75) -- i.e. pulled toward frame1's RIGHT hand, not frame1's index-0 (which was left, x=0.3).
    expect(frame2.right!.landmarks[0].x).toBeGreaterThan(0.7);
    expect(frame2.right!.landmarks[0].x).toBeLessThan(0.75);

    expect(frame2.left!.landmarks[0].x).toBeGreaterThan(0.3);
    expect(frame2.left!.landmarks[0].x).toBeLessThan(0.32);
  });

  it('computes pinch in normalized units matching the known thumb/index gap', () => {
    const handResult: RawHandResult = { landmarks: [handAt(0.6, 0.5)], handedness: [rightHandedness] };
    const frame = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    // handAt() places thumb (4) and index (8) exactly 0.05 apart on X, 0 apart on Y.
    expect(frame.right!.pinch).toBeCloseTo(0.05, 5);
  });

  it('returns face null when no face result is passed', () => {
    const handResult: RawHandResult = { landmarks: [handAt(0.6, 0.5)], handedness: [rightHandedness] };
    const frame = buildFrame(null, handResult, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(frame.face).toBeNull();
  });

  it('builds face blendshapes and transform when a face result is passed', () => {
    const frame: TrackedFrame = buildFrame(
      null,
      null,
      {
        faceLandmarks: [landmarks21((i) => ({ x: i / 21, y: 0.5, z: 0 }))],
        faceBlendshapes: [{ categories: [{ categoryName: 'mouthSmileLeft', score: 0.8 }] }],
        facialTransformationMatrixes: [{ data: Array.from({ length: 16 }, (_, i) => i) }],
      },
      1000,
      { confidence: 0.5, smoothingAlpha: 1.0 }
    );
    expect(frame.face).not.toBeNull();
    expect(frame.face!.blendshapes.mouthSmileLeft).toBeCloseTo(0.8);
    expect(frame.face!.transform).toHaveLength(16);
  });

  it('returns no hands when handResult is null (face-only tick)', () => {
    const frame = buildFrame(null, null, null, 1000, { confidence: 0.5, smoothingAlpha: 1.0 });
    expect(frame.hands).toHaveLength(0);
    expect(frame.left).toBeNull();
    expect(frame.right).toBeNull();
  });
});

const face478 = (x: number) => Array.from({ length: 478 }, (_, i) => ({ x, y: 0.5 + i * 1e-4, z: 0 }));
const faceResult = (x: number): RawFaceResult => ({
  faceLandmarks: [face478(x)],
  faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.4 }] }],
});
const faceOpts = { confidence: 0.5, smoothingAlpha: 1 };

describe('buildFrame face', () => {
  it('face is null when no face result is passed', () => {
    expect(buildFrame(null, null, null, 0, faceOpts).face).toBeNull();
  });

  it('without a filter, landmarks equal raw landmarks', () => {
    const f = buildFrame(null, null, faceResult(0.3), 0, faceOpts);
    expect(f.face!.landmarks[0].x).toBe(0.3);
    expect(f.face!.rawLandmarks[0].x).toBe(0.3);
    expect(f.face!.blendshapes.jawOpen).toBe(0.4);
  });

  it('with a filter, landmarks are filtered and rawLandmarks stay raw', () => {
    const faceFilter = createOneEuroBank();
    const a = buildFrame(null, null, faceResult(0.3), 0, { ...faceOpts, faceFilter });
    const b = buildFrame(a, null, faceResult(0.6), 16, { ...faceOpts, faceFilter });
    expect(b.face!.rawLandmarks[0].x).toBe(0.6);
    expect(b.face!.landmarks[0].x).toBeGreaterThan(0.3);
    expect(b.face!.landmarks[0].x).toBeLessThan(0.6);
  });

  it('a lost face resets the filter so re-entry does not swoop', () => {
    const faceFilter = createOneEuroBank();
    const a = buildFrame(null, null, faceResult(0.3), 0, { ...faceOpts, faceFilter });
    const lost = buildFrame(a, null, { faceLandmarks: [] }, 16, { ...faceOpts, faceFilter });
    expect(lost.face).toBeNull();
    const back = buildFrame(lost, null, faceResult(0.8), 32, { ...faceOpts, faceFilter });
    expect(back.face!.landmarks[0].x).toBe(0.8);
  });
});
