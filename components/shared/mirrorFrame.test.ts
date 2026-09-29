import { describe, it, expect } from 'vitest';
import { mirrorFrame, mirrorBlendshapes, mirrorTransform, swapSide } from './mirrorFrame';
import { mapHandToWorld } from './mapHandToWorld';
import { Landmark, TrackedFrame, TrackedHand } from './trackerTypes';

// x values are binary fractions (0.25, 0.75) so 1 - (1 - x) round-trips exactly.
const lm = (x: number, y = 0.5, z = 0.1): Landmark => ({ x, y, z });

function hand(side: 'left' | 'right', x: number): TrackedHand {
  const w = mapHandToWorld(x, 0.5, 0);
  return {
    side,
    score: 0.9,
    landmarks: [lm(x)],
    rawLandmarks: [lm(x)],
    world: [{ x: w.x, y: w.y, z: w.z }],
    tip: { x: w.x, y: w.y, z: w.z },
    velocity: { x: 3, y: 4, z: 5 },
    pinch: 0.1,
  };
}

function frame(): TrackedFrame {
  const r = hand('right', 0.25);
  const l = hand('left', 0.75);
  return {
    t: 100,
    dt: 16,
    hands: [r, l],
    right: r,
    left: l,
    face: {
      landmarks: [lm(0.25), lm(0.5)],
      rawLandmarks: [lm(0.25), lm(0.5)],
      blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1, jawOpen: 0.4 },
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25, 0.5, -0.75, 1],
    },
  };
}

describe('swapSide', () => {
  it('swaps a trailing Left/Right and leaves centered shapes alone', () => {
    expect(swapSide('eyeBlinkLeft')).toBe('eyeBlinkRight');
    expect(swapSide('mouthSmileRight')).toBe('mouthSmileLeft');
    expect(swapSide('eyeLookInLeft')).toBe('eyeLookInRight');
    expect(swapSide('jawOpen')).toBe('jawOpen');
    expect(swapSide('browInnerUp')).toBe('browInnerUp');
  });
});

describe('mirrorBlendshapes', () => {
  it('moves each value to the opposite side', () => {
    expect(mirrorBlendshapes({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1, jawOpen: 0.4 })).toEqual({
      eyeBlinkRight: 0.9,
      eyeBlinkLeft: 0.1,
      jawOpen: 0.4,
    });
  });
});

describe('mirrorTransform', () => {
  it('negates x translation and the x-row/x-column rotation terms only (column-major)', () => {
    const m = [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 0.25, 0.5, -0.75, 1];
    const out = mirrorTransform(m)!;
    expect(out[0]).toBe(1); // (0,0) unchanged
    expect(out[1]).toBe(-2); // (1,0): column 0, row 1
    expect(out[4]).toBe(-4); // (0,1): column 1, row 0
    expect(out[5]).toBe(5); // (1,1) unchanged
    expect(out[9]).toBe(8); // (1,2) unchanged
    expect(out[12]).toBe(-0.25); // tx
    expect(out[13]).toBe(0.5); // ty
    expect(out[15]).toBe(1);
  });
  it('passes null and malformed input through', () => {
    expect(mirrorTransform(null)).toBeNull();
    expect(mirrorTransform([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('mirrorFrame', () => {
  it('flips x and swaps sides for hands, keeping left/right pointing into hands', () => {
    const out = mirrorFrame(frame());
    // The old right hand (x 0.25) is now the left hand at x 0.75.
    expect(out.left!.side).toBe('left');
    expect(out.left!.landmarks[0].x).toBe(0.75);
    expect(out.right!.side).toBe('right');
    expect(out.right!.landmarks[0].x).toBe(0.25);
    expect(out.hands).toContain(out.left);
    expect(out.hands).toContain(out.right);
    expect(out.hands.length).toBe(2);
  });

  it('keeps world x consistent with mapHandToWorld on the flipped x', () => {
    const out = mirrorFrame(frame());
    // The old right hand came from x=0.25; flipped it sits at x=0.75.
    const expected = mapHandToWorld(0.75, 0.5, 0).x;
    expect(out.left!.world[0].x).toBeCloseTo(expected, 10);
    expect(out.left!.tip.x).toBeCloseTo(expected, 10);
  });

  it('negates only velocity x', () => {
    const out = mirrorFrame(frame());
    expect(out.left!.velocity).toEqual({ x: -3, y: 4, z: 5 });
  });

  it('flips face landmarks, swaps blendshape sides and conjugates the head matrix', () => {
    const out = mirrorFrame(frame());
    expect(out.face!.landmarks[0].x).toBe(0.75);
    expect(out.face!.rawLandmarks[1].x).toBe(0.5);
    expect(out.face!.blendshapes.eyeBlinkRight).toBe(0.9);
    expect(out.face!.blendshapes.eyeBlinkLeft).toBe(0.1);
    expect(out.face!.transform![12]).toBe(-0.25);
  });

  it('is its own inverse', () => {
    const f = frame();
    expect(mirrorFrame(mirrorFrame(f))).toEqual(f);
  });

  it('does not mutate its input', () => {
    const f = frame();
    const copy = structuredClone(f);
    mirrorFrame(f);
    expect(f).toEqual(copy);
  });

  it('handles frames with no face and one hand', () => {
    const r = hand('right', 0.25);
    const out = mirrorFrame({ t: 1, dt: 0, hands: [r], right: r, left: null, face: null });
    expect(out.face).toBeNull();
    expect(out.right).toBeNull();
    expect(out.left!.landmarks[0].x).toBe(0.75);
  });
});
