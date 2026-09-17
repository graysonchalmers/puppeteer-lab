
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export { mapHandToWorld } from '../components/shared/mapHandToWorld';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useTracker } from './useTracker';
import { lerpToSmoothing } from '../components/shared/smoothing';
import { Landmark } from '../components/shared/trackerTypes';

interface AdapterHandResult {
  landmarks: Landmark[][];
  handedness: { categoryName: string; score: number }[][];
}

export const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const [smoothing, setSmoothingState] = useState(0.6);
  const tracker = useTracker(videoRef, { hands: true, smoothing: lerpToSmoothing(smoothing), confidence: 0 });

  const setSmoothingFactor = useCallback((factor: number) => {
    setSmoothingState(Math.max(0.01, Math.min(1.0, factor)));
  }, []);

  const handPositionsRef = useRef<{
    left: THREE.Vector3 | null;
    right: THREE.Vector3 | null;
    lastLeft: THREE.Vector3 | null;
    lastRight: THREE.Vector3 | null;
    leftVelocity: THREE.Vector3;
    rightVelocity: THREE.Vector3;
    lastTimestamp: number;
  }>({
    left: null,
    right: null,
    lastLeft: null,
    lastRight: null,
    leftVelocity: new THREE.Vector3(0, 0, 0),
    rightVelocity: new THREE.Vector3(0, 0, 0),
    lastTimestamp: 0,
  });

  const lastResultsRef = useRef<AdapterHandResult | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!tracker.isReady) return;
    let isActive = true;

    const tick = () => {
      if (!isActive) return;
      const frame = tracker.frameRef.current;

      if (frame) {
        lastResultsRef.current = {
          landmarks: frame.hands.map((h) => h.landmarks),
          handedness: frame.hands.map((h) => [
            { categoryName: h.side === 'right' ? 'Right' : 'Left', score: h.score },
          ]),
        };

        const s = handPositionsRef.current;
        s.lastTimestamp = frame.t;

        if (frame.left) {
          const v = new THREE.Vector3(frame.left.tip.x, frame.left.tip.y, frame.left.tip.z);
          s.leftVelocity.set(frame.left.velocity.x, frame.left.velocity.y, frame.left.velocity.z);
          s.lastLeft = s.left ?? v.clone();
          s.left = v;
        } else {
          s.left = null;
        }

        if (frame.right) {
          const v = new THREE.Vector3(frame.right.tip.x, frame.right.tip.y, frame.right.tip.z);
          s.rightVelocity.set(frame.right.velocity.x, frame.right.velocity.y, frame.right.velocity.z);
          s.lastRight = s.right ?? v.clone();
          s.right = v;
        } else {
          s.right = null;
        }
      }

      requestRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      isActive = false;
      cancelAnimationFrame(requestRef.current);
    };
  }, [tracker.isReady, tracker.frameRef]);

  return {
    isCameraReady: tracker.isReady,
    handPositionsRef,
    lastResultsRef,
    error: tracker.error,
    setSmoothingFactor,
  };
};
