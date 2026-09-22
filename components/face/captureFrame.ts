/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What Face Puppet records for one live TrackedFrame. Hands are captured even
 * when face detection drops (a hand over the face), so playback and export
 * keep the hands moving. A hands-only frame omits BOTH face keys, so the v3
 * envelope writes `face: null` for it (recordingSchema's mapFrameFace).
 */
import { FrameData } from '../../types';
import { TrackedFrame, TrackedHand } from '../shared/trackerTypes';

export function frameToCapture(t: TrackedFrame | null): Omit<FrameData, 'timestamp'> | null {
  if (!t) return null;
  // Right first: v3 hands[] index 0 = right, index 1 = left.
  const hands = [t.right, t.left].filter((h): h is TrackedHand => h !== null).map((h) => h.landmarks);
  if (!t.face && hands.length === 0) return null;
  return t.face
    ? { faceLandmarks: t.face.landmarks, blendshapes: t.face.blendshapes, landmarks: hands }
    : { landmarks: hands };
}
