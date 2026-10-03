
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { User, Eye, Smile, ScanFace, Video, VideoOff, Maximize2, Minimize2, X } from 'lucide-react';
import { useTracker } from '../hooks/useTracker';
import { useIsPhone } from '../hooks/useIsPhone';
import { PermState, planStart, readPermissions } from '../hooks/cameraAccess';
import PhoneBar from './PhoneBar';
import DemoSwitcher from './DemoSwitcher';
import { StartCard, IssueCard, LostCard, MicNote } from './CameraPanels';
import { AppMode } from '../types';
import DebugReadout from './DebugReadout';
import { pipDims } from './face/pipSize';
import { createFpsMeter } from './shared/fpsMeter';
import { Facing } from '../hooks/cameraSupport';
import { INITIAL_PUPPET_STATE, stepPuppetState } from './face/puppetState';
import { frameToCapture } from './face/captureFrame';
import { viewFrame } from './shared/mirrorFrame';
import { useRecorder, findFrameIndex } from '../hooks/useRecorder';
import PlaybackOptions from './PlaybackOptions';
import { useCleanedFrames, useCleanupPrefs } from '../hooks/useCleanedFrames';
import { FRONT_VIEW, OrbitView } from './face/orbitState';
import { useOrbitInput } from '../hooks/useOrbitInput';
import { useTakeDepth } from '../hooks/useTakeDepth';
import RecorderControls from './RecorderControls';
import SaveLink from './SaveLink';
import { useSaveLink } from '../hooks/useSaveLink';
import { drawPuppet, disposePuppet } from './face/FaceMeshRenderer';
import { MeshDetail } from './face/faceGeometry';
import { Landmark } from './shared/trackerTypes';
import { renderTakeToVideo } from './face/exportVideo';
import { buildPackZip, takeStamp } from './face/exportPack';
import { downloadBlob, extensionForMime } from './shared/download';
import { FrameData } from '../types';
import { holdAwake } from './shared/idle';

interface FaceDemoProps {
  onSelectMode: (mode: AppMode) => void;
}

// Key Blendshapes to visualize (out of 52 available) - Monochromatic NASA spec
const DISPLAY_BLENDSHAPES = [
    { key: 'jawOpen', label: 'Jaw Open' },
    { key: 'mouthSmileLeft', label: 'Smile Left' },
    { key: 'mouthSmileRight', label: 'Smile Right' },
    { key: 'eyeBlinkLeft', label: 'Blink Left' },
    { key: 'eyeBlinkRight', label: 'Blink Right' },
    { key: 'browInnerUp', label: 'Brow Raise' },
    { key: 'eyeLookUp', label: 'Look Up' },
];

const FaceDemo: React.FC<FaceDemoProps> = ({ onSelectMode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [faceSmoothing, setFaceSmoothing] = useState(0.5);
  const [facing, setFacing] = useState<Facing>('user');

  // Permission flow: the camera (and, if wanted, the microphone in the SAME request) starts from one tap on the
  // start card. If the browser already granted everything the start would ask for, skip the card (no prompt can appear).
  const [started, setStarted] = useState(false);
  const [micWanted, setMicWanted] = useState(true);
  const [perms, setPerms] = useState<{ camera: PermState; microphone: PermState } | null>(null);
  useEffect(() => {
    let alive = true;
    readPermissions(typeof navigator !== 'undefined' ? navigator.permissions : null).then((p) => {
      if (!alive) return;
      setPerms(p);
      if (planStart({ ...p, wantMic: true }).autoStart) setStarted(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const micBlocked = perms?.microphone === 'denied';
  const askForMic = micWanted && !micBlocked;

  const {
    frameRef, isReady: isCameraReady, retry, activeFacing, canFlip, delegate, statsRef,
    status, cameraIssue, modelError, micStatus, audioStreamRef, enableMic, skipMic,
  } = useTracker(videoRef, { hands: true, face: true, faceSmoothing, facing, enabled: started, audio: askForMic });
  const error = modelError; // camera problems have their own card (cameraIssue)
  const soundOn = micStatus === 'on';
  const [browBoost, setBrowBoost] = useState(0.5);
  const [jawBoost, setJawBoost] = useState(0.75);
  const [blinkBoost, setBlinkBoost] = useState(0.5);
  const [creaseAngle, setCreaseAngle] = useState(35);
  const [meshDetail, setMeshDetail] = useState<MeshDetail>('low');
  const puppetStateRef = useRef(INITIAL_PUPPET_STATE);
  const videoAspectRef = useRef(4 / 3);

  // Recorder Hook
  const recorder = useRecorder('FACE', audioStreamRef); // takes use the mic the camera request already got: no prompt on Record

  // Cleanup is a playback layer: it never touches the buffer, the exports or the upload (all raw).
  const [cleanupPrefs, setCleanupPrefs] = useCleanupPrefs();
  const cleaned = useCleanedFrames(
    recorder.getFrames(),
    `${recorder.frameCount}:${recorder.durationMs}`,
    cleanupPrefs.enabled && recorder.hasData && !recorder.isRecording,
    cleanupPrefs.strength,
  );
  const playFramesRef = useRef<FrameData[]>([]);
  playFramesRef.current = cleaned.frames; // read by the render loop, whose effect does not re-run on a toggle

  // Orbit is a playback-only camera: live view, exports and the upload never see it.
  const [orbitOn, setOrbitOn] = useState(false);
  const orbitViewRef = useRef<OrbitView>(FRONT_VIEW);
  const orbitOnRef = useRef(false);
  orbitOnRef.current = orbitOn;
  useOrbitInput(canvasRef, orbitOn && recorder.isPlaying, orbitViewRef);
  const depthAspect = (() => { const s = recorder.getVideoSize(); return s ? s.width / s.height : 4 / 3; })();
  const depth = useTakeDepth(cleaned.frames, depthAspect, orbitOn && recorder.isPlaying);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  useEffect(() => { if (!recorder.isPlaying) orbitViewRef.current = FRONT_VIEW; }, [recorder.isPlaying]);

  // Save & get link state lives here, not in SaveLink: rotating a phone remounts the recorder panel (drawer <-> desktop).
  const saveLink = useSaveLink(() => recorder.buildRecordingBlob('full'), `${recorder.frameCount}:${recorder.durationMs}`);

  // The camera died mid-take (OS or another app): end the take cleanly and keep what was captured.
  const [takeCut, setTakeCut] = useState(false);
  useEffect(() => {
    if (status === 'lost' && recorder.isRecording) {
      recorder.stopRecording();
      setTakeCut(true);
    } else if (status !== 'lost') {
      setTakeCut(false);
    }
  }, [status, recorder.isRecording]);

  const [blendshapes, setBlendshapes] = useState<Record<string, number>>({});
  const lastBlendMsRef = useRef(0);
  const [showPip, setShowPip] = useState<boolean>(true);
  const [showGazeRays, setShowGazeRays] = useState<boolean>(false);
  const [showMocapDots, setShowMocapDots] = useState<boolean>(false);
  const isPhone = useIsPhone();
  const [controlsOpen, setControlsOpen] = useState(false);

  // Read by the render loop (its effect does not re-run when these change).
  const activeFacingRef = useRef<Facing>('user');
  activeFacingRef.current = activeFacing;
  const isPhoneRef = useRef(false);
  isPhoneRef.current = isPhone;
  // Initial PiP size (before the camera reports its aspect), so it is not a default 300x150 canvas.
  const pipInitRef = useRef(pipDims(4 / 3, isPhone ? 112 : 192));
  const renderMeterRef = useRef(createFpsMeter());
  const renderFpsRef = useRef(0);

  const debug = useMemo(() => new URLSearchParams(window.location.search).has('debug'), []);
  const debugLine = useCallback(() => {
    const v = videoRef.current;
    return [
      `render ${renderFpsRef.current.toFixed(0)} fps`,
      `track ${statsRef.current.trackFps.toFixed(0)} fps`,
      statsRef.current.delegate ?? 'no-delegate',
      v ? `${v.videoWidth}x${v.videoHeight}` : 'no-video',
      activeFacingRef.current === 'environment' ? 'rear' : 'front',
      `dpr ${window.devicePixelRatio}`,
    ].join(' | ');
  }, [statsRef]);

  const [exportState, setExportState] = useState<{ kind: 'video' | 'pack'; ms: number } | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportFrameRef = useRef<FrameData | null>(null);

  /** The take's saved camera aspect, else the current camera's. */
  const takeAspect = () => {
      const size = recorder.getVideoSize();
      return size ? size.width / size.height : videoAspectRef.current;
  };

  useEffect(() => {
      let animationFrameId: number;
      const ctx = canvasRef.current?.getContext('2d');

      const render = () => {
          const canvas = canvasRef.current;
          const video = videoRef.current;

          renderFpsRef.current = renderMeterRef.current.tick(performance.now());

          if (canvas && ctx) {
              // Set responsive resolution
              const container = canvas.parentElement;
              if (container) {
                  const targetW = container.clientWidth;
                  const targetH = container.clientHeight;
                  if (canvas.width !== targetW || canvas.height !== targetH) {
                      canvas.width = targetW;
                      canvas.height = targetH;
                  }
              }

              const w = canvas.width;
              const h = canvas.height;

              // Determine Data Source
              let currentLandmarks: Landmark[] | undefined;
              let currentBlendshapesRecord: Record<string, number> = {};
              let currentHands: Landmark[][] = [];
              let playIdx = -1;

              if (exportFrameRef.current) {
                  currentLandmarks = exportFrameRef.current.faceLandmarks;
                  currentBlendshapesRecord = exportFrameRef.current.blendshapes || {};
                  currentHands = exportFrameRef.current.landmarks ?? [];
              }
              // If Playing, read from buffer
              else if (recorder.isPlaying) {
                  const rawFrame = recorder.getPlaybackFrame(); // also advances the loop and the clock
                  const pf = playFramesRef.current;
                  playIdx = pf.length > 0 ? findFrameIndex(pf, recorder.getPlaybackTimeMs()) : -1;
                  const frame = playIdx >= 0 ? pf[playIdx] : rawFrame;
                  if (frame) {
                      currentLandmarks = frame.faceLandmarks;
                      currentBlendshapesRecord = frame.blendshapes || {};
                      currentHands = frame.landmarks ?? [];
                  }
              }
              // Else, read from Live MediaPipe
              else if (isCameraReady && video && video.readyState >= 2) {
                  if (video.videoWidth > 0) {
                      videoAspectRef.current = video.videoWidth / video.videoHeight;
                      // Saved with the take (v3 capture.video) so playback/export use its aspect.
                      if (recorder.isRecording) recorder.setVideoSize(video.videoWidth, video.videoHeight);
                  }
                  // Hands are captured even when the face drops (a hand over the face).
                  // Tracked data is raw for both cameras; only the DISPLAY follows the viewfinder
                  // (the rear camera mirrors the live puppet). Recording always gets the raw capture.
                  const raw = frameRef.current;
                  const capRaw = frameToCapture(raw);
                  const capView = activeFacingRef.current === 'environment' ? frameToCapture(viewFrame(raw, 'environment')) : capRaw;
                  currentHands = capView?.landmarks ?? [];
                  if (capView?.faceLandmarks) {
                      currentLandmarks = capView.faceLandmarks;
                      currentBlendshapesRecord = capView.blendshapes ?? {};
                  }

                  // RECORDING LOGIC (raw filtered landmarks, see recordingSchema capture notes)
                  if (recorder.isRecording && capRaw) recorder.captureFrame(capRaw);

                  // Render PiP Webcam canvas if enabled
                  const pipCtx = pipCanvasRef.current?.getContext('2d');
                  if (showPip && pipCanvasRef.current && pipCtx) {
                      const pipC = pipCanvasRef.current;
                      const { w: pw, h: ph } = pipDims(videoAspectRef.current, isPhoneRef.current ? 112 : 192);
                      if (pipC.width !== pw || pipC.height !== ph) {
                          pipC.width = pw;
                          pipC.height = ph;
                          pipC.style.width = `${pw}px`;
                          pipC.style.height = `${ph}px`;
                      }
                      pipCtx.save();
                      // The front camera is shown as a mirror; the rear camera as a window.
                      if (activeFacingRef.current === 'user') {
                          pipCtx.scale(-1, 1);
                          pipCtx.translate(-pw, 0);
                      }
                      pipCtx.drawImage(video, 0, 0, pw, ph);
                      pipCtx.restore();
                  }
              }

              // A recorded take uses its own camera aspect (imports included);
              // live view uses the live camera's.
              const aspect = exportFrameRef.current || recorder.isPlaying ? takeAspect() : videoAspectRef.current;

              puppetStateRef.current = stepPuppetState(puppetStateRef.current, currentLandmarks, currentBlendshapesRecord, aspect, blinkBoost);

              // Render Stylized Puppet Character
              const orbiting = orbitOnRef.current && recorder.isPlaying && !exportFrameRef.current;
              drawPuppet(ctx, { face: currentLandmarks ?? null, hands: currentHands, state: puppetStateRef.current, handR: orbiting && playIdx >= 0 ? depthRef.current.handR[playIdx] : undefined }, w, h, {
                  showGazeRays,
                  showMocapDots,
                  videoAspect: aspect,
                  browBoost,
                  jawBoost,
                  blinkBoost,
                  creaseAngle,
                  meshDetail,
                  view: orbiting ? { ...orbitViewRef.current, pivot: depthRef.current.pivot } : null,
              });
              // Live view only: a hands-only playback/export frame should look
              // the same on stage as it does in the exported video.
              if (!currentLandmarks && !exportFrameRef.current && !recorder.isPlaying && isCameraReady) {
                  ctx.fillStyle = '#4B5563';
                  ctx.font = '12px monospace';
                  ctx.textAlign = 'center';
                  ctx.fillText('WAITING FOR A FACE...', w / 2, h / 2);
              }

              // Update React UI state
              // 10 Hz: sidebar readout, not the render path
              const nowMs = performance.now();
              if (nowMs - lastBlendMsRef.current >= 100) {
                  lastBlendMsRef.current = nowMs;
                  setBlendshapes(currentBlendshapesRecord);
              }
          }
          animationFrameId = requestAnimationFrame(render);
      };
      render();

      return () => cancelAnimationFrame(animationFrameId);
  }, [isCameraReady, recorder.isRecording, recorder.isPlaying, showPip, showGazeRays, showMocapDots, browBoost, jawBoost, blinkBoost, creaseAngle, meshDetail]);

  // Exports render in real time: keep the idle auto-pause away meanwhile.
  const exporting = exportState !== null;
  useEffect(() => (exporting ? holdAwake() : undefined), [exporting]);

  // Leaving the demo mid-export cancels it (releases the recorder, audio graph and stream).
  useEffect(() => () => exportAbortRef.current?.abort(), []);

  // Leaving the demo releases the stage's WebGL context (ref captured per React's
  // ref-in-cleanup guidance: the ref may be cleared by the time cleanup runs).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return () => disposePuppet(canvas);
  }, []);

  const runExport = async (kind: 'video' | 'pack') => {
      const stage = canvasRef.current;
      if (!recorder.hasData || !stage || exportAbortRef.current || recorder.isRecording) return;
      recorder.stopPlayback();

      const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
      const width = even(Math.min(stage.width, 1280));
      const height = even((width * stage.height) / stage.width);
      const ctrl = new AbortController();
      exportAbortRef.current = ctrl;
      setExportState({ kind, ms: 0 });

      let state = INITIAL_PUPPET_STATE;
      let lastProgress = 0;
      let exportCanvas: HTMLCanvasElement | null = null;
      const aspect = takeAspect(); // fixed for the whole export
      try {
          const audio = recorder.getAudio();
          const video = await renderTakeToVideo({
              frames: recorder.getFrames(),
              durationMs: recorder.durationMs,
              audio,
              width,
              height,
              signal: ctrl.signal,
              draw: (ctx, frame, w, h) => {
                  exportCanvas = ctx.canvas as HTMLCanvasElement;
                  exportFrameRef.current = frame;
                  const face = frame.faceLandmarks ?? null;
                  state = stepPuppetState(state, face, frame.blendshapes, aspect, blinkBoost);
                  drawPuppet(ctx, { face, hands: frame.landmarks ?? [], state }, w, h, { showGazeRays, showMocapDots, videoAspect: aspect, browBoost, jawBoost, blinkBoost, creaseAngle, meshDetail });
              },
              onProgress: (ms) => {
                  const now = performance.now();
                  if (now - lastProgress >= 100) { lastProgress = now; setExportState({ kind, ms }); }
              },
          });

          const stamp = takeStamp(new Date());
          if (kind === 'video') {
              downloadBlob(video.blob, `puppet-take-${stamp}.${extensionForMime(video.mimeType)}`);
          } else {
              const recordingJson = await recorder.buildRecordingBlob('full');
              const zip = await buildPackZip({ video, recordingJson, audio });
              downloadBlob(new Blob([zip], { type: 'application/zip' }), `puppet-take-${stamp}.zip`);
          }
      } catch (err: any) {
          if (err?.name !== 'AbortError') alert(`Export failed: ${err?.message ?? err}`);
      } finally {
          exportAbortRef.current = null;
          exportFrameRef.current = null;
          setExportState(null);
          if (exportCanvas) disposePuppet(exportCanvas);
      }
  };

  // Display toggles: header on desktop, inside the Controls drawer on phones.
  const displayToggles = (
         <div className="flex items-center gap-2 pointer-events-auto bg-[#111317]/80 backdrop-blur-md border border-white/10 px-2 py-1 rounded-lg text-[11px] font-mono">
             <button
                 onClick={() => setShowGazeRays(!showGazeRays)}
                 disabled={exportState !== null}
                 title={exportState ? 'Locked while exporting (the export uses the value from its start)' : undefined}
                 className={`min-h-[44px] px-3 md:min-h-0 md:px-2 md:py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showGazeRays ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 GAZE RAYS
             </button>
             <button
                 onClick={() => setShowMocapDots(!showMocapDots)}
                 disabled={exportState !== null}
                 title={exportState ? 'Locked while exporting (the export uses the value from its start)' : undefined}
                 className={`min-h-[44px] px-3 md:min-h-0 md:px-2 md:py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showMocapDots ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 MOCAP DOTS
             </button>
             <button
                 onClick={() => setShowPip(!showPip)}
                 className={`min-h-[44px] px-3 md:min-h-0 md:px-2 md:py-0.5 rounded transition-colors ${showPip ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 CAMERA PIP
             </button>
         </div>
  );

  // One props object so the desktop panel, the phone drawer and the phone bar share it.
  const recorderProps = {
    isRecording: recorder.isRecording,
    isPlaying: recorder.isPlaying,
    isPaused: recorder.isPaused,
    hasData: recorder.hasData,
    frameCount: recorder.frameCount,
    hasAudio: recorder.hasAudio,
    durationMs: recorder.durationMs,
    getPlaybackTimeMs: recorder.getPlaybackTimeMs,
    onScrubStart: recorder.beginScrub,
    onScrub: recorder.scrubTo,
    onScrubEnd: recorder.endScrub,
    onRecord: () => { if (isCameraReady) recorder.startRecording(); },
    recordDisabled: !isCameraReady,
    withAudio: soundOn,
    onStop: recorder.stopRecording,
    onPlayToggle: recorder.togglePlayback,
    onStopPlayback: recorder.stopPlayback,
    onExport: recorder.exportData,
    onImport: recorder.loadData,
    // Also locks exports while recording (Stop Recording ignores busy).
    busy: exportState !== null || recorder.isRecording,
    primaryExport: { label: 'Video', onSelect: () => runExport('video') },
    extraExports: [
      { id: 'video', label: 'Video', hint: 'Puppet + your voice, as it plays', onSelect: () => runExport('video') },
      { id: 'pack', label: 'Pack (.zip)', hint: 'Video + recording.json + audio', onSelect: () => runExport('pack') },
    ],
    footer: (
      <>
        <PlaybackOptions
          cleanup={{
            enabled: cleanupPrefs.enabled,
            strength: cleanupPrefs.strength,
            report: cleaned.report,
            onEnabled: (enabled) => setCleanupPrefs({ enabled }),
            onStrength: (strength) => setCleanupPrefs({ strength }),
          }}
          orbit={{
            enabled: orbitOn,
            disabled: !recorder.hasData || recorder.isRecording || exportState !== null,
            onEnabled: (on) => { orbitViewRef.current = FRONT_VIEW; setOrbitOn(on); },
            onReset: () => { orbitViewRef.current = FRONT_VIEW; },
          }}
          disabled={!recorder.hasData || exportState !== null || recorder.isRecording}
        />
        <SaveLink
          state={saveLink}
          disabled={!recorder.hasData || exportState !== null || recorder.isRecording}
          hasAudio={recorder.hasAudio}
        />
      </>
    ),
  };

  return (
    <div className="relative w-full h-full bg-[#090A0C] flex flex-col md:flex-row select-none">
       {/* Top Header */}
       <div className="absolute top-0 left-0 z-50 p-3 md:p-4 w-full flex justify-between items-center bg-gradient-to-b from-[#090A0C]/90 to-transparent pointer-events-none">
         <div className="flex items-center gap-3 pointer-events-auto">
           <DemoSwitcher current="face" isPhone={isPhone} onSelect={onSelectMode} />
           <span className="hidden md:inline text-xs font-mono tracking-wider text-gray-300 border-l border-white/15 pl-3">
             Face Puppet &amp; Expressions
           </span>
         </div>

         {/* Puppet Display Toggles */}
         {!isPhone && displayToggles}
      </div>

      {/* Main Canvas View */}
      <div className="flex-1 min-h-0 mb-28 md:mb-0 relative bg-[#090A0C] flex items-center justify-center overflow-hidden">
          {started && status === 'starting' && !recorder.isPlaying && (
              <div data-testid="camera-starting" className="text-white/70 animate-pulse flex flex-col items-center px-6 text-center">
                  <ScanFace size={40} className="mb-3 text-[#EE3B2B]" />
                  <p className="font-mono text-xs tracking-wider">STARTING CAMERA...</p>
                  <p className="font-mono text-[10px] text-gray-500 mt-2">If your browser asks, choose Allow.</p>
              </div>
          )}
          {!started && perms !== null && !recorder.isPlaying && (
              <StartCard micWanted={micWanted} micBlocked={micBlocked} onMicChange={setMicWanted} onStart={() => setStarted(true)} />
          )}
          {cameraIssue && <IssueCard issue={cameraIssue} onRetry={retry} onSkipMic={() => { setMicWanted(false); skipMic(); }} />}
          {status === 'lost' && <LostCard onResume={retry} wasRecording={takeCut} />}
          {error && !cameraIssue && (
              <div className="absolute inset-x-4 top-20 md:top-16 z-40 mx-auto max-w-md pointer-events-auto flex flex-col items-center gap-3 bg-[#111317]/95 border border-[#EE3B2B]/40 rounded-lg p-4 text-center">
                  <p className="text-[#EE3B2B] font-mono text-xs leading-relaxed">{error}</p>
                  <button onClick={retry} className="min-h-[44px] px-6 rounded-lg bg-[#EE3B2B] text-white font-mono text-xs font-bold">Retry</button>
              </div>
          )}
          {!error && !cameraIssue && delegate === 'CPU' && (
              <p className="absolute top-14 left-1/2 -translate-x-1/2 z-30 font-mono text-[10px] text-amber-300/80 text-center px-4">
                  Compatibility mode (CPU tracking): it may run slower.
              </p>
          )}

          <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-px h-px" autoPlay playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          
          {/* Picture-in-Picture Webcam (Minimized to bottom corner) */}
          {showPip && started && !error && !cameraIssue && status !== 'lost' && (
              <div className="absolute top-16 right-3 md:top-auto md:right-auto md:bottom-8 md:left-8 z-30 pointer-events-auto bg-[#111317]/90 border border-white/15 rounded-lg p-1.5 md:p-2 shadow-2xl backdrop-blur-md">
                  <div className="hidden md:flex items-center justify-between text-[10px] font-mono text-gray-400 pb-1.5 mb-1 border-b border-white/10">
                      <span className="flex items-center gap-1.5 text-white font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#EE3B2B] animate-pulse" />
                          INPUT CAM
                      </span>
                      <button 
                          onClick={() => setShowPip(false)} 
                          className="hover:text-white"
                          title="Hide PIP"
                      >
                          <Minimize2 size={12} />
                      </button>
                  </div>
                  <canvas ref={pipCanvasRef} className="rounded bg-black block" width={pipInitRef.current.w} height={pipInitRef.current.h} />
              </div>
          )}

          {exportState && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-auto max-w-[92vw] flex-wrap justify-center flex items-center gap-3 bg-[#111317]/95 border border-white/15 rounded-lg px-3 py-2 font-mono text-[11px] text-gray-200 shadow-2xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EE3B2B] animate-pulse" />
                  <span>
                      RENDERING {exportState.kind === 'pack' ? 'PACK' : 'VIDEO'}{' '}
                      <span className="tabular-nums text-white">{(exportState.ms / 1000).toFixed(1)}s / {(recorder.durationMs / 1000).toFixed(1)}s</span>
                  </span>
                  <span className="text-gray-500">real time, keep this tab in front</span>
                  <button
                      onClick={() => exportAbortRef.current?.abort()}
                      className="px-2 py-0.5 rounded border border-white/20 hover:bg-white/10 text-white"
                  >
                      Cancel
                  </button>
              </div>
          )}

          {/* Recorder Controls Overlay */}
          {!isPhone && (
              <div className="absolute bottom-8 right-8 pointer-events-auto z-30">
                  <RecorderControls {...recorderProps} />
              </div>
          )}

          {started && isCameraReady && (
              <MicNote
                  status={micStatus === 'on' ? 'on' : micBlocked ? 'unavailable' : micStatus}
                  onEnable={() => { setMicWanted(true); enableMic(); }}
              />
          )}

          {debug && <DebugReadout getLine={debugLine} />}
      </div>

      {/* Sidebar Controls (desktop side panel; phone bottom drawer) */}
      <div
          data-testid="controls-drawer"
          className={`bg-[#0E1013] border-white/10 p-5 flex flex-col overflow-y-auto shadow-2xl font-mono
            fixed inset-x-0 bottom-28 z-40 max-h-[65dvh] rounded-t-xl border-t touch-pan-y overscroll-contain transition-transform duration-200
            ${controlsOpen ? 'translate-y-0' : 'translate-y-[130%] pointer-events-none'}
            md:static md:translate-y-0 md:pointer-events-auto md:w-80 md:max-h-none md:rounded-none md:border-t-0 md:border-l md:z-20`}
      >
          {isPhone && (
              <>
                  <div className="flex items-center justify-between mb-3">
                      <span className="text-white font-bold text-xs tracking-wider">CONTROLS</span>
                      <button aria-label="Close controls" onClick={() => setControlsOpen(false)} className="w-11 h-11 flex items-center justify-center text-gray-300">
                          <X size={18} />
                      </button>
                  </div>
                  <div className="mb-4">{displayToggles}</div>
                  <div className="mb-4">
                      <RecorderControls {...recorderProps} showTransport={false} />
                  </div>
              </>
          )}
          <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
              <span className="text-white font-bold text-xs tracking-wider flex items-center gap-2">
                  <Smile size={15} className="text-white" /> EXPRESSIONS &amp; BLENDSHAPES
              </span>
          </div>

          <div className="space-y-4">
             <div className="bg-[#15171C] p-3 rounded border border-white/10 text-[10px] text-gray-400 leading-relaxed">
                 Low-poly puppet driven by 478 face landmarks, 52 blendshapes, and both hands.
             </div>

             {/* Face Smoothing (One Euro minCutoff) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between text-[11px] text-gray-300 mb-1.5">
                     <span className="text-gray-400">Face Smoothing</span>
                     <span className="text-white font-bold tabular-nums">{Math.round(faceSmoothing * 100)}%</span>
                 </div>
                 <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.05}
                     value={faceSmoothing}
                     onChange={(e) => setFaceSmoothing(parseFloat(e.target.value))}
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B] pl-range"
                     title="Left: responsive, a little jitter. Right: calm, a little lag."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>LIGHT</span><span>HEAVY</span>
                 </div>
             </div>

             {/* Brow Boost (puppetState.boostBrows) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between text-[11px] text-gray-300 mb-1.5">
                     <span className="text-gray-400">Brow Boost</span>
                     <span className="text-white font-bold tabular-nums">{Math.round(browBoost * 100)}%</span>
                 </div>
                 <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.05}
                     value={browBoost}
                     onChange={(e) => setBrowBoost(parseFloat(e.target.value))}
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B] pl-range"
                     title="How far the puppet brows travel when you raise or lower yours."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>RAW</span><span>EXAGGERATED</span>
                 </div>
             </div>

             {/* Jaw Boost (puppetState.teethGap / boostJaw) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between text-[11px] text-gray-300 mb-1.5">
                     <span className="text-gray-400">Jaw Boost</span>
                     <span className="text-white font-bold tabular-nums">{Math.round(jawBoost * 100)}%</span>
                 </div>
                 <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.05}
                     value={jawBoost}
                     onChange={(e) => setJawBoost(parseFloat(e.target.value))}
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B] pl-range"
                     title="How readily the teeth part and the jaw drops when you talk."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>RAW</span><span>EXAGGERATED</span>
                 </div>
             </div>

             {/* Blink Boost (puppetState.boostBlink) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between text-[11px] text-gray-300 mb-1.5">
                     <span className="text-gray-400">Blink Boost</span>
                     <span className="text-white font-bold tabular-nums">{Math.round(blinkBoost * 100)}%</span>
                 </div>
                 <input
                     type="range"
                     min={0}
                     max={1}
                     step={0.05}
                     value={blinkBoost}
                     onChange={(e) => setBlinkBoost(parseFloat(e.target.value))}
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B] pl-range"
                     title="How far your blinks close the puppet's lids; real blinks snap shut."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>RAW</span><span>EXAGGERATED</span>
                 </div>
             </div>

             {/* Crease Angle (faceGeometry crease-angle normals) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between text-[11px] text-gray-300 mb-1.5">
                     <span className="text-gray-400">Crease Angle</span>
                     <span className="text-white font-bold tabular-nums">{creaseAngle}°</span>
                 </div>
                 <input
                     type="range"
                     min={0}
                     max={90}
                     step={5}
                     value={creaseAngle}
                     onChange={(e) => setCreaseAngle(parseFloat(e.target.value))}
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B] pl-range"
                     title="Edges sharper than this angle stay hard; softer ones are smoothed."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>FACETED</span><span>SMOOTH</span>
                 </div>
             </div>

             {/* Mesh detail (faceGeometry FACE_MESHES) */}
             <div className="bg-[#111317] p-2.5 rounded border border-white/5">
                 <div className="flex justify-between items-center text-[11px] text-gray-300">
                     <span className="text-gray-400">Mesh</span>
                     <div className="flex gap-1">
                         {(['low', 'full'] as const).map((d) => (
                             <button
                                 key={d}
                                 type="button"
                                 onClick={() => setMeshDetail(d)}
                                 className={`px-3 min-h-[44px] min-w-[56px] md:px-2 md:py-0.5 md:min-h-0 md:min-w-0 rounded text-[10px] font-bold tracking-wider ${meshDetail === d ? 'bg-[#EE3B2B] text-white' : 'bg-[#22242B] text-gray-400'}`}
                             >
                                 {d.toUpperCase()}
                             </button>
                         ))}
                     </div>
                 </div>
             </div>

             {/* Blendshape Bars */}
             <div className="space-y-2.5">
                 {DISPLAY_BLENDSHAPES.map((shape) => {
                     const value = blendshapes[shape.key] || 0;
                     const percent = (value * 100).toFixed(0);
                     const isActive = value > 0.35;
                     
                     return (
                         <div key={shape.key} className="bg-[#111317] p-2 rounded border border-white/5">
                             <div className="flex justify-between text-[11px] text-gray-300 mb-1">
                                 <span className={isActive ? 'text-white font-bold' : 'text-gray-400'}>{shape.label}</span>
                                 <span className={isActive ? 'text-[#EE3B2B] font-bold' : 'text-gray-400'}>{percent}%</span>
                             </div>
                             <div className="w-full h-1.5 bg-[#22242B] rounded-full overflow-hidden">
                                 <div 
                                    className={`h-full transition-all duration-75 ${isActive ? 'bg-[#EE3B2B]' : 'bg-white/70'}`}
                                    style={{ width: `${percent}%` }} 
                                 />
                             </div>
                         </div>
                     )
                 })}
             </div>

             {/* Head Pose & Orientation Readout */}
             <div className="mt-auto pt-4 border-t border-white/10">
                 <div className="text-[10px] uppercase text-gray-400 font-bold mb-2">Orientation Matrix</div>
                 <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-300">
                     <div className="bg-[#111317] p-2 rounded border border-white/5">
                         <div className="text-gray-500 text-[9px]">GAZE YAW</div>
                         <div className="text-white font-bold mt-0.5">
                             {(blendshapes['eyeLookOutRight'] || 0) > 0.4 ? "RIGHT" : (blendshapes['eyeLookInRight'] || 0) > 0.4 ? "LEFT" : "FORWARD"}
                         </div>
                     </div>
                     <div className="bg-[#111317] p-2 rounded border border-white/5">
                         <div className="text-gray-500 text-[9px]">MOUTH CAVITY</div>
                         <div className="text-white font-bold mt-0.5">
                             {(blendshapes['jawOpen'] || 0) > 0.25 ? "SPEAKING" : "RESTING"}
                         </div>
                     </div>
                 </div>
             </div>
          </div>
      </div>

      {isPhone && (
          <PhoneBar
              isRecording={recorder.isRecording}
              isPlaying={recorder.isPlaying}
              isPaused={recorder.isPaused}
              hasData={recorder.hasData}
              busy={exportState !== null || recorder.isRecording}
              canFlip={canFlip}
              controlsOpen={controlsOpen}
              onRecord={() => { if (isCameraReady) recorder.startRecording(); }}
              recordDisabled={!isCameraReady}
              withAudio={soundOn}
              onStop={recorder.stopRecording}
              onPlayToggle={recorder.togglePlayback}
              onStopPlayback={recorder.stopPlayback}
              flipDisabled={status === 'starting' || status === 'idle'}
              onFlip={() => {
                  if (recorder.isRecording || recorder.isPlaying || exportState !== null || status === 'starting' || status === 'idle') return;
                  setFacing((f) => (f === 'user' ? 'environment' : 'user'));
              }}
              onToggleControls={() => setControlsOpen((o) => !o)}
          />
      )}
    </div>
  );
};

export default FaceDemo;
