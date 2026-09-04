/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * Calculates euclidean pixel distance between Thumb Tip (4) and Index Tip (8)
 */
export const calculatePinchDistance = (landmarks: LandmarkPoint[], w: number, h: number): number => {
  if (!landmarks || landmarks.length < 9) return Infinity;
  const t = landmarks[4];
  const i = landmarks[8];
  const tx = (1 - t.x) * w;
  const ty = t.y * h;
  const ix = (1 - i.x) * w;
  const iy = i.y * h;
  return Math.hypot(tx - ix, ty - iy);
};

/**
 * Analyzes hand landmark geometry to classify common poses and gestures
 */
export const analyzeGesture = (landmarks: LandmarkPoint[]): string | null => {
  if (!landmarks || landmarks.length < 21) return null;
  const wrist = landmarks[0];

  const distSq = (p1: LandmarkPoint, p2: LandmarkPoint) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
  };

  const dist = (p1: LandmarkPoint, p2: LandmarkPoint) => Math.sqrt(distSq(p1, p2));

  // Heuristic: A finger is extended if its Tip is further from wrist than its PIP joint.
  const isFingerExtended = (tipIdx: number, pipIdx: number) => {
    return distSq(landmarks[tipIdx], wrist) > distSq(landmarks[pipIdx], wrist);
  };

  const index = isFingerExtended(8, 6);
  const middle = isFingerExtended(12, 10);
  const ring = isFingerExtended(16, 14);
  const pinky = isFingerExtended(20, 18);

  // Thumb Analysis
  const p2 = landmarks[2]; // MCP
  const p3 = landmarks[3]; // IP
  const p4 = landmarks[4]; // Tip

  const d23 = dist(p2, p3);
  const d34 = dist(p3, p4);
  const d24 = dist(p2, p4);

  const thumbStraight = d24 > 0.9 * (d23 + d34);

  // Orientation Check
  // Y increases downward in normalized screen coords.
  const dy = p3.y - p4.y;
  const dx = p3.x - p4.x;
  const isVertical = Math.abs(dy) > Math.abs(dx);

  const thumbUp = thumbStraight && isVertical && p4.y < p3.y;
  const thumbDown = thumbStraight && isVertical && p4.y > p3.y;

  const fingersCount = (index ? 1 : 0) + (middle ? 1 : 0) + (ring ? 1 : 0) + (pinky ? 1 : 0);

  // Gesture classification (Aerospace telemetry labels without emojis)
  if (index && middle && !ring && !pinky) return 'VICTORY';
  if (index && !middle && !ring && !pinky) return 'POINTING';
  if (index && !middle && !ring && pinky) {
    return thumbStraight ? 'AFFIRMATION' : 'ROCK';
  }
  if (fingersCount >= 3) return 'OPEN PALM';
  if (fingersCount === 0) {
    if (thumbUp) return 'THUMB UP';
    if (thumbDown) return 'THUMB DOWN';
    return 'CLOSED FIST';
  }

  return null;
};
