/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure frame builder: raw MediaPipe hand/face results in, one TrackedFrame
 * out. Pairs hand identity and smoothing continuity by side (left/right),
 * never by MediaPipe's array index, since MediaPipe can reorder hands
 * between frames (TDD-001).
 */
import { Landmark, Vec3, TrackedHand, TrackedFace, TrackedFrame } from './trackerTypes';
import { resolveHands } from './resolveHands';
import { smoothLandmarks } from './smoothing';
import { mapHandToWorld } from './mapHandToWorld';
import { OneEuroBank } from './oneEuro';

export interface RawHandResult {
  landmarks: Landmark[][];
  handedness: { categoryName: string; score: number }[][];
}

export interface RawFaceResult {
  faceLandmarks: Landmark[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { data: number[] | Float32Array }[];
}

export interface BuildFrameOptions {
  confidence: number;
  smoothingAlpha: number;
  /** Stateful One Euro bank for face landmarks, owned by useTracker. Absent = raw. */
  faceFilter?: OneEuroBank;
}

// Wrist (0) to middle-finger-MCP (9) distance at a "neutral" hand distance
// from the camera, in normalized coords. Same baseline useMediaPipe used.
const HAND_DEPTH_BASELINE = 0.12;

function buildTrackedHand(
  side: 'left' | 'right',
  rawLandmarks: Landmark[],
  score: number,
  prevHand: TrackedHand | null,
  dtSeconds: number,
  smoothingAlpha: number
): TrackedHand {
  const landmarks = smoothLandmarks(prevHand?.landmarks ?? null, rawLandmarks, smoothingAlpha) as Landmark[];

  const wrist = landmarks[0];
  const midMcp = landmarks[9];
  const depthOffset = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y) - HAND_DEPTH_BASELINE;

  const world: Vec3[] = landmarks.map((lm) => {
    const w = mapHandToWorld(lm.x, lm.y, depthOffset);
    return { x: w.x, y: w.y, z: w.z };
  });

  const tip = world[8];
  const velocity: Vec3 =
    prevHand && dtSeconds > 0.001
      ? {
          x: (tip.x - prevHand.tip.x) / dtSeconds,
          y: (tip.y - prevHand.tip.y) / dtSeconds,
          z: (tip.z - prevHand.tip.z) / dtSeconds,
        }
      : { x: 0, y: 0, z: 0 };

  const pinch = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);

  return { side, score, landmarks, rawLandmarks, world, tip, velocity, pinch };
}

function buildTrackedFace(faceResult: RawFaceResult, now: number, filter?: OneEuroBank): TrackedFace | null {
  if (!faceResult.faceLandmarks || faceResult.faceLandmarks.length === 0) {
    // Face lost: reset so the next appearance starts from its own position.
    filter?.reset();
    return null;
  }

  const blendshapes: Record<string, number> = {};
  for (const cat of faceResult.faceBlendshapes?.[0]?.categories ?? []) {
    blendshapes[cat.categoryName] = cat.score;
  }

  const rawMatrix = faceResult.facialTransformationMatrixes?.[0]?.data ?? null;
  const transform = rawMatrix ? Array.from(rawMatrix) : null;

  const rawLandmarks = faceResult.faceLandmarks[0];
  const landmarks = filter ? filter.filter(rawLandmarks, now) : rawLandmarks;
  return { landmarks, rawLandmarks, blendshapes, transform };
}

export function buildFrame(
  prevFrame: TrackedFrame | null,
  handResult: RawHandResult | null,
  faceResult: RawFaceResult | null,
  now: number,
  options: BuildFrameOptions
): TrackedFrame {
  const dt = prevFrame ? now - prevFrame.t : 0;
  const dtSeconds = dt / 1000;

  const resolved = resolveHands(
    handResult?.landmarks ?? [],
    handResult?.handedness ?? [],
    options.confidence,
    false
  );

  const hands: TrackedHand[] = [];
  let left: TrackedHand | null = null;
  let right: TrackedHand | null = null;

  for (const h of resolved.hands) {
    const side: 'left' | 'right' = h.isRight ? 'right' : 'left';
    const prevHand = prevFrame ? (side === 'right' ? prevFrame.right : prevFrame.left) : null;
    const trackedHand = buildTrackedHand(side, h.landmarks, h.score, prevHand, dtSeconds, options.smoothingAlpha);
    hands.push(trackedHand);
    if (side === 'right') right = trackedHand;
    else left = trackedHand;
  }

  // faceResult === null means "face not requested or skipped this tick" and
  // must NOT reset the filter; only an empty result (face lost) does.
  const face = faceResult ? buildTrackedFace(faceResult, now, options.faceFilter) : null;

  return { t: now, dt, hands, left, right, face };
}
