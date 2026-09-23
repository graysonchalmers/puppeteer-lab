/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet drawing layer: Three.js scene plus 2D overlays. The scene
 * (PuppetScene.ts) renders the shaded head, eyeballs, mouth, brows and hands
 * into its own WebGL canvas, which is blitted into the 2D context; gaze rays
 * and mocap dots are drawn on top. The same call renders the stage and the
 * offscreen video-export canvas.
 */
import { Landmark } from '../shared/trackerTypes';
import { fitProjection, Projection } from './projection';
import { MeshDetail } from './faceGeometry';
import { PuppetScene } from './PuppetScene';
import { PuppetState, boostBrows, boostJaw, boostBlink, teethGap } from './puppetState';
import { LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LEFT_EYEBROW, RIGHT_EYEBROW, MOCAP_POINTS } from './faceTopology';

export const STAGE_BG = '#090A0C';
const ACCENT = '#EE3B2B';

export interface PuppetFrame {
  face: Landmark[] | null;
  hands: Landmark[][];
  state: PuppetState;
}

export interface PuppetOptions {
  showGazeRays: boolean;
  showMocapDots: boolean;
  videoAspect: number;
  /** 0..1 Brow Boost slider (0 = raw landmarks). */
  browBoost: number;
  /** 0..1 Jaw Boost slider: parts the teeth sooner and drops the lower lip/chin. */
  jawBoost: number;
  /** 0..1 Blink Boost slider: deeper blinks, real blinks snap shut. */
  blinkBoost: number;
  /** Crease Angle in degrees, 0..90. */
  creaseAngle: number;
  meshDetail: MeshDetail;
}

const scenes = new WeakMap<HTMLCanvasElement, PuppetScene>();

function sceneFor(canvas: HTMLCanvasElement, w: number, h: number): PuppetScene {
  let s = scenes.get(canvas);
  if (!s) { s = new PuppetScene(w, h); scenes.set(canvas, s); }
  if (s.canvas.width !== w || s.canvas.height !== h) s.setSize(w, h);
  return s;
}

/** Release the WebGL context behind a canvas (call when an export finishes). */
export function disposePuppet(canvas: HTMLCanvasElement) {
  scenes.get(canvas)?.dispose();
  scenes.delete(canvas);
}

/** 2D gaze ray from the eye-contour center through the iris landmark. */
const drawGazeRay = (ctx: CanvasRenderingContext2D, lm: Landmark[], contour: readonly number[], iris: number, p: Projection) => {
  if (!lm[iris]) return;
  let cx = 0, cy = 0;
  for (const i of contour) { cx += p.x(lm[i]); cy += p.y(lm[i]); }
  cx /= contour.length; cy /= contour.length;
  const px = p.x(lm[iris]), py = p.y(lm[iris]);
  const m = Math.hypot(px - cx, py - cy);
  const nx = m > 0.5 ? (px - cx) / m : 0, ny = m > 0.5 ? (py - cy) / m : 0;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + nx * 45, py + ny * 45);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(px + nx * 45, py + ny * 45, 2, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
};

const drawMocapDots = (ctx: CanvasRenderingContext2D, lm: Landmark[], p: Projection) => {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (const idx of [...MOCAP_POINTS, ...LEFT_EYEBROW, ...RIGHT_EYEBROW]) {
    if (!lm[idx]) continue;
    ctx.beginPath();
    ctx.arc(p.x(lm[idx]), p.y(lm[idx]), 2, 0, Math.PI * 2);
    ctx.fill();
  }
};

export function drawPuppet(ctx: CanvasRenderingContext2D, frame: PuppetFrame, w: number, h: number, opts: PuppetOptions) {
  const p = fitProjection(w, h, opts.videoAspect);
  let face: Landmark[] | null = null;
  let eyeSource: Landmark[] | null = null;
  if (frame.face && frame.face.length >= 468) {
    eyeSource = boostJaw(boostBrows(frame.face, frame.state.brows, opts.browBoost, opts.videoAspect), frame.state, opts.jawBoost, opts.videoAspect);
    face = boostBlink(eyeSource, frame.state, opts.blinkBoost);
  }
  let scene: PuppetScene;
  try {
    scene = sceneFor(ctx.canvas as HTMLCanvasElement, w, h);
  } catch {
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WEBGL UNAVAILABLE: THE PUPPET NEEDS A WEBGL-CAPABLE BROWSER', w / 2, h / 2);
    return;
  }
  scene.render({
    face, eyeSource, hands: frame.hands,
    mouthOpen: frame.state.mouthOpen,
    teethGap: teethGap(frame.state, opts.jawBoost),
    creaseAngle: opts.creaseAngle,
    meshDetail: opts.meshDetail,
  }, p);
  ctx.drawImage(scene.canvas, 0, 0, w, h);
  if (face) {
    if (opts.showGazeRays) {
      drawGazeRay(ctx, face, LEFT_EYE_CONTOUR, 468, p);
      drawGazeRay(ctx, face, RIGHT_EYE_CONTOUR, 473, p);
    }
    if (opts.showMocapDots) drawMocapDots(ctx, face, p);
  }
}
