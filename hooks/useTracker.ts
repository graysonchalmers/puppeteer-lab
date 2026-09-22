/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * and face tracking (TDD-001 Phases 2-3). Face landmarks run through a One
 * Euro bank owned here; hands keep the slider-driven lerp.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH, FACE_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { createOneEuroBank, faceSmoothingToMinCutoff } from '../components/shared/oneEuro';
import { updateAvgDt, nextFaceAlternating } from '../components/shared/facePolicy';
import { TrackedFrame } from '../components/shared/trackerTypes';

export interface UseTrackerOptions {
  hands?: boolean;         // default true
  face?: boolean;          // default false
  smoothing?: number;      // 0..1 UI amount for hands, same scale as SmoothingControl
  confidence?: number;     // handedness gate, default 0.5
  faceSmoothing?: number;  // 0..1 UI amount for the face One Euro filter, default 0.5
}

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true, face = false } = options;
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });
  const faceFilterRef = useRef(createOneEuroBank());

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

  useEffect(() => {
    faceFilterRef.current.params.minCutoff = faceSmoothingToMinCutoff(options.faceSmoothing ?? 0.5);
  }, [options.faceSmoothing]);

  const setSmoothing = useCallback((amount01: number) => {
    settingsRef.current.smoothingAlpha = smoothingToLerp(Math.max(0, Math.min(1, amount01)));
  }, []);

  const setConfidence = useCallback((threshold: number) => {
    settingsRef.current.confidence = threshold;
  }, []);

  const setFaceSmoothing = useCallback((amount01: number) => {
    faceFilterRef.current.params.minCutoff = faceSmoothingToMinCutoff(amount01);
  }, []);

  const frameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!hands && !face) return;
    let isActive = true;

    const closeAll = () => {
      handLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      faceLandmarkerRef.current = null;
    };

    const setup = async () => {
      // Which model was loading when a throw happened, so the error names the
      // one that actually failed. null = the shared WASM fileset (the message
      // then keeps the old requested-modality wording).
      let loading: 'hand' | 'face' | null = null;
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
        if (!isActive) return;

        if (hands) {
          loading = 'hand';
          handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }
        if (face && isActive) {
          loading = 'face';
          faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: 'GPU' },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        }

        if (!isActive) {
          closeAll();
          return;
        }
        startCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        setError(`Failed to load ${loading ?? (face && !hands ? 'face' : 'hand')} tracking: ${err.message}`);
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

    let tickIndex = 0;
    let lastNow = 0;
    let avgDt = 0;
    let alternating = false;

    const tick = () => {
      if (!videoRef.current || !isActive) return;
      const handLm = handLandmarkerRef.current;
      const faceLm = faceLandmarkerRef.current;

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const now = performance.now();
        if (lastNow) avgDt = updateAvgDt(avgDt, now - lastNow);
        lastNow = now;
        alternating = nextFaceAlternating(alternating, avgDt, !!handLm && !!faceLm);
        const runFace = !!faceLm && (!alternating || tickIndex % 2 === 0);
        tickIndex++;

        try {
          const handResult = handLm ? handLm.detectForVideo(video, now) : null;
          const faceResult = runFace ? faceLm!.detectForVideo(video, now) : null;
          const prev = frameRef.current;
          const next = buildFrame(prev, handResult, faceResult, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
            faceFilter: faceFilterRef.current,
          });
          if (faceLm && !runFace && prev) next.face = prev.face; // alternate tick: reuse
          frameRef.current = next;
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
      closeAll();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [videoRef, hands, face]);

  return { frameRef, isReady, error, setSmoothing, setConfidence, setFaceSmoothing };
}
