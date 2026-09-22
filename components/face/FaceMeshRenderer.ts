/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet drawing layer: background, faceted low-poly head, stylized
 * eyes (behavior unchanged from the original renderer), mouth, overlays.
 * Pure geometry lives in lowPoly.ts / handMesh.ts; this file only draws, so
 * the same call renders the stage and the offscreen video-export canvas.
 */
import { Landmark } from '../shared/trackerTypes';
import { fitProjection, buildFaceTriangles, Projection, ShadedTri } from './lowPoly';
import { buildHandTriangles } from './handMesh';
import { PuppetState, boostBrows } from './puppetState';
import {
  LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR, LIPS_INNER, LIPS_INNER_UPPER, LIPS_INNER_LOWER,
  LEFT_EYEBROW, RIGHT_EYEBROW, MOCAP_POINTS,
} from './faceTopology';

export const STAGE_BG = '#090A0C';
const ACCENT = '#EE3B2B';
const CAVITY = '#0B0C0E';
const LIP_CLOSED_FILL = '#3A3D44';
const LIP_SEAM = '#15171B';
const TOOTH = '#E6E4DC';
const TOOTH_SEAM = '#8E8C85';
const BROW = '#16181C';
/** Tooth row height: a share of mouth width, capped to a share of the lip
 * gap so a dark cavity always shows between the rows when teeth are apart. */
const TOOTH_BAND = 0.08;
const TOOTH_BAND_MAX_GAP = 0.3;

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
}

export function fillTriangles(ctx: CanvasRenderingContext2D, tris: ShadedTri[]) {
  ctx.lineWidth = 0.75;
  ctx.lineJoin = 'round';
  for (const t of tris) {
    ctx.beginPath();
    ctx.moveTo(t.ax, t.ay);
    ctx.lineTo(t.bx, t.by);
    ctx.lineTo(t.cx, t.cy);
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color; // same-color stroke hides anti-alias seams
    ctx.fill();
    ctx.stroke();
  }
}

const tracePath = (ctx: CanvasRenderingContext2D, lm: Landmark[], idx: readonly number[], p: Projection) => {
  ctx.beginPath();
  ctx.moveTo(p.x(lm[idx[0]]), p.y(lm[idx[0]]));
  for (let i = 1; i < idx.length; i++) ctx.lineTo(p.x(lm[idx[i]]), p.y(lm[idx[i]]));
};

/** Line through the midpoints of paired upper/lower inner-lip points. */
const strokeLipSeam = (ctx: CanvasRenderingContext2D, lm: Landmark[], p: Projection, color: string, width: number) => {
  ctx.beginPath();
  ctx.moveTo(p.x(lm[78]), p.y(lm[78]));
  for (let i = 0; i < LIPS_INNER_UPPER.length; i++) {
    const u = lm[LIPS_INNER_UPPER[i]];
    const l = lm[LIPS_INNER_LOWER[i]];
    ctx.lineTo((p.x(u) + p.x(l)) / 2, (p.y(u) + p.y(l)) / 2);
  }
  ctx.lineTo(p.x(lm[308]), p.y(lm[308]));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
};

/** A tooth row hanging off one inner lip, `dy` pixels toward the other lip. */
const fillToothRow = (ctx: CanvasRenderingContext2D, lm: Landmark[], p: Projection, lip: readonly number[], dy: number) => {
  const ring = [78, ...lip, 308];
  ctx.beginPath();
  ctx.moveTo(p.x(lm[ring[0]]), p.y(lm[ring[0]]));
  for (const i of ring.slice(1)) ctx.lineTo(p.x(lm[i]), p.y(lm[i]));
  for (const i of [...ring].reverse()) ctx.lineTo(p.x(lm[i]), p.y(lm[i]) + dy);
  ctx.closePath();
  ctx.fill();
};

/** Closed: lip seam. Open, teeth together: one tooth block with a bite line.
 * Open, teeth apart: upper and lower rows with the dark cavity between. */
const drawMouth = (ctx: CanvasRenderingContext2D, lm: Landmark[], p: Projection, state: PuppetState) => {
  tracePath(ctx, lm, LIPS_INNER, p);
  ctx.closePath();
  if (!state.mouthOpen) {
    ctx.fillStyle = LIP_CLOSED_FILL;
    ctx.fill();
    strokeLipSeam(ctx, lm, p, LIP_SEAM, 2);
    return;
  }
  ctx.save();
  ctx.clip();
  if (!state.teethApart) {
    ctx.fillStyle = TOOTH;
    ctx.fill();
    strokeLipSeam(ctx, lm, p, TOOTH_SEAM, 1.5);
  } else {
    ctx.fillStyle = CAVITY;
    ctx.fill();
    const dist = (a: number, b: number) => Math.hypot(p.x(lm[a]) - p.x(lm[b]), p.y(lm[a]) - p.y(lm[b]));
    const band = Math.min(dist(78, 308) * TOOTH_BAND, dist(13, 14) * TOOTH_BAND_MAX_GAP);
    ctx.fillStyle = TOOTH;
    fillToothRow(ctx, lm, p, LIPS_INNER_UPPER, band);
    fillToothRow(ctx, lm, p, LIPS_INNER_LOWER, -band);
  }
  ctx.restore();
};

/** Flat stylized brow: the landmark brow band (upper row out, lower row back). */
const drawBrow = (ctx: CanvasRenderingContext2D, lm: Landmark[], idx: readonly number[], p: Projection) => {
  tracePath(ctx, lm, idx, p);
  ctx.closePath();
  ctx.fillStyle = BROW;
  ctx.strokeStyle = BROW;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
};

/** The original stylized eye, unchanged apart from taking the projection. */
const renderStylizedEye = (
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  contourIndices: readonly number[],
  irisIndex: number,
  p: Projection,
  showGazeRays: boolean
) => {
  const getX = p.x;
  const getY = p.y;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let avgX = 0, avgY = 0;
  for (const idx of contourIndices) {
    const px = getX(landmarks[idx]);
    const py = getY(landmarks[idx]);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    avgX += px;
    avgY += py;
  }
  avgX /= contourIndices.length;
  avgY /= contourIndices.length;

  const eyeWidth = maxX - minX;
  const eyeHeight = maxY - minY;
  const blinkRatio = eyeHeight / Math.max(eyeWidth, 1);

  tracePath(ctx, landmarks, contourIndices, p);
  ctx.closePath();

  if (blinkRatio < 0.15) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    return;
  }

  ctx.fillStyle = '#F3F4F6';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#4B5563';
  ctx.stroke();

  let pupilX = avgX;
  let pupilY = avgY;
  if (landmarks[irisIndex]) {
    pupilX = getX(landmarks[irisIndex]);
    pupilY = getY(landmarks[irisIndex]);
  }
  pupilX = Math.max(minX + eyeWidth * 0.2, Math.min(maxX - eyeWidth * 0.2, pupilX));
  pupilY = Math.max(minY + eyeHeight * 0.2, Math.min(maxY - eyeHeight * 0.2, pupilY));

  const irisRadius = Math.min(eyeHeight * 0.45, eyeWidth * 0.26);

  ctx.beginPath();
  ctx.arc(pupilX, pupilY, Math.max(4, irisRadius), 0, Math.PI * 2);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#60A5FA';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pupilX, pupilY, Math.max(2, irisRadius * 0.5), 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pupilX - irisRadius * 0.35, pupilY - irisRadius * 0.35, Math.max(1.5, irisRadius * 0.25), 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  if (showGazeRays) {
    const gazeDx = pupilX - avgX;
    const gazeDy = pupilY - avgY;
    const rayLen = 45;
    const gazeMagnitude = Math.hypot(gazeDx, gazeDy);
    const nx = gazeMagnitude > 0.5 ? gazeDx / gazeMagnitude : 0;
    const ny = gazeMagnitude > 0.5 ? gazeDy / gazeMagnitude : 0;

    ctx.beginPath();
    ctx.moveTo(pupilX, pupilY);
    ctx.lineTo(pupilX + nx * rayLen, pupilY + ny * rayLen);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(pupilX + nx * rayLen, pupilY + ny * rayLen, 2, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }
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

export function drawPuppet(
  ctx: CanvasRenderingContext2D,
  frame: PuppetFrame,
  w: number,
  h: number,
  opts: PuppetOptions
) {
  ctx.save();
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, w, h);

  const p = fitProjection(w, h, opts.videoAspect);
  if (frame.face && frame.face.length >= 468) {
    const face = boostBrows(frame.face, frame.state.brows, opts.browBoost, opts.videoAspect);
    fillTriangles(ctx, buildFaceTriangles(face, p));
    drawBrow(ctx, face, LEFT_EYEBROW, p);
    drawBrow(ctx, face, RIGHT_EYEBROW, p);
    drawMouth(ctx, face, p, frame.state);
    // MediaPipe iris centers: 468 sits in the 33..133 eye, 473 in the 263..362 eye.
    renderStylizedEye(ctx, face, LEFT_EYE_CONTOUR, 468, p, opts.showGazeRays);
    renderStylizedEye(ctx, face, RIGHT_EYE_CONTOUR, 473, p, opts.showGazeRays);
    if (opts.showMocapDots) drawMocapDots(ctx, face, p);
  }

  // Hands always in front of the face (you gesture in front of yourself).
  for (const hand of frame.hands) {
    if (hand && hand.length >= 21) fillTriangles(ctx, buildHandTriangles(hand, p));
  }

  ctx.restore();
}
