
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState } from 'react';
import { ArrowLeft, User, Eye, Smile, ScanFace, Video, VideoOff, Maximize2, Minimize2 } from 'lucide-react';
import { useTracker } from '../hooks/useTracker';
import { INITIAL_PUPPET_STATE, stepPuppetState } from './face/puppetState';
import { frameToCapture } from './face/captureFrame';
import { useRecorder } from '../hooks/useRecorder';
import RecorderControls from './RecorderControls';
import { drawPuppet } from './face/FaceMeshRenderer';
import { Landmark } from './shared/trackerTypes';
import { renderTakeToVideo } from './face/exportVideo';
import { buildPackZip, takeStamp } from './face/exportPack';
import { downloadBlob, extensionForMime } from './shared/download';
import { FrameData } from '../types';
import { holdAwake } from './shared/idle';

interface FaceDemoProps {
  onBack: () => void;
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

const FaceDemo: React.FC<FaceDemoProps> = ({ onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [faceSmoothing, setFaceSmoothing] = useState(0.5);
  const { frameRef, isReady: isCameraReady, error } = useTracker(videoRef, { hands: true, face: true, faceSmoothing });
  const [browBoost, setBrowBoost] = useState(0.5);
  const [jawBoost, setJawBoost] = useState(0.75);
  const puppetStateRef = useRef(INITIAL_PUPPET_STATE);
  const videoAspectRef = useRef(4 / 3);

  // Recorder Hook
  const recorder = useRecorder('FACE');

  const [blendshapes, setBlendshapes] = useState<Record<string, number>>({});
  const lastBlendMsRef = useRef(0);
  const [showPip, setShowPip] = useState<boolean>(true);
  const [showGazeRays, setShowGazeRays] = useState<boolean>(false);
  const [showMocapDots, setShowMocapDots] = useState<boolean>(false);

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
      const pipCtx = pipCanvasRef.current?.getContext('2d');

      const render = () => {
          const canvas = canvasRef.current;
          const video = videoRef.current;

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

              if (exportFrameRef.current) {
                  currentLandmarks = exportFrameRef.current.faceLandmarks;
                  currentBlendshapesRecord = exportFrameRef.current.blendshapes || {};
                  currentHands = exportFrameRef.current.landmarks ?? [];
              }
              // If Playing, read from buffer
              else if (recorder.isPlaying) {
                  const frame = recorder.getPlaybackFrame();
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
                  const cap = frameToCapture(frameRef.current);
                  currentHands = cap?.landmarks ?? [];
                  if (cap?.faceLandmarks) {
                      currentLandmarks = cap.faceLandmarks;
                      currentBlendshapesRecord = cap.blendshapes ?? {};
                  }

                  // RECORDING LOGIC (filtered landmarks, see recordingSchema capture notes)
                  if (recorder.isRecording && cap) recorder.captureFrame(cap);

                  // Render PiP Webcam canvas if enabled
                  if (showPip && pipCanvasRef.current && pipCtx) {
                      const pipC = pipCanvasRef.current;
                      if (pipC.width !== 192 || pipC.height !== 128) {
                          pipC.width = 192;
                          pipC.height = 128;
                      }
                      pipCtx.save();
                      pipCtx.scale(-1, 1);
                      pipCtx.translate(-192, 0);
                      pipCtx.drawImage(video, 0, 0, 192, 128);
                      pipCtx.restore();
                  }
              }

              // A recorded take uses its own camera aspect (imports included);
              // live view uses the live camera's.
              const aspect = exportFrameRef.current || recorder.isPlaying ? takeAspect() : videoAspectRef.current;

              puppetStateRef.current = stepPuppetState(puppetStateRef.current, currentLandmarks, currentBlendshapesRecord, aspect);

              // Render Stylized Puppet Character
              drawPuppet(ctx, { face: currentLandmarks ?? null, hands: currentHands, state: puppetStateRef.current }, w, h, {
                  showGazeRays,
                  showMocapDots,
                  videoAspect: aspect,
                  browBoost,
                  jawBoost,
              });
              // Live view only: a hands-only playback/export frame should look
              // the same on stage as it does in the exported video.
              if (!currentLandmarks && !exportFrameRef.current && !recorder.isPlaying) {
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
  }, [isCameraReady, recorder.isRecording, recorder.isPlaying, showPip, showGazeRays, showMocapDots, browBoost, jawBoost]);

  // Exports render in real time: keep the idle auto-pause away meanwhile.
  const exporting = exportState !== null;
  useEffect(() => (exporting ? holdAwake() : undefined), [exporting]);

  // Leaving the demo mid-export cancels it (releases the recorder, audio graph and stream).
  useEffect(() => () => exportAbortRef.current?.abort(), []);

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
                  exportFrameRef.current = frame;
                  const face = frame.faceLandmarks ?? null;
                  state = stepPuppetState(state, face, frame.blendshapes, aspect);
                  drawPuppet(ctx, { face, hands: frame.landmarks ?? [], state }, w, h, { showGazeRays, showMocapDots, videoAspect: aspect, browBoost, jawBoost });
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
      }
  };

  return (
    <div className="relative w-full h-full bg-[#090A0C] flex flex-col md:flex-row select-none">
       {/* Top Header */}
       <div className="absolute top-0 left-0 z-50 p-4 w-full flex justify-between items-center bg-gradient-to-b from-[#090A0C]/90 to-transparent pointer-events-none">
         <div className="flex items-center gap-3 pointer-events-auto">
           <button onClick={onBack} className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3.5 py-1.5 rounded-lg border border-white/15 transition-all text-xs font-mono text-white cursor-pointer">
             <ArrowLeft size={14} /> Hub
           </button>
           <span className="text-xs font-mono tracking-wider text-gray-300 border-l border-white/15 pl-3">
             Face Puppet &amp; Expressions
           </span>
         </div>

         {/* Puppet Display Toggles */}
         <div className="flex items-center gap-2 pointer-events-auto bg-[#111317]/80 backdrop-blur-md border border-white/10 px-2 py-1 rounded-lg text-[11px] font-mono">
             <button
                 onClick={() => setShowGazeRays(!showGazeRays)}
                 disabled={exportState !== null}
                 title={exportState ? 'Locked while exporting (the export uses the value from its start)' : undefined}
                 className={`px-2 py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showGazeRays ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 GAZE RAYS
             </button>
             <button
                 onClick={() => setShowMocapDots(!showMocapDots)}
                 disabled={exportState !== null}
                 title={exportState ? 'Locked while exporting (the export uses the value from its start)' : undefined}
                 className={`px-2 py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showMocapDots ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 MOCAP DOTS
             </button>
             <button
                 onClick={() => setShowPip(!showPip)}
                 className={`px-2 py-0.5 rounded transition-colors ${showPip ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 CAMERA PIP
             </button>
         </div>
      </div>

      {/* Main Canvas View */}
      <div className="flex-1 relative bg-[#090A0C] flex items-center justify-center overflow-hidden">
          {!isCameraReady && !recorder.isPlaying && (
              <div className="text-white/70 animate-pulse flex flex-col items-center">
                  <ScanFace size={40} className="mb-3 text-[#EE3B2B]" />
                  <p className="font-mono text-xs tracking-wider">INITIALIZING 478-POINT FACIAL MATRIX...</p>
              </div>
          )}
          {error && <p className="text-[#EE3B2B] font-mono text-xs">{error}</p>}

          <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-px h-px" autoPlay playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          
          {/* Picture-in-Picture Webcam (Minimized to bottom corner) */}
          {showPip && (
              <div className="absolute bottom-8 left-8 z-30 pointer-events-auto bg-[#111317]/90 border border-white/15 rounded-lg p-2 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 pb-1.5 mb-1 border-b border-white/10">
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
                  <canvas ref={pipCanvasRef} className="w-48 h-32 rounded bg-black object-cover" />
              </div>
          )}

          {exportState && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-3 bg-[#111317]/95 border border-white/15 rounded-lg px-3 py-2 font-mono text-[11px] text-gray-200 shadow-2xl">
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
          <div className="absolute bottom-8 right-8 pointer-events-auto z-30">
               <RecorderControls 
                  isRecording={recorder.isRecording}
                  isPlaying={recorder.isPlaying}
                  isPaused={recorder.isPaused}
                  hasData={recorder.hasData}
                  frameCount={recorder.frameCount}
                  hasAudio={recorder.hasAudio}
                  durationMs={recorder.durationMs}
                  getPlaybackTimeMs={recorder.getPlaybackTimeMs}
                  onScrubStart={recorder.beginScrub}
                  onScrub={recorder.scrubTo}
                  onScrubEnd={recorder.endScrub}
                  onRecord={recorder.startRecording}
                  onStop={recorder.stopRecording}
                  onPlayToggle={recorder.togglePlayback}
                  onStopPlayback={recorder.stopPlayback}
                  onExport={recorder.exportData}
                  onImport={recorder.loadData}
                  // Also locks exports while recording (Stop Recording ignores busy).
                  busy={exportState !== null || recorder.isRecording}
                  primaryExport={{ label: 'Video', onSelect: () => runExport('video') }}
                  extraExports={[
                      { id: 'video', label: 'Video', hint: 'Puppet + your voice, as it plays', onSelect: () => runExport('video') },
                      { id: 'pack', label: 'Pack (.zip)', hint: 'Video + recording.json + audio', onSelect: () => runExport('pack') },
                  ]}
               />
          </div>
      </div>

      {/* Sidebar Controls */}
      <div className="w-full md:w-80 bg-[#0E1013] border-l border-white/10 p-5 flex flex-col overflow-y-auto shadow-2xl z-20 font-mono">
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
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]"
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
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]"
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
                     className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]"
                     title="How readily the teeth part and the jaw drops when you talk."
                 />
                 <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                     <span>RAW</span><span>EXAGGERATED</span>
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
    </div>
  );
};

export default FaceDemo;
