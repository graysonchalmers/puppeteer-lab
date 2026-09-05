/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal Air Canvas demo: the bimanual mid-air drawing surface lifted out of
 * DebugView, running on the shared resolveHands + useHandRenderLoop engine.
 * Confidence gating is fixed at 0.5 (no slider on this demo).
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Camera, PenTool, RotateCcw, Trash2 } from 'lucide-react';
import { useMediaPipe } from '../../hooks/useMediaPipe';
import { resolveHands } from '../shared/resolveHands';
import { useHandRenderLoop, RenderFrame } from '../shared/useHandRenderLoop';
import { calculatePinchDistance } from '../shared/gestureAnalysis';
import SmoothingControl from '../shared/SmoothingControl';
import { smoothingToLerp } from '../shared/smoothing';
import {
  StrokePoint,
  Stroke,
  TracerParticle,
  LeftHandGrabState,
  AirTouchDwellState,
  handleLeftHandStrokeInteraction,
  updateAndRenderParticles,
  renderStrokes,
  renderPinchReticle,
  renderAirTouchControls
} from './pinchTracer';
import {
  reliabilityParams,
  resampleAndSmooth,
  relaxToward,
  bridgeGap
} from './lineReliability';

interface AirCanvasProps {
  onBack: () => void;
}

// Confidence gate is fixed for this demo: Air Canvas has no slider for it.
const CONFIDENCE_THRESHOLD = 0.5;

const AirCanvas: React.FC<AirCanvasProps> = ({ onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isCameraReady, lastResultsRef, error, setSmoothingFactor } = useMediaPipe(videoRef);

  const [smoothingAmount, setSmoothingAmount] = useState(0.4);

  // Line Reliability: 0 = raw passthrough (original behaviour), 1 = max smoothing,
  // densification, dropout tolerance and visible settling.
  const [lineReliabilityAmount, setLineReliabilityAmount] = useState(0.6);
  const lineReliabilityRef = useRef(0.6);
  useEffect(() => {
    lineReliabilityRef.current = lineReliabilityAmount;
  }, [lineReliabilityAmount]);

  const completedStrokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<StrokePoint[]>([]); // raw points of the active stroke
  const currentDisplayRef = useRef<StrokePoint[]>([]); // smoothed geometry drawn live
  const drawStateRef = useRef<{
    active: boolean;
    lastPt: StrokePoint | null;
    lastSeenMs: number;
    vel: { vx: number; vy: number };
  }>({ active: false, lastPt: null, lastSeenMs: 0, vel: { vx: 0, vy: 0 } });
  const particlesRef = useRef<TracerParticle[]>([]);
  const leftGrabStateRef = useRef<LeftHandGrabState>({
    grabbedStrokeIndex: null,
    lastPinchX: 0,
    lastPinchY: 0,
    holdAnchorX: 0,
    holdAnchorY: 0,
    holdDurationMs: 0,
    justDeleted: false
  });
  const airTouchStateRef = useRef<AirTouchDwellState>({
    undoProgress: 0,
    clearProgress: 0,
    undoTriggered: false,
    clearTriggered: false,
    lastTimeMs: performance.now()
  });

  // Dynamic Smoothing
  useEffect(() => {
    setSmoothingFactor(smoothingToLerp(smoothingAmount));
  }, [smoothingAmount, setSmoothingFactor]);

  // Per-frame draw: reads everything through refs so this callback stays
  // stable and useHandRenderLoop's effect never restarts.
  const drawFrame = useCallback(({ canvas, ctx, nowMs }: RenderFrame) => {
    const results = lastResultsRef.current;
    const { left: leftHandLandmarks, right: rightHandLandmarks } = resolveHands(
      results?.landmarks ?? [],
      results?.handedness ?? [],
      CONFIDENCE_THRESHOLD,
      false
    );

    const dtSeconds = 0.016;

    // 1. Right Hand: Vector Line Drawing (< 30px pinch threshold)
    // Line Reliability: tolerate brief tracking dropouts, bridge the gap
    // with a velocity-predicted curve, and smooth the trace. At slider 0
    // this collapses to the original commit-on-drop behaviour.
    const params = reliabilityParams(lineReliabilityRef.current);
    const ds = drawStateRef.current;

    const commitCurrentStroke = () => {
      const raw = currentStrokeRef.current;
      if (raw.length > 1) {
        const target = resampleAndSmooth(raw, params);
        completedStrokesRef.current.push({
          raw: raw.map((p) => ({ x: p.x, y: p.y })),
          display:
            currentDisplayRef.current.length > 1
              ? currentDisplayRef.current.map((p) => ({ x: p.x, y: p.y }))
              : target.map((p) => ({ x: p.x, y: p.y })),
          settleMsLeft: 700
        });
      }
      currentStrokeRef.current = [];
      currentDisplayRef.current = [];
    };

    let rightSample: StrokePoint | null = null;
    let rSampleDist = Infinity;
    if (rightHandLandmarks && rightHandLandmarks.length >= 9) {
      const rDist = calculatePinchDistance(rightHandLandmarks, canvas.width, canvas.height);
      const rThumb = rightHandLandmarks[4];
      const rIndex = rightHandLandmarks[8];
      const rMidX = ((1 - rThumb.x) + (1 - rIndex.x)) * 0.5 * canvas.width;
      const rMidY = (rThumb.y + rIndex.y) * 0.5 * canvas.height;
      if (rDist < 30) {
        rightSample = { x: rMidX, y: rMidY };
        rSampleDist = rDist;
      }
    }

    if (rightSample) {
      const gapMs = ds.active ? nowMs - ds.lastSeenMs : 0;
      if (ds.active && ds.lastPt && gapMs > 40 && params.graceMs > 0) {
        // Frames were skipped mid-stroke: bridge the dropout, or start a
        // fresh stroke if the resume point is implausibly far.
        const bridge = bridgeGap(ds.lastPt, ds.vel, rightSample, gapMs, params);
        if (bridge) {
          for (const b of bridge) currentStrokeRef.current.push(b);
        } else {
          commitCurrentStroke();
          currentStrokeRef.current.push(rightSample);
        }
      } else {
        currentStrokeRef.current.push(rightSample);
      }

      if (ds.active && ds.lastPt) {
        const dt = Math.max(1, nowMs - ds.lastSeenMs);
        ds.vel = {
          vx: (rightSample.x - ds.lastPt.x) / dt,
          vy: (rightSample.y - ds.lastPt.y) / dt
        };
      }
      ds.active = true;
      ds.lastPt = rightSample;
      ds.lastSeenMs = nowMs;
      renderPinchReticle(ctx, rightSample.x, rightSample.y, rSampleDist, 'RIGHT: DRAW LINE', '#EE3B2B');
    } else if (ds.active) {
      // No sample this frame: hold the stroke open until the grace window
      // lapses, then commit it.
      if (nowMs - ds.lastSeenMs > params.graceMs) {
        commitCurrentStroke();
        ds.active = false;
        ds.lastPt = null;
      }
    }

    // 2. Left Hand: Object Manipulation (Grab & Move, Hold to Delete) or Gravity Particles
    let leftPinchPos: { x: number; y: number } | null = null;
    let leftHoldProgress = 0;

    if (leftHandLandmarks && leftHandLandmarks.length >= 9) {
      const lDist = calculatePinchDistance(leftHandLandmarks, canvas.width, canvas.height);
      const lThumb = leftHandLandmarks[4];
      const lIndex = leftHandLandmarks[8];
      const lMidX = ((1 - lThumb.x) + (1 - lIndex.x)) * 0.5 * canvas.width;
      const lMidY = (lThumb.y + lIndex.y) * 0.5 * canvas.height;
      const isLeftPinching = lDist < 30;

      leftPinchPos = { x: lMidX, y: lMidY };

      const interaction = handleLeftHandStrokeInteraction(
        lMidX,
        lMidY,
        isLeftPinching,
        completedStrokesRef.current,
        leftGrabStateRef.current,
        particlesRef.current,
        dtSeconds
      );

      leftHoldProgress = interaction.holdProgress || 0;

      if (isLeftPinching) {
        if (interaction.action === 'grab') {
          const label = leftHoldProgress > 0.05 ? 'HOLD TO DELETE' : 'MOVE LINE';
          renderPinchReticle(ctx, lMidX, lMidY, lDist, label, '#38BDF8');
        } else if (interaction.action === 'emit') {
          renderPinchReticle(ctx, lMidX, lMidY, lDist, 'GRAVITY PARTICLES', '#F59E0B');
        }
      }
    } else {
      leftGrabStateRef.current.grabbedStrokeIndex = null;
      leftGrabStateRef.current.holdDurationMs = 0;
    }

    // Live display for the active stroke: the smoothed target tracks the
    // hand directly (no easing, so the tail keeps up while drawing).
    if (currentStrokeRef.current.length > 1) {
      currentDisplayRef.current = resampleAndSmooth(currentStrokeRef.current, params);
    } else {
      currentDisplayRef.current = currentStrokeRef.current.map((p) => ({ x: p.x, y: p.y }));
    }

    // Recently-committed strokes keep easing toward their smoothed target
    // for a short window, so the trail visibly relaxes after you release.
    const frameMs = dtSeconds * 1000;
    for (const s of completedStrokesRef.current) {
      if (s.settleMsLeft > 0) {
        const target = resampleAndSmooth(s.raw, params);
        s.display = relaxToward(s.display, target, params.relaxAlpha);
        s.settleMsLeft -= frameMs;
        if (s.settleMsLeft <= 0) s.display = target;
      }
    }

    // Render accumulated strokes (with active grab aura & delete meter)
    renderStrokes(
      ctx,
      completedStrokesRef.current,
      currentDisplayRef.current,
      '#EE3B2B',
      leftGrabStateRef.current.grabbedStrokeIndex,
      leftHoldProgress,
      leftPinchPos
    );

    // Update & render kinetic particles with Drag and Gravity physics
    updateAndRenderParticles(ctx, particlesRef.current);

    // Hands-Free Air-Touch Dwell Controls: UNDO (1.2s) and CLEAR ALL (1.5s)
    const pointers: { x: number; y: number }[] = [];
    if (rightHandLandmarks && rightHandLandmarks[8]) {
      pointers.push({
        x: (1 - rightHandLandmarks[8].x) * canvas.width,
        y: rightHandLandmarks[8].y * canvas.height
      });
    }
    if (leftHandLandmarks && leftHandLandmarks[8]) {
      pointers.push({
        x: (1 - leftHandLandmarks[8].x) * canvas.width,
        y: leftHandLandmarks[8].y * canvas.height
      });
    }

    renderAirTouchControls(
      ctx,
      pointers,
      airTouchStateRef.current,
      canvas.width,
      nowMs,
      () => {
        // Hands-Free Air Touch Undo
        if (completedStrokesRef.current.length > 0) {
          completedStrokesRef.current.pop();
        }
      },
      () => {
        // Hands-Free Air Touch Clear
        completedStrokesRef.current = [];
        currentStrokeRef.current = [];
        currentDisplayRef.current = [];
        particlesRef.current = [];
        drawStateRef.current.active = false;
        drawStateRef.current.lastPt = null;
      }
    );
  }, []);

  useHandRenderLoop(canvasRef, videoRef, isCameraReady, isCameraReady, drawFrame);

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
            Air Canvas &amp; Hand Tracking
          </span>
        </div>
        <div className="text-gray-400 font-mono text-xs flex items-center gap-2 pointer-events-auto bg-[#111317]/80 backdrop-blur-md border border-white/10 px-3 py-1 rounded-lg">
          <span className="w-2 h-2 rounded-full bg-[#EE3B2B] animate-pulse" />
          <span>Camera Active</span>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="relative flex-1 h-full bg-[#090A0C] flex items-center justify-center overflow-hidden">
        {!isCameraReady && (
          <div className="text-white/70 animate-pulse flex flex-col items-center">
            <Camera size={40} className="mb-3 text-[#EE3B2B]" />
            <p className="font-mono text-xs tracking-wider">Starting Camera Tracking...</p>
          </div>
        )}
        {error && <p className="text-[#EE3B2B] font-mono text-xs">{error}</p>}

        <video ref={videoRef} className="absolute opacity-0 pointer-events-none w-px h-px" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain z-0" />
      </div>

      {/* Sidebar Panel - Monochromatic NASA Technical Layout */}
      <div className="w-full md:w-80 bg-[#0E1013] border-l border-white/10 flex flex-col overflow-hidden z-20 shadow-2xl font-mono">
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-white font-bold text-xs tracking-wider flex items-center gap-2 font-mono">
              <PenTool size={15} className="text-white" /> AIR CANVAS SETTINGS
            </h2>
          </div>

          {/* Global Smoothing Controls */}
          <SmoothingControl value={smoothingAmount} onChange={setSmoothingAmount} />

          {/* Line Reliability Controls */}
          <div className="bg-[#15171C] p-3.5 rounded border border-white/10">
            <div className="flex justify-between items-center mb-2.5">
              <h3 className="text-[10px] uppercase tracking-wider text-white font-bold flex items-center gap-1.5">
                <PenTool size={12} /> Line Reliability
              </h3>
              <span className="text-[11px] font-bold text-[#EE3B2B]">
                {(lineReliabilityAmount * 100).toFixed(0)}%
              </span>
            </div>

            {/* Quick Presets */}
            <div className="grid grid-cols-4 gap-1 mb-3">
              {[
                { label: 'RAW', val: 0.0 },
                { label: 'BAL', val: 0.6 },
                { label: 'SMTH', val: 0.8 },
                { label: 'MAX', val: 1.0 }
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => setLineReliabilityAmount(p.val)}
                  className={`py-1 text-[10px] rounded border transition-colors ${
                    Math.abs(lineReliabilityAmount - p.val) < 0.05
                      ? 'bg-white text-black border-white font-bold'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[9px] text-gray-400">
                <span>0% Raw Line</span>
                <span>100% Backfill &amp; Heal</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={lineReliabilityAmount}
                onChange={(e) => setLineReliabilityAmount(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]"
              />
              <p className="text-[9px] text-gray-500 leading-snug pt-1">
                Interpolates sparse points, bridges tracking dropouts, and lets the drawn line relax smooth after you release.
              </p>
            </div>
          </div>

          {/* Manual Controls */}
          <div className="bg-[#15171C] p-3.5 rounded border border-white/10">
            <h3 className="text-[10px] uppercase tracking-wider text-white font-bold mb-2.5 flex items-center gap-1.5">
              <PenTool size={12} className="text-[#EE3B2B]" /> Manual Controls
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  if (completedStrokesRef.current.length > 0) {
                    completedStrokesRef.current.pop();
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer border border-white/10 text-[11px]"
                title="Undo last stroke"
              >
                <RotateCcw size={11} /> Undo
              </button>
              <button
                onClick={() => {
                  completedStrokesRef.current = [];
                  currentStrokeRef.current = [];
                  currentDisplayRef.current = [];
                  particlesRef.current = [];
                  drawStateRef.current.active = false;
                  drawStateRef.current.lastPt = null;
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-red-500/30 text-white transition-colors cursor-pointer border border-white/10 text-[11px]"
                title="Clear canvas strokes and particles"
              >
                <Trash2 size={11} /> Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AirCanvas;
