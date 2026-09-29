/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rear-camera normalization. MediaPipe sees the same raw geometry from the
 * front and the rear camera, but everything downstream (the puppet's X mirror,
 * the recorder, mapHandToWorld's X mirror, the Blender importer) assumes the
 * front-camera convention. Mirroring the frame once at the tracker output
 * lets a rear-camera take mean exactly what a front-camera take means, with
 * no schema change: x flips, hand sides and blendshape sides swap, world x and
 * velocity x negate, and the head matrix is conjugated by diag(-1, 1, 1, 1).
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
