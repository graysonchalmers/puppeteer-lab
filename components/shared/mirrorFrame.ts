/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rear-camera DISPLAY helpers. MediaPipe sees the same raw geometry from the
 * front and the rear camera for a subject facing the lens (the subject's right
 * hand is at image-left either way), so tracked frames and recordings stay RAW
 * and mean the same thing for both cameras (see recordingSchema). Only the live
 * view differs: the front camera is shown as a mirror, the rear camera as a
 * viewfinder window, so on the rear camera the live puppet is mirrored at
 * display time with these helpers. Never apply them to data that is recorded
 * or exported.
 *
 * mirrorFrame flips x, swaps hand sides and blendshape sides, negates world x
 * and velocity x, and conjugates the head matrix by diag(-1, 1, 1, 1).
 */
import { Landmark, TrackedFace, TrackedFrame, TrackedHand, Vec3 } from './trackerTypes';

const flipLm = (l: Landmark): Landmark => ({ x: 1 - l.x, y: l.y, z: l.z });
// 0 - v (not -v) so a zero never becomes -0.
const flipVec = (v: Vec3): Vec3 => ({ x: 0 - v.x, y: v.y, z: v.z });

/** ARKit blendshape names end in Left/Right when they are sided. */
export function swapSide(name: string): string {
  if (name.endsWith('Left')) return name.slice(0, -4) + 'Right';
  if (name.endsWith('Right')) return name.slice(0, -5) + 'Left';
  return name;
}

export function mirrorBlendshapes(b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(b)) out[swapSide(k)] = b[k];
  return out;
}

/** F * M * F with F = diag(-1,1,1,1) on a column-major 4x4: negate entries where exactly one of row/col is 0. */
export function mirrorTransform(m: number[] | null): number[] | null {
  if (!m || m.length !== 16) return m;
  return m.map((v, i) => ((i % 4 === 0) !== (i < 4) ? 0 - v : v));
}

function flipHand(h: TrackedHand): TrackedHand {
  return {
    ...h,
    side: h.side === 'left' ? 'right' : 'left',
    landmarks: h.landmarks.map(flipLm),
    rawLandmarks: h.rawLandmarks.map(flipLm),
    world: h.world.map(flipVec),
    tip: flipVec(h.tip),
    velocity: flipVec(h.velocity),
  };
}

function flipFace(f: TrackedFace): TrackedFace {
  return {
    landmarks: f.landmarks.map(flipLm),
    rawLandmarks: f.rawLandmarks.map(flipLm),
    blendshapes: mirrorBlendshapes(f.blendshapes),
    transform: mirrorTransform(f.transform),
  };
}

export function mirrorFrame(f: TrackedFrame): TrackedFrame {
  const hands = f.hands.map(flipHand);
  const flipped = new Map<TrackedHand, TrackedHand>(f.hands.map((h, i) => [h, hands[i]]));
  return {
    ...f,
    hands,
    // The old right hand is now the left one (and vice versa).
    left: f.right ? flipped.get(f.right) ?? null : null,
    right: f.left ? flipped.get(f.left) ?? null : null,
    face: f.face ? flipFace(f.face) : null,
  };
}

/** The frame as the live view should show it: raw for the front camera, mirrored for the rear one. */
export function viewFrame(f: TrackedFrame | null, facing: 'user' | 'environment'): TrackedFrame | null {
  if (!f) return null;
  return facing === 'environment' ? mirrorFrame(f) : f;
}
