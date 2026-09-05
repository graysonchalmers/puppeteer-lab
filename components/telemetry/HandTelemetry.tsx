/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full diagnostic Hand Telemetry demo: every analysis tool from DebugView
 * (skeleton, distances, confidence gate, smoothing, hologram, proximity
 * audio, and the recorder) lifted onto the shared resolveHands +
 * useHandRenderLoop engine, minus the Air Canvas drawing and air-touch
 * controls.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  ArrowLeft,
  Camera,
  Fingerprint,
  Activity,
  Ruler,
  Grab,
  Volume2,
  Compass,
  Box,
  MoveHorizontal,
  Rotate3D,
  Sliders
} from 'lucide-react';
import { useMediaPipe } from '../../hooks/useMediaPipe';
import { COLORS } from '../../types';
import { useRecorder } from '../../hooks/useRecorder';
import RecorderControls from '../RecorderControls';
import InteractiveObject from './InteractiveObject';
import {
  drawHudOverlay,
  drawConnectors,
  drawLandmarks,
  drawBoundingBox,
  drawPinchLine,
  drawInterHandDistance,
  drawCenterEstimate,
  drawHandStateLabel,
  drawBasisVectors
} from './drawingHelpers';
import { calculatePinchDistance, analyzeGesture } from '../shared/gestureAnalysis';
import { resolveHands } from '../shared/resolveHands';
import { useHandRenderLoop, RenderFrame } from '../shared/useHandRenderLoop';
import SmoothingControl from '../shared/SmoothingControl';
import { smoothingToLerp } from '../shared/smoothing';

interface HandTelemetryProps {
  onBack: () => void;
}

const HandTelemetry: React.FC<HandTelemetryProps> = ({ onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isCameraReady, lastResultsRef, error, handPositionsRef, setSmoothingFactor } = useMediaPipe(videoRef);

  const recorder = useRecorder('HAND');

  // Visualization Toggles (All analysis tools defaulted to ON except gesture emoji classifier)
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [smoothingAmount, setSmoothingAmount] = useState(0.4);

  const [showPinchLine, setShowPinchLine] = useState(true);
  const [showHandState, setShowHandState] = useState(false);
  const [showBasisVectors, setShowBasisVectors] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showHologram, setShowHologram] = useState(true);

  // Inter-hand measurement Toggles (defaulted to ON)
  const [showPalmDistance, setShowPalmDistance] = useState(true);
  const [showFingerDistance, setShowFingerDistance] = useState(true);
  const [showThumbGap, setShowThumbGap] = useState(true);
  const [showPinkyDistance, setShowPinkyDistance] = useState(true);
  const [showCenterEstimate, setShowCenterEstimate] = useState(true);

  // Audio Synth Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const [metrics, setMetrics] = useState<any>({});

  // Dynamic Smoothing
  useEffect(() => {
    setSmoothingFactor(smoothingToLerp(smoothingAmount));
  }, [smoothingAmount, setSmoothingFactor]);

  // Proximity Audio Synthesizer
  useEffect(() => {
    if (soundEnabled && !audioCtxRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = 440;
        gain.gain.value = 0;

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        audioCtxRef.current = ctx;
        oscRef.current = osc;
        gainRef.current = gain;
      } catch (err) {
        console.warn("Could not start audio synth:", err);
      }
    } else if (!soundEnabled && audioCtxRef.current) {
      try {
        gainRef.current?.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
        setTimeout(() => {
          audioCtxRef.current?.close().catch(() => {});
          audioCtxRef.current = null;
          oscRef.current = null;
          gainRef.current = null;
        }, 200);
      } catch (err) {
        audioCtxRef.current = null;
      }
    }
  }, [soundEnabled]);

  // Cleanup any live audio context when this demo unmounts.
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Per-frame draw: reads toggles as closure state but reads live/playback
  // landmark data and audio nodes through refs, so this callback only
  // changes identity when a toggle actually changes, not every frame.
  const drawFrame = useCallback(({ canvas, ctx }: RenderFrame) => {
    const handPos = handPositionsRef.current;

    drawHudOverlay(ctx, canvas.width, canvas.height);

    let currentLandmarksList: any[][] = [];
    let currentHandedness: any[] = [];

    if (recorder.isPlaying) {
      const frame = recorder.getPlaybackFrame();
      if (frame && frame.landmarks) {
        currentLandmarksList = frame.landmarks;
      }
    } else {
      const results = lastResultsRef.current;
      if (results && results.landmarks) {
        currentLandmarksList = results.landmarks;
        currentHandedness = results.handedness;

        if (recorder.isRecording) {
          recorder.captureFrame({
            landmarks: results.landmarks,
            leftHand: handPos.left,
            rightHand: handPos.right
          });
        }
      }
    }

    const { hands, left: leftHandLandmarks, right: rightHandLandmarks, drawnCount } = resolveHands(
      currentLandmarksList,
      currentHandedness,
      confidenceThreshold,
      recorder.isPlaying
    );

    let minPinchDist = Infinity;

    hands.forEach(({ landmarks, isRight, score }) => {
      const color = isRight ? COLORS.right : COLORS.left;

      drawConnectors(ctx, landmarks, color, canvas.width, canvas.height);
      drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
      drawBoundingBox(
        ctx,
        landmarks,
        color,
        score,
        canvas.width,
        canvas.height,
        isRight ? 'Right Hand' : 'Left Hand'
      );

      if (showPinchLine || soundEnabled) {
        const dist = calculatePinchDistance(landmarks, canvas.width, canvas.height);
        minPinchDist = Math.min(minPinchDist, dist);

        if (showPinchLine) {
          drawPinchLine(ctx, landmarks, dist, canvas.width, canvas.height);
        }
      }

      if (showHandState) {
        const gesture = analyzeGesture(landmarks);
        if (gesture) {
          drawHandStateLabel(ctx, landmarks, gesture, canvas.width, canvas.height);
        }
      }

      if (showBasisVectors) {
        drawBasisVectors(ctx, landmarks, canvas.width, canvas.height);
      }
    });

    if (leftHandLandmarks && rightHandLandmarks) {
      if (showPalmDistance) {
        drawInterHandDistance(ctx, leftHandLandmarks, rightHandLandmarks, 'palm', canvas.width, canvas.height);
      }
      if (showFingerDistance) {
        drawInterHandDistance(ctx, leftHandLandmarks, rightHandLandmarks, 'finger', canvas.width, canvas.height);
      }
      if (showThumbGap) {
        drawInterHandDistance(ctx, leftHandLandmarks, rightHandLandmarks, 'thumb', canvas.width, canvas.height);
      }
      if (showPinkyDistance) {
        drawInterHandDistance(ctx, leftHandLandmarks, rightHandLandmarks, 'pinky', canvas.width, canvas.height);
      }
    }

    if (showCenterEstimate) {
      drawCenterEstimate(ctx, leftHandLandmarks, rightHandLandmarks, canvas.width, canvas.height);
    }

    if (soundEnabled && audioCtxRef.current && oscRef.current && gainRef.current) {
      if (minPinchDist !== Infinity) {
        const normalized = Math.max(0, Math.min(1, minPinchDist / 300));
        const freq = 880 - normalized * 660;
        const now = audioCtxRef.current.currentTime;
        oscRef.current.frequency.setTargetAtTime(freq, now, 0.1);
        gainRef.current.gain.setTargetAtTime(0.1, now, 0.1);
      } else {
        gainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
      }
    }

    if (!recorder.isPlaying) {
      setMetrics({
        handsDetected: drawnCount,
        leftPos: handPos.left
          ? { x: handPos.left.x.toFixed(2), y: handPos.left.y.toFixed(2), z: handPos.left.z.toFixed(2) }
          : null,
        rightPos: handPos.right
          ? { x: handPos.right.x.toFixed(2), y: handPos.right.y.toFixed(2), z: handPos.right.z.toFixed(2) }
          : null,
        leftVel: handPos.leftVelocity.length().toFixed(2),
        rightVel: handPos.rightVelocity.length().toFixed(2)
      });
    }
  }, [
    confidenceThreshold,
    showPinchLine,
    showHandState,
    showBasisVectors,
    soundEnabled,
    showPalmDistance,
    showFingerDistance,
    showThumbGap,
    showPinkyDistance,
    showCenterEstimate,
    recorder.isPlaying,
    recorder.isRecording,
    recorder.getPlaybackFrame,
    recorder.captureFrame
  ]);

  useHandRenderLoop(canvasRef, videoRef, isCameraReady || recorder.isPlaying, isCameraReady, drawFrame);

  return (
    <div className="relative w-full h-full bg-[#090A0C] flex flex-col md:flex-row text-white select-none">
      {/* Navigation Header */}
      <div className="absolute top-0 left-0 z-50 p-4 w-full flex justify-between items-center bg-gradient-to-b from-[#090A0C]/90 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button
            onClick={onBack}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3.5 py-1.5 rounded-lg border border-white/15 transition-all text-xs font-mono text-white cursor-pointer"
          >
            <ArrowLeft size={14} /> Hub
          </button>
          <span className="text-xs font-mono tracking-wider text-gray-300 border-l border-white/15 pl-3">
            Hand Telemetry
          </span>
        </div>
        <div className="text-gray-400 font-mono text-xs flex items-center gap-2 pointer-events-auto bg-[#111317]/80 backdrop-blur-md border border-white/10 px-3 py-1 rounded-lg">
          <span className="w-2 h-2 rounded-full bg-[#EE3B2B] animate-pulse" />
          <span>Camera Active</span>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="relative flex-1 h-full bg-[#090A0C] flex items-center justify-center overflow-hidden">
        {!isCameraReady && !recorder.isPlaying && (
          <div className="text-white/70 animate-pulse flex flex-col items-center">
            <Camera size={40} className="mb-3 text-[#EE3B2B]" />
            <p className="font-mono text-xs tracking-wider">Starting Camera Tracking...</p>
          </div>
        )}
        {error && <p className="text-[#EE3B2B] font-mono text-xs">{error}</p>}

        <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-px h-px" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain z-0" />

        {/* 3D Hologram (Compact Corner Gizmo, Grabbable via Pinch) */}
        {showHologram && isCameraReady && (
          <div className="absolute inset-0 z-10 pointer-events-none">
            <Canvas camera={{ position: [0, 1.8, 4], fov: 60 }} className="pointer-events-auto">
              <ambientLight intensity={0.7} />
              <pointLight position={[10, 10, 10]} intensity={1.2} />
              <InteractiveObject resultsRef={lastResultsRef} />
            </Canvas>
          </div>
        )}

        {/* Recorder Controls Overlay with Synchronized Audio & Multi-Format Export */}
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

      {/* Sidebar Panel - Monochromatic NASA Technical Layout */}
      <div className="w-full md:w-80 bg-[#0E1013] border-l border-white/10 flex flex-col overflow-hidden z-20 shadow-2xl font-mono">
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-white font-bold text-xs tracking-wider flex items-center gap-2 font-mono">
              <Fingerprint size={15} className="text-white" /> TRACKING SETTINGS
            </h2>
          </div>

          {/* Global Smoothing Controls */}
          <SmoothingControl value={smoothingAmount} onChange={setSmoothingAmount} />

          {/* Sensitivity */}
          <div className="bg-[#15171C] p-3.5 rounded border border-white/10">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-[10px] uppercase tracking-wider text-white font-bold flex items-center gap-1.5">
                <Sliders size={12} /> Confidence Gate
              </h3>
              <span className="text-[11px] font-bold text-gray-300">
                {(confidenceThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.05"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-white"
            />
          </div>

          {/* Analysis Tools */}
          <div className="bg-[#15171C] p-3.5 rounded border border-white/10">
            <h3 className="text-[10px] uppercase tracking-wider text-white font-bold mb-2 flex items-center gap-1.5">
              <Activity size={12} /> Kinematics Overlays
            </h3>
            <div className="space-y-1.5">
              {[
                { label: 'Pinch Distance Vector', state: showPinchLine, set: setShowPinchLine, icon: <Ruler size={13} /> },
                { label: 'Gesture Classifier', state: showHandState, set: setShowHandState, icon: <Grab size={13} /> },
                { label: 'Basis Vectors (3-Axis)', state: showBasisVectors, set: setShowBasisVectors, icon: <Rotate3D size={13} /> },
                { label: 'Body Center Estimate', state: showCenterEstimate, set: setShowCenterEstimate, icon: <Compass size={13} /> },
                { label: 'L/R Palm Separation', state: showPalmDistance, set: setShowPalmDistance, icon: <Ruler size={13} /> },
                { label: 'L/R Index Distance', state: showFingerDistance, set: setShowFingerDistance, icon: <Ruler size={13} /> },
                { label: 'L/R Thumb Gap', state: showThumbGap, set: setShowThumbGap, icon: <MoveHorizontal size={13} /> },
                { label: 'L/R Pinky Span', state: showPinkyDistance, set: setShowPinkyDistance, icon: <MoveHorizontal size={13} /> }
              ].map((item, idx) => (
                <label key={idx} className="flex items-center gap-2.5 cursor-pointer hover:bg-white/5 p-1.5 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={item.state}
                    onChange={(e) => item.set(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-white/20 text-white focus:ring-0 bg-[#0E1013]"
                  />
                  <div className="text-[11px] text-gray-300 flex items-center gap-2">
                    <span className="text-gray-400">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Hologram & Audio Toggles */}
          <div className="grid grid-cols-2 gap-2">
            <label className="bg-[#15171C] p-2.5 rounded border border-white/10 flex flex-col justify-between cursor-pointer hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between text-[10px] text-white font-bold">
                <span className="flex items-center gap-1"><Box size={12} /> 3D Cube</span>
                <input
                  type="checkbox"
                  checked={showHologram}
                  onChange={(e) => setShowHologram(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-white/20 text-white focus:ring-0 bg-[#0E1013]"
                />
              </div>
              <p className="text-[9px] text-gray-400 mt-1">Corner gizmo, pinch to move</p>
            </label>

            <label className="bg-[#15171C] p-2.5 rounded border border-white/10 flex flex-col justify-between cursor-pointer hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-between text-[10px] text-white font-bold">
                <span className="flex items-center gap-1"><Volume2 size={12} /> Synth</span>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-white/20 text-white focus:ring-0 bg-[#0E1013]"
                />
              </div>
              <p className="text-[9px] text-gray-400 mt-1">Proximity pitch audio</p>
            </label>
          </div>

          {/* Telemetry Stats Readout */}
          <div className="bg-[#111317] p-3 rounded border border-white/10 text-[10px]">
            <div className="flex justify-between items-center text-gray-400 mb-1.5 pb-1 border-b border-white/5">
              <span>TARGET LOCKS</span>
              <span className="text-white font-bold">{metrics.handsDetected || 0} / 2 HANDS</span>
            </div>
            {metrics.leftPos && (
              <div className="text-gray-400 py-0.5">
                <span className="text-white font-semibold">LEFT:</span> [{metrics.leftPos.x}, {metrics.leftPos.y}, {metrics.leftPos.z}] ({metrics.leftVel} u/s)
              </div>
            )}
            {metrics.rightPos && (
              <div className="text-gray-400 py-0.5">
                <span className="text-white font-semibold">RIGHT:</span> [{metrics.rightPos.x}, {metrics.rightPos.y}, {metrics.rightPos.z}] ({metrics.rightVel} u/s)
              </div>
            )}
            {!metrics.leftPos && !metrics.rightPos && (
              <span className="text-gray-500 italic">No kinematics signal detected</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HandTelemetry;
