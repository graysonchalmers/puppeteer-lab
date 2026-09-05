/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure hand assignment + confidence gating, extracted from the DebugView
 * render loop so both the telemetry and Air Canvas demos share one rule set.
 */
export interface ResolvedHand {
  landmarks: any[];
  isRight: boolean;
  score: number;
}

export interface ResolvedHands {
  hands: ResolvedHand[];
  left: any[] | null;
  right: any[] | null;
  drawnCount: number;
}

export function resolveHands(
  landmarksList: any[][],
  handedness: any[],
  confidenceThreshold: number,
  bypassGate: boolean
): ResolvedHands {
  const hands: ResolvedHand[] = [];
  let left: any[] | null = null;
  let right: any[] | null = null;

  landmarksList.forEach((landmarks, index) => {
    let isRight = false;
    let score = 1.0;

    if (handedness && handedness[index] && handedness[index][0]) {
      isRight = handedness[index][0].categoryName === 'Right';
      score = handedness[index][0].score;
    } else {
      // Unlabelled hand: take the side not already claimed so two hands never
      // collapse onto one side (the partial-handedness bug). Only when neither
      // or both sides are open do we fall back to index 0 = right.
      if (right && !left) isRight = false;
      else if (left && !right) isRight = true;
      else isRight = index === 0;
    }

    if (score < confidenceThreshold && !bypassGate) return;

    hands.push({ landmarks, isRight, score });
    if (isRight) right = landmarks;
    else left = landmarks;
  });

  return { hands, left, right, drawnCount: hands.length };
}
