/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One camera grant, one rAF loop, one frame shape (TrackedFrame) for hand
 * and face tracking (TDD-001 Phases 2-3). Face landmarks run through a One
 * Euro bank owned here; hands keep the slider-driven lerp.
 *
 * Phone support: `facing` picks the front/rear camera (flipping restarts only
 * the stream, never the models). Frames stay RAW for both cameras (MediaPipe
 * sees the same geometry either way, so recordings keep one meaning); the
 * rear-camera viewfinder mirroring is done at display time (see mirrorFrame's
 * viewFrame). Landmarkers try the GPU delegate then the CPU one.
 *
 * Permission flow (see docs/PHONE_PORT.md):
 *  - `enabled: false` starts nothing (no camera, no models): the caller shows an
 *    explainer and flips it on from a tap, so the OS prompt is never a surprise.
 *  - The camera request is issued FIRST, then the models load in parallel, so
 *    the prompt appears at once on the tap. Frames start when both are ready.
 *  - `audio: true` asks for the microphone in the SAME request as the camera
 *    (one prompt). The mic track is kept aside (audioStreamRef, muted until a
 *    take records) and survives camera flips; the recorder never has to ask.
 *  - A refused mic never blocks the camera (planAudioFallback); a failed camera
 *    is a structured `cameraIssue` with the right next step per error name.
 *  - The OS can end the stream (iOS backgrounding): status 'lost' + resumeCamera().
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HandLandmarker, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_PATH, HAND_MODEL_PATH, FACE_MODEL_PATH } from './mediapipeAssets';
import { buildFrame } from '../components/shared/buildFrame';
import { smoothingToLerp } from '../components/shared/smoothing';
import { createOneEuroBank, faceSmoothingToMinCutoff, FACE_ONE_EURO_DEFAULTS } from '../components/shared/oneEuro';
import { LIPS_OUTER, LIPS_INNER } from '../components/face/faceTopology';
import { updateAvgDt, nextAlternating } from '../components/shared/facePolicy';
import { TrackedFrame } from '../components/shared/trackerTypes';
import { createFpsMeter } from '../components/shared/fpsMeter';
import { createTrackerStats, createTickHistory, ema, TrackerStats } from '../components/shared/trackerStats';
import { poke, registerTracker, holdAwake, useIdlePaused } from '../components/shared/idle';
import { Facing, Delegate, resolveFacing, createWithDelegateFallback } from './cameraSupport';
import {
  CameraIssue,
  CameraIssueKind,
  MicStatus,
  assessTrack,
  buildCameraIssue,
  checkEnvironment,
  classifyCameraError,
  detectBrowser,
  errorName,
  issueSentence,
  planAudioFallback,
  queryPermission,
} from './cameraAccess';

export type TrackerStatus =
  | 'idle' // enabled is false: nothing has been requested
  | 'starting' // waiting on the permission prompt / camera / models
  | 'live'
  | 'lost' // the OS or another app ended or froze the stream; resumeCamera() reopens it
  | 'error'; // cameraIssue or a model failure; retry() tries again

export interface UseTrackerOptions {
  hands?: boolean;         // default true
  face?: boolean;          // default false
  smoothing?: number;      // 0..1 UI amount for hands, same scale as SmoothingControl
  confidence?: number;     // handedness gate, default 0.5
  faceSmoothing?: number;  // 0..1 UI amount for the face One Euro filter, default 0.5
  facing?: Facing;         // camera to request, default 'user'
  /** false = do nothing until a caller flips it (used for the tap-to-start explainer). Default true. */
  enabled?: boolean;
  /** Ask for the microphone together with the camera on the first request. Default false. */
  audio?: boolean;
}

/** How long a muted camera track may stay muted before it counts as lost (backgrounding mutes briefly, then unmutes). */
const MUTE_GRACE_MS = 2500;
/** Lips filter 6x lighter than the rest of the face (3 Hz at the default slider): the head filter passed
 * only about a third of 4 Hz speech motion; this passes about two thirds (sim, teardown 2026-10-04). */
const LIP_FILTER = { points: [...LIPS_OUTER, ...LIPS_INNER], minCutoffScale: 6, dCutoff: 2 };

export function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTrackerOptions = {}
) {
  const { hands = true, face = false, facing = 'user', enabled = true, audio = false } = options;
  const [isReady, setIsReady] = useState(false);
  const idlePaused = useIdlePaused();
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>('off');
  const [attempt, setAttempt] = useState(0);
  const [activeFacing, setActiveFacing] = useState<Facing>(facing);
  const [canFlip, setCanFlip] = useState(false);
  const [delegate, setDelegate] = useState<Delegate | null>(null);

  const settingsRef = useRef({
    smoothingAlpha: smoothingToLerp(options.smoothing ?? 0.6),
    confidence: options.confidence ?? 0.5,
  });
  const faceFilterRef = useRef(createOneEuroBank({ ...FACE_ONE_EURO_DEFAULTS, fast: LIP_FILTER }));
  const facingRef = useRef<Facing>(facing);
  facingRef.current = facing;
  const audioWantedRef = useRef(audio);
  audioWantedRef.current = audio;
  const requestedRef = useRef<Facing | null>(null); // facing the open stream was requested with
  const openCameraRef = useRef<(() => void) | null>(null);
  const enableMicRef = useRef<(() => Promise<void>) | null>(null);
  const acquiringRef = useRef(false); // a getUserMedia call is in flight: a retry tap must not stack a second
  const modelsFailedRef = useRef(false);
  /** The microphone track wrapped in its own stream; null when there is none. The recorder reads this. */
  const audioStreamRef = useRef<MediaStream | null>(null);
  const statsRef = useRef<TrackerStats>(createTrackerStats());
  /** Recent ticks (duration, hands in view, face ran) for the debug overlay's graph. */
  const historyRef = useRef(createTickHistory());

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

  /**
   * Try again after a failure. A camera-only failure reopens just the stream (models stay loaded); a model
   * failure re-runs setup. Ignored while a request is already in flight, so double taps cannot stack prompts.
   */
  const retry = useCallback(() => {
    if (acquiringRef.current) return;
    if (!modelsFailedRef.current && openCameraRef.current) openCameraRef.current();
    else setAttempt((a) => a + 1);
  }, []);

  /** "Continue without microphone": drop the mic from the request and try the camera again in one step. */
  const skipMic = useCallback(() => {
    audioWantedRef.current = false; // set here, not via the prop: the prop only updates on the next render
    retry();
  }, [retry]);

  /** One-tap resume after status 'lost' (same as retry, named for the UI). */
  const resumeCamera = retry;

  /** Explicit, user-tapped request for the microphone after the camera is already running (audio was off at start). */
  const enableMic = useCallback(() => enableMicRef.current?.() ?? Promise.resolve(), []);

  // Published frame: always raw (same for both cameras). Also what buildFrame's
  // smoothing continuity and the alternate-tick face reuse read.
  const frameRef = useRef<TrackedFrame | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || (!hands && !face)) return;
    // Idle auto-pause: tear down camera + models; the effect re-runs on resume.
    if (idlePaused) {
      setIsReady(false);
      return;
    }
    setModelError(null);
    setCameraIssue(null);
    setStatus('starting');
    modelsFailedRef.current = false;
    const releaseIdle = registerTracker();
    // The idle timer must not tear the camera down while a person is still reading the permission prompt.
    let releaseHold: (() => void) | null = holdAwake();
    const dropHold = () => {
      releaseHold?.();
      releaseHold = null;
    };
    let isActive = true;
    const meter = createFpsMeter();
    const handMeter = createFpsMeter();
    statsRef.current = createTrackerStats(); // a fresh run starts from zero, but keeps writing into one object

    const closeAll = () => {
      handLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      faceLandmarkerRef.current = null;
    };

    // The streams this run owns. Kept here, not read back from videoRef: React nulls the ref
    // before passive-effect cleanup runs, so videoRef.current?.srcObject is gone by then.
    let liveStream: MediaStream | null = null; // camera tracks only; flips replace it, the mic survives
    let audioTrack: MediaStreamTrack | null = null;
    const stopStream = () => {
      liveStream?.getTracks().forEach((t) => t.stop());
      liveStream = null;
    };
    const dropAudio = () => {
      audioTrack?.stop();
      audioTrack = null;
      audioStreamRef.current = null;
    };

    let modelsReady = false;
    let streamReady = false; // the camera has delivered its first frame
    let micDecided = false;  // the combined camera+mic request has been answered (once per run; flips never re-ask)
    let openSeq = 0;         // a newer openCamera supersedes an older one still awaiting getUserMedia
    let lostSeq = -1;        // the open that was marked lost (an unmute can bring it back)
    let unwatch: (() => void) | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (isActive) fn();
      }, ms);
      timers.add(id);
    };

    let tickIndex = 0;
    let lastNow = 0;
    let avgDt = 0;
    let alternating = false;
    let lastVideoTime = -1; // detect each camera frame once: rAF can outpace the camera

    /** Frames start only when the models AND the camera are both ready (they load in parallel). */
    const tryGo = () => {
      if (!isActive || !modelsReady || !streamReady) return;
      // A new stream: drop smoothing history so the first frame does not lerp from the old camera.
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      frameRef.current = null;
      lastNow = 0; // the reopen gap must not inflate avgDt
      lastVideoTime = -1;
      faceFilterRef.current.reset();
      setIsReady(true);
      setStatus('live');
      dropHold();
      tick();
    };

    let lastWithAudio = false; // did the latest request include the microphone (drives the wording of the blocked steps)
    const showIssue = (kind: CameraIssueKind, micOptional = false) => {
      dropHold();
      setIsReady(false);
      setStatus('error');
      setCameraIssue(
        buildCameraIssue(kind, {
          browser: detectBrowser(navigator.userAgent, navigator.maxTouchPoints),
          withMic: lastWithAudio,
          micOptional,
        })
      );
    };
    const fail = (err: unknown, micOptional = false) => {
      console.error('Camera Error:', err);
      showIssue(classifyCameraError(err), micOptional);
    };

    const adoptAudio = (track: MediaStreamTrack) => {
      audioTrack?.stop();
      audioTrack = track;
      track.enabled = false; // silent until a take records (the recorder flips it)
      audioStreamRef.current = new MediaStream([track]);
      setMicStatus('on');
      track.addEventListener('ended', () => {
        if (audioTrack !== track) return;
        audioTrack = null;
        audioStreamRef.current = null;
        if (isActive) setMicStatus('unavailable');
      });
    };

    const getStream = async (wanted: Facing, withAudio: boolean): Promise<MediaStream> => {
      const md = navigator.mediaDevices;
      // frameRate is an `ideal`, so a phone that tops out at 30 fps just gets 30; the achieved rate shows in the debug overlay.
      const video = { facingMode: { ideal: wanted }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } };
      try {
        return await md.getUserMedia({ video, audio: withAudio });
      } catch (e) {
        // Only `ideal` constraints are used, but some Android cameras still reject the size: plain video is a fine fallback.
        if (errorName(e) === 'OverconstrainedError') return md.getUserMedia({ video: true, audio: withAudio });
        throw e;
      }
    };

    /** The camera stopped delivering (ended, or muted past the grace period): stop the loop and let the person resume. */
    const markLost = (seq: number) => {
      if (!isActive || seq !== openSeq || lostSeq === seq) return;
      lostSeq = seq;
      streamReady = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      setIsReady(false);
      setStatus('lost');
    };

    /** Check the camera track now; a muted one gets MUTE_GRACE_MS to come back before it counts as lost. */
    const recheck = (seq: number) => {
      if (!isActive || seq !== openSeq || !liveStream) return;
      const track = liveStream.getVideoTracks()[0];
      const verdict = assessTrack(track);
      const v = videoRef.current;
      if (v && v.srcObject && v.paused && verdict === 'ok') v.play().catch(() => {});
      if (verdict === 'ended') markLost(seq);
      else if (verdict === 'muted' && streamReady) {
        later(() => {
          if (seq !== openSeq || !liveStream || !streamReady) return;
          const t = liveStream.getVideoTracks()[0];
          if (assessTrack(t) !== 'ok' && document.visibilityState === 'visible') markLost(seq);
        }, MUTE_GRACE_MS);
      }
    };

    /** (Re)open the camera for the current `facing`. Models stay loaded. */
    const openCamera = async () => {
      const seq = ++openSeq;
      const wanted = facingRef.current;
      requestedRef.current = wanted;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      streamReady = false;
      lostSeq = -1;
      unwatch?.();
      unwatch = null;
      setIsReady(false);
      setStatus('starting');
      setCameraIssue(null); // a stale error must not survive a new attempt
      if (!releaseHold) releaseHold = holdAwake();
      stopStream(); // iOS will not hand out a second camera while the first is open (the mic track is kept)

      const bad = checkEnvironment({
        secure: window.isSecureContext !== false,
        hasMediaDevices: typeof navigator.mediaDevices?.getUserMedia === 'function',
      });
      if (bad) {
        showIssue(bad);
        return;
      }

      acquiringRef.current = true;
      try {
        const wantAudio = !micDecided && audioWantedRef.current;
        lastWithAudio = wantAudio;
        let stream: MediaStream;
        try {
          stream = await getStream(wanted, wantAudio);
        } catch (err) {
          if (!isActive || seq !== openSeq) return;
          if (!wantAudio) throw err;
          const plan = planAudioFallback({ errName: errorName(err), cameraState: await queryPermission('camera', navigator.permissions), withAudio: true });
          if (!isActive || seq !== openSeq) return;
          if (plan === 'video-only') {
            micDecided = true;
            setMicStatus('unavailable');
            stream = await getStream(wanted, false); // a failure here is about the camera itself: falls to the outer catch
          } else if (plan === 'offer') {
            fail(err, true); // shown with "continue without microphone"; we never re-prompt on our own
            return;
          } else {
            throw err;
          }
        }
        const video = videoRef.current;
        if (!video || !isActive || seq !== openSeq) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (wantAudio) micDecided = true;
        const aTrack = stream.getAudioTracks()[0];
        if (aTrack) adoptAudio(aTrack);
        else if (wantAudio) setMicStatus('unavailable');

        const vTracks = stream.getVideoTracks();
        const actual = resolveFacing(wanted, vTracks[0]?.getSettings().facingMode);
        setActiveFacing(actual);
        statsRef.current.cameraFps = vTracks[0]?.getSettings().frameRate ?? 0; // 0 = the browser does not report it

        liveStream = new MediaStream(vTracks);
        setCameraIssue(null);
        video.srcObject = liveStream;
        video.play().catch((e) => console.warn('video.play() was refused', e));
        video.onloadeddata = () => {
          if (!isActive || seq !== openSeq) return;
          streamReady = true;
          tryGo();
        };

        // Watch this stream for the OS taking the camera away (iOS backgrounding ends or mutes it).
        const track = vTracks[0];
        if (track) {
          const onEnded = () => markLost(seq);
          const onMute = () => recheck(seq);
          const onUnmute = () => {
            // A muted track that comes back: resume without asking the person to do anything.
            if (seq === openSeq && lostSeq === seq && track.readyState === 'live') {
              lostSeq = -1;
              streamReady = true;
              tryGo();
            }
          };
          track.addEventListener('ended', onEnded);
          track.addEventListener('mute', onMute);
          track.addEventListener('unmute', onUnmute);
          unwatch = () => {
            track.removeEventListener('ended', onEnded);
            track.removeEventListener('mute', onMute);
            track.removeEventListener('unmute', onUnmute);
          };
        }

        navigator.mediaDevices
          .enumerateDevices()
          .then((d) => isActive && setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1))
          .catch(() => {});
      } catch (err) {
        if (isActive && seq === openSeq) fail(err);
      } finally {
        if (seq === openSeq) acquiringRef.current = false;
      }
    };
    openCameraRef.current = openCamera;

    // Back from another app, or the phone was turned: the stream may have died or frozen while we were away.
    const onReturn = () => {
      if (document.visibilityState === 'hidden') return;
      later(() => recheck(openSeq), 800);
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('orientationchange', onReturn);
    window.addEventListener('pageshow', onReturn);

    enableMicRef.current = async () => {
      if (!isActive || audioTrack || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        const t = s.getAudioTracks()[0];
        if (!isActive || !t) {
          s.getTracks().forEach((x) => x.stop());
          return;
        }
        micDecided = true;
        adoptAudio(t);
      } catch (e) {
        console.warn('Microphone not available:', e);
        if (isActive) setMicStatus('unavailable');
      }
    };

    const setup = async () => {
      // The camera request goes out first so the permission prompt appears at once on the tap;
      // the models load meanwhile. Frames start when both are ready (tryGo).
      openCamera();
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
        modelsReady = true;
        tryGo();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        if (isActive) {
          modelsFailedRef.current = true;
          dropHold();
          setStatus('error');
          setModelError(`Failed to load ${loading ?? (face && !hands ? 'face' : 'hand')} tracking: ${err.message}`);
        }
      }
    };

    const tick = () => {
      if (!videoRef.current || !isActive) return;
      const handLm = handLandmarkerRef.current;
      const faceLm = faceLandmarkerRef.current;

      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        if (lastNow) avgDt = updateAvgDt(avgDt, now - lastNow);
        lastNow = now;
        alternating = nextAlternating(alternating, avgDt, !!handLm && !!faceLm);
        const runHand = !!handLm && (!alternating || tickIndex % 2 === 0);
        tickIndex++;

        try {
          const t0 = performance.now();
          const handResult = runHand ? handLm!.detectForVideo(video, now) : null;
          const t1 = performance.now();
          const faceResult = faceLm ? faceLm.detectForVideo(video, now) : null;
          const t2 = performance.now();
          const prev = frameRef.current;
          const next = buildFrame(prev, handResult, faceResult, now, {
            confidence: settingsRef.current.confidence,
            smoothingAlpha: settingsRef.current.smoothingAlpha,
            faceFilter: faceFilterRef.current,
          });
          if (handLm && !runHand && prev) { next.hands = prev.hands; next.left = prev.left; next.right = prev.right; } // alternate tick: reuse
          frameRef.current = next;
          const st = statsRef.current;
          st.trackFps = meter.tick(now);
          if (runHand) { st.handMs = ema(st.handMs, t1 - t0); st.handFps = handMeter.tick(now); }
          if (faceLm) st.faceMs = ema(st.faceMs, t2 - t1);
          st.tickMs = ema(st.tickMs, performance.now() - t0);
          st.alternating = alternating;
          st.hands = next.hands.length;
          st.face = !!next.face;
          historyRef.current.push({ ms: performance.now() - t0, hands: next.hands.length, handRan: runHand });
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
      enableMicRef.current = null;
      requestedRef.current = null;
      acquiringRef.current = false;
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('orientationchange', onReturn);
      window.removeEventListener('pageshow', onReturn);
      timers.forEach(clearTimeout);
      timers.clear();
      unwatch?.();
      releaseIdle();
      dropHold();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      closeAll();
      stopStream();
      dropAudio();
    };
  }, [videoRef, hands, face, idlePaused, attempt, enabled]);

  // Flipping the camera reopens the stream only; the models and the mic stay as they are.
  useEffect(() => {
    if (requestedRef.current !== null && requestedRef.current !== facing) openCameraRef.current?.();
  }, [facing]);

  const error = cameraIssue ? issueSentence(cameraIssue) : modelError;
  return {
    frameRef, isReady, error, retry, activeFacing, canFlip, delegate, statsRef, historyRef, setSmoothing, setConfidence, setFaceSmoothing,
    status, cameraIssue, modelError, micStatus, audioStreamRef, resumeCamera, enableMic, skipMic,
  };
}
