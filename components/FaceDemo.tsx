
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useState } from 'react';
import { ArrowLeft, User, Eye, Smile, ScanFace, Video, VideoOff, Maximize2, Minimize2 } from 'lucide-react';
import { useFaceTracker } from '../hooks/useFaceTracker';
import { useRecorder } from '../hooks/useRecorder';
import RecorderControls from './RecorderControls';
import { drawFacePuppet } from './face/FaceMeshRenderer';

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
  const { isCameraReady, faceResultRef, error } = useFaceTracker(videoRef);
  
  // Recorder Hook
  const recorder = useRecorder('FACE');

  const [blendshapes, setBlendshapes] = useState<Record<string, number>>({});
  const [showPip, setShowPip] = useState<boolean>(true);
  const [showGazeRays, setShowGazeRays] = useState<boolean>(true);
  const [showMocapDots, setShowMocapDots] = useState<boolean>(true);

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

              // Clear to technical dark carbon
              ctx.fillStyle = '#090A0C';
              ctx.fillRect(0, 0, w, h);

              // Determine Data Source
              let currentLandmarks: any[] | undefined;
              let currentBlendshapesRecord: Record<string, number> = {};

              // If Playing, read from buffer
              if (recorder.isPlaying) {
                  const frame = recorder.getPlaybackFrame();
                  if (frame) {
                      currentLandmarks = frame.faceLandmarks;
                      currentBlendshapesRecord = frame.blendshapes || {};
                  }
              } 
              // Else, read from Live MediaPipe
              else if (isCameraReady && video && video.readyState >= 2) {
                  const result = faceResultRef.current;
                  if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
                      currentLandmarks = result.faceLandmarks[0];

                      if (result.faceBlendshapes && result.faceBlendshapes[0]) {
                          result.faceBlendshapes[0].categories.forEach(c => {
                              currentBlendshapesRecord[c.categoryName] = c.score;
                          });
                      }

                      // RECORDING LOGIC
                      if (recorder.isRecording) {
                          recorder.captureFrame({
                              faceLandmarks: currentLandmarks,
                              blendshapes: currentBlendshapesRecord
                          });
                      }
                  }

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

              // Render Stylized Puppet Character
              if (currentLandmarks) {
                  drawFacePuppet(ctx, currentLandmarks, currentBlendshapesRecord, w, h, {
                      showGazeRays,
                      showMocapDots,
                      showWireframeMesh: true
                  });
              } else {
                  // Waiting placeholder
                  ctx.fillStyle = '#4B5563';
                  ctx.font = '12px monospace';
                  ctx.textAlign = 'center';
                  ctx.fillText('AWAITING FACIAL TELEMETRY FEED...', w / 2, h / 2);
              }

              // Update React UI state
              setBlendshapes(currentBlendshapesRecord);
          }
          animationFrameId = requestAnimationFrame(render);
      };
      render();

      return () => cancelAnimationFrame(animationFrameId);
  }, [isCameraReady, recorder.isRecording, recorder.isPlaying, showPip, showGazeRays, showMocapDots]);

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
                 className={`px-2 py-0.5 rounded transition-colors ${showGazeRays ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
             >
                 GAZE RAYS
             </button>
             <button
                 onClick={() => setShowMocapDots(!showMocapDots)}
                 className={`px-2 py-0.5 rounded transition-colors ${showMocapDots ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
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

          {/* Recorder Controls Overlay */}
          <div className="absolute bottom-8 right-8 pointer-events-auto z-30">
               <RecorderControls 
                  isRecording={recorder.isRecording}
                  isPlaying={recorder.isPlaying}
                  hasData={recorder.hasData}
                  frameCount={recorder.frameCount}
                  hasAudio={recorder.hasAudio}
                  onRecord={recorder.startRecording}
                  onStop={recorder.stopRecording}
                  onPlayToggle={recorder.togglePlayback}
                  onExport={recorder.exportData}
                  onImport={recorder.loadData}
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
                 Real-time facial blendshapes driving character puppet geometry, eye gaze, and speech synchronization.
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
