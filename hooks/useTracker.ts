/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * and face tracking (TDD-001 Phases 2-3). Face landmarks run through a One
 * Euro bank owned here; hands keep the slider-driven lerp.
 *
 * Phone support: `facing` picks the front/rear camera (flipping restarts only
 * the stream, never the models); a rear-camera frame is mirrored once here so
 * every consumer sees front-camera semantics; landmarkers try the GPU delegate
 * then the CPU one; camera failures are readable and retryable.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH, FACE_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { createOneEuroBank, faceSmoothingToMinCutoff } from '../components/shared/oneEuro';
import { updateAvgDt, nextFaceAlternating } from '../components/shared/facePolicy';
import { TrackedFrame } from '../components/shared/trackerTypes';
import { mirrorFrame } from '../components/shared/mirrorFrame';
import { createFpsMeter } from '../components/shared/fpsMeter';
import { poke, registerTracker, useIdlePaused } from '../components/shared/idle';
import { Facing, Delegate, resolveFacing, describeCameraError, createWithDelegateFallback } from './cameraSupport';

export interface UseTrackerOptions {
  hands?: boolean;         // default true
  face?: boolean;          // default false
  smoothing?: number;      // 0..1 UI amount for hands, same scale as SmoothingControl
  confidence?: number;     // handedness gate, default 0.5
  faceSmoothing?: number;  // 0..1 UI amount for the face One Euro filter, default 0.5
  facing?: Facing;         // camera to request, default 'user'
}

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true, face = false, facing = 'user' } = options;
  const [isReady, setIsReady] = useState(false);
  const idlePaused = useIdlePaused();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [activeFacing, setActiveFacing] = useState<Facing>(facing);
  const [canFlip, setCanFlip] = useState(false);
  const [delegate, setDelegate] = useState<Delegate | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });
  const faceFilterRef = useRef(createOneEuroBank());
  const facingRef = useRef<Facing>(facing);
  facingRef.current = facing;
  const activeFacingRef = useRef<Facing>(facing);
  const requestedRef = useRef<Facing | null>(null); // facing the open stream was requested with
  const openCameraRef = useRef<(() => void) | null>(null);
  const statsRef = useRef<{ trackFps: number; delegate: Delegate | null }>({ trackFps: 0, delegate: null });

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

  /** Re-run setup after a failure (models or camera). */
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // Published frame: mirrored to the front-camera convention when the rear camera is live.
  const frameRef = useRef<TrackedFrame | null>(null);
  // Un-mirrored frame: what buildFrame's smoothing continuity and the alternate-tick face reuse read.
  const rawFrameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!hands && !face) return;
    // Idle auto-pause: tear down camera + models; the effect re-runs on resume.
    if (idlePaused) {
      setIsReady(false);
      return;
    }
    setError(null);
    const releaseIdle = registerTracker();
    let isActive = true;
    const meter = createFpsMeter();

    const closeAll = () => {
      handLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      faceLandmarkerRef.current = null;
    };

    const stopStream = () => {
      const s = videoRef.current?.srcObject as MediaStream | null | undefined;
      s?.getTracks().forEach((t) => t.stop());
    };

    const setup = async () => {
      // Which model was loading when a throw happened, so the error names the
      // one that actually failed. null = the shared WASM fileset (the message
      // then keeps the old requested-modality wording).
      let loading: 'hand' | 'face' | null = null;
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
        if (!isActive) return;

        let used: Delegate = 'GPU';
        if (hands) {
          loading = 'hand';
          const r = await createWithDelegateFallback(
            (d) =>
              HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate: d },
                runningMode: 'VIDEO',
                numHands: 2,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              }),
            (e) => console.warn('Hand GPU delegate failed, using CPU', e)
          );
          if (!isActive) { r.value.close(); return; } // superseded while loading: never touch the newer run's refs
          handLandmarkerRef.current = r.value;
          if (r.delegate === 'CPU') used = 'CPU';
        }
        if (face) {
          loading = 'face';
          const r = await createWithDelegateFallback(
            (d) =>
              FaceLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: d },
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
                runningMode: 'VIDEO',
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              }),
            (e) => console.warn('Face GPU delegate failed, using CPU', e)
          );
          if (!isActive) { r.value.close(); return; }
          faceLandmarkerRef.current = r.value;
          if (r.delegate === 'CPU') used = 'CPU';
        }

        statsRef.current.delegate = used;
        setDelegate(used);
        openCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        setError(`Failed to load ${loading ?? (face && !hands ? 'face' : 'hand')} tracking: ${err.message}. Tap Retry.`);
      }
    };

    /** (Re)open the camera for the current `facing`. Models stay loaded. */
    let openSeq = 0; // a newer openCamera supersedes an older one still awaiting getUserMedia
    const openCamera = async () => {
      const seq = ++openSeq;
      const wanted = facingRef.current;
      requestedRef.current = wanted;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      setIsReady(false);
      try {
        stopStream(); // iOS will not hand out a second camera while the first is open
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: wanted }, width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const video = videoRef.current;
        if (!video || !isActive || seq !== openSeq) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const actual = resolveFacing(wanted, stream.getVideoTracks()[0]?.getSettings().facingMode);
        activeFacingRef.current = actual;
        setActiveFacing(actual);

        video.srcObject = stream;
        video.play().catch((e) => console.warn('video.play() was refused', e));
        video.onloadeddata = () => {
          if (!isActive) return;
          // A new stream: drop smoothing history so the first frame does not lerp from the old camera.
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
          rawFrameRef.current = null;
          frameRef.current = null;
          faceFilterRef.current.reset();
          setIsReady(true);
          tick();
        };

        navigator.mediaDevices
          .enumerateDevices()
          .then((d) => isActive && setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1))
          .catch(() => {});
      } catch (err) {
        console.error('Camera Error:', err);
        if (isActive && seq === openSeq) setError(describeCameraError(err));
      }
    };
    openCameraRef.current = openCamera;

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
          const prev = rawFrameRef.current;
          const next = buildFrame(prev, handResult, faceResult, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
            faceFilter: faceFilterRef.current,
          });
          if (faceLm && !runFace && prev) next.face = prev.face; // alternate tick: reuse
          rawFrameRef.current = next;
          frameRef.current = activeFacingRef.current === 'environment' ? mirrorFrame(next) : next;
          statsRef.current.trackFps = meter.tick(now);
          if (next.hands.length > 0) poke(); // playing with your hands is using the app
        } catch (e) {
          console.warn('Detection failed this frame', e);
        }
      }

      requestRef.current = requestAnimationFrame(tick);
    };

    setup();

    return () => {
      isActive = false;
      openCameraRef.current = null;
      requestedRef.current = null;
      releaseIdle();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      closeAll();
      stopStream();
    };
  }, [videoRef, hands, face, idlePaused, attempt]);

  // Flipping the camera reopens the stream only; the models stay loaded.
  useEffect(() => {
    if (requestedRef.current !== null && requestedRef.current !== facing) openCameraRef.current?.();
  }, [facing]);

  return { frameRef, isReady, error, retry, activeFacing, canFlip, delegate, statsRef, setSmoothing, setConfidence, setFaceSmoothing };
}
