/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * tracking. Phase 2 only wires the hands-only path; Phase 3 adds face and
 * the combined hands+face path (TDD-001).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { TrackedFrame } from '../components/shared/trackerTypes';

export interface UseTrackerOptions {
  hands?: boolean;      // default true
  face?: boolean;       // default false (added Phase 3)
  smoothing?: number;   // 0..1 UI amount, same scale as SmoothingControl
  confidence?: number;  // handedness gate, default 0.5
}

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true } = options;
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });

  useEffect(() => {
    if (options.smoothing !== undefined) {
      settingsRef.current.smoothingAlpha = smoothingToLerp(options.smoothing);
    }
  }, [options.smoothing]);

  useEffect(() => {
    if (options.confidence !== undefined) {
      settingsRef.current.confidence = options.confidence;
    }
  }, [options.confidence]);

  const setSmoothing = useCallback((amount01: number) => {
    settingsRef.current.smoothingAlpha = smoothingToLerp(Math.max(0, Math.min(1, amount01)));
  }, []);

  const setConfidence = useCallback((threshold: number) => {
    settingsRef.current.confidence = threshold;
  }, []);

  const frameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!hands) return; // Phase 3 adds the face-only and combined paths here.
    let isActive = true;

    const setup = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!isActive) {
          landmarker.close();
          return;
        }

        handLandmarkerRef.current = landmarker;
        startCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        setError(`Failed to load hand tracking: ${err.message}`);
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            if (isActive) {
              setIsReady(true);
              tick();
            }
          };
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        console.error('Camera Error:', err);
        setError('Could not access camera.');
      }
    };

    const tick = () => {
      if (!videoRef.current || !handLandmarkerRef.current || !isActive) return;

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const now = performance.now();
        try {
          const handResult = handLandmarkerRef.current.detectForVideo(video, now);
          frameRef.current = buildFrame(frameRef.current, handResult, null, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
          });
        } catch (e) {
          console.warn('Detection failed this frame', e);
        }
      }

      requestRef.current = requestAnimationFrame(tick);
    };

    setup();

    return () => {
      isActive = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (handLandmarkerRef.current) handLandmarkerRef.current.close();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoRef, hands]);

  return { frameRef, isReady, error, setSmoothing, setConfidence };
}
