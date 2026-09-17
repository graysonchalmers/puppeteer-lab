
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FilesetResolver, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { smoothLandmarks, LandmarkLike } from '../components/shared/smoothing';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH } from './mediapipeAssets';
import { mapHandToWorld } from '../components/shared/mapHandToWorld';

export { mapHandToWorld } from '../components/shared/mapHandToWorld';

export const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store dynamic settings in a ref so we can change them without restarting the MediaPipe loop
  const settingsRef = useRef({
    smoothingFactor: 0.6 // Default LERP factor
  });

  const setSmoothingFactor = useCallback((factor: number) => {
    // Clamp between 0.01 (Very smooth/slow) and 1.0 (Instant/Jittery)
    settingsRef.current.smoothingFactor = Math.max(0.01, Math.min(1.0, factor));
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
    leftVelocity: new THREE.Vector3(0,0,0),
    rightVelocity: new THREE.Vector3(0,0,0),
    lastTimestamp: 0
  });

  // To expose raw results for UI preview
  const lastResultsRef = useRef<HandLandmarkerResult | null>(null);

  // Previous frame's smoothed landmarks per side, so smoothing pairs by
  // handedness rather than array index (MediaPipe reorders hands between frames).
  const prevSmoothedRef = useRef<{ Left: LandmarkLike[] | null; Right: LandmarkLike[] | null }>({ Left: null, Right: null });

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    let isActive = true;

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          MEDIAPIPE_WASM_PATH
        );

        if (!isActive) return;

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_PATH,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        if (!isActive) {
             landmarker.close();
             return;
        }

        landmarkerRef.current = landmarker;
        startCamera();
      } catch (err: any) {
        console.error("Error initializing MediaPipe:", err);
        setError(`Failed to load hand tracking: ${err.message}`);
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
             if (isActive) {
                 setIsCameraReady(true);
                 predictWebcam();
             }
          };
        }
      } catch (err) {
        console.error("Camera Error:", err);
        setError("Could not access camera.");
      }
    };

    const smoothResults = (results: HandLandmarkerResult): HandLandmarkerResult => {
        const alpha = settingsRef.current.smoothingFactor;
        const prev = prevSmoothedRef.current;
        const seen = { Left: false, Right: false };
        const landmarks = (results.landmarks ?? []).map((lms, i) => {
            const side: 'Left' | 'Right' =
                results.handedness?.[i]?.[0]?.categoryName === 'Right' ? 'Right' : 'Left';
            const out = smoothLandmarks(prev[side], lms, alpha);
            prev[side] = out;
            seen[side] = true;
            return out;
        });
        if (!seen.Left) prev.Left = null;
        if (!seen.Right) prev.Right = null;
        // Rebuild rather than mutate: MediaPipe may reuse the result object.
        return { ...results, landmarks: landmarks as HandLandmarkerResult['landmarks'] };
    };

    const predictWebcam = () => {
        if (!videoRef.current || !landmarkerRef.current || !isActive) return;

        const video = videoRef.current;
        // Only process if video has data
        if (video.videoWidth > 0 && video.videoHeight > 0) {
             let startTimeMs = performance.now();
             try {
                 const smoothed = smoothResults(landmarkerRef.current.detectForVideo(video, startTimeMs));
                 lastResultsRef.current = smoothed;
                 processResults(smoothed);
             } catch (e) {
                 // Sometimes detectForVideo fails if timestamps aren't strictly increasing or video is not ready
                 console.warn("Detection failed this frame", e);
             }
        }

        requestRef.current = requestAnimationFrame(predictWebcam);
    };

    const processResults = (results: HandLandmarkerResult) => {
        const now = performance.now();
        const deltaTime = (now - handPositionsRef.current.lastTimestamp) / 1000;
        handPositionsRef.current.lastTimestamp = now;

        let newLeft: THREE.Vector3 | null = null;
        let newRight: THREE.Vector3 | null = null;

        if (results.landmarks) {
          for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i];
            // Note: MediaPipe 'handedness' can be counter-intuitive when mirrored.
            const classification = results.handedness[i][0];
            const isRight = classification.categoryName === 'Right'; 
            
            // ESTIMATE DEPTH (Z)
            // We use the distance between Wrist (0) and Middle Finger MCP (9) as a proxy for scale.
            // Closer hand = Larger distance.
            // Baseline distance approx 0.12 in normalized coords.
            const wrist = landmarks[0];
            const midMCP = landmarks[9];
            const size = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y);
            const depthOffset = size - 0.12;

            // Index finger tip is landmark 8
            const tip = landmarks[8];
            const worldPos = mapHandToWorld(tip.x, tip.y, depthOffset);

            if (isRight) {
                 newRight = worldPos; 
            } else {
                 newLeft = worldPos;
            }
          }
        }

        // --- Update State with Smoothing & Velocity ---
        const s = handPositionsRef.current;

        // Left
        if (newLeft) {
            if (s.left) {
                if (deltaTime > 0.001) {
                     s.leftVelocity.subVectors(newLeft, s.left).divideScalar(deltaTime);
                }
            }
            s.lastLeft = s.left ? s.left.clone() : newLeft.clone();
            s.left = newLeft;
        } else {
            s.left = null;
        }

        // Right
        if (newRight) {
             if (s.right) {
                 if (deltaTime > 0.001) {
                      s.rightVelocity.subVectors(newRight, s.right).divideScalar(deltaTime);
                 }
             }
             s.lastRight = s.right ? s.right.clone() : newRight.clone();
             s.right = newRight;
        } else {
            s.right = null;
        }
    };

    setupMediaPipe();

    return () => {
      isActive = false;
      if (requestRef.current) {
          cancelAnimationFrame(requestRef.current);
      }
      if (landmarkerRef.current) {
          landmarkerRef.current.close();
      }
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [videoRef]);

  return { isCameraReady, handPositionsRef, lastResultsRef, error, setSmoothingFactor };
};
