/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

export const drawHudOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 100) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 100) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
};

export const drawConnectors = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  color: string,
  w: number,
  h: number
) => {
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
  ];
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const [start, end] of connections) {
    const p1 = landmarks[start];
    const p2 = landmarks[end];
    if (p1 && p2) {
      ctx.moveTo((1 - p1.x) * w, p1.y * h);
      ctx.lineTo((1 - p2.x) * w, p2.y * h);
    }
  }
  ctx.stroke();
  ctx.restore();
};

export const drawLandmarks = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  w: number,
  h: number
) => {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 3;
  for (const lm of landmarks) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc((1 - lm.x) * w, lm.y * h, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
};

export const drawBoundingBox = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  color: string,
  score: number,
  w: number,
  h: number,
  label: string
) => {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  let avgZ = 0;
  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
    avgZ += lm.z || 0;
  }
  avgZ /= landmarks.length;

  const x1 = (1 - maxX) * w;
  const y1 = minY * h;
  const bw = (maxX - minX) * w;
  const bh = (maxY - minY) * h;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x1 - 10, y1 - 10, bw + 20, bh + 20);

  // High-contrast label tag
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(x1 - 10, y1 - 32, 130, 20);
  ctx.fillStyle = color;
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`${label} [${(score * 100).toFixed(0)}%]`, x1 - 6, y1 - 18);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '10px monospace';
  ctx.fillText(`Z: ${avgZ.toFixed(2)}`, x1 - 10, y1 + bh + 22);
  ctx.restore();
};

export const drawPinchLine = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  dist: number,
  w: number,
  h: number
) => {
  if (!landmarks || landmarks.length < 9) return;
  const t = landmarks[4];
  const i = landmarks[8];
  const tx = (1 - t.x) * w;
  const ty = t.y * h;
  const ix = (1 - i.x) * w;
  const iy = i.y * h;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(ix, iy);
  ctx.strokeStyle = dist < 30 ? '#EE3B2B' : '#E5E7EB';
  ctx.lineWidth = dist < 30 ? 3 : 1.5;
  ctx.setLineDash(dist < 30 ? [] : [4, 4]);
  ctx.stroke();

  const midX = (tx + ix) / 2;
  const midY = (ty + iy) / 2;

  // Background pill for telemetry
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(midX + 6, midY - 12, 48, 16);
  ctx.fillStyle = dist < 30 ? '#EE3B2B' : '#FFFFFF';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`${Math.round(dist)}px`, midX + 10, midY);
  ctx.restore();
};

export const drawInterHandDistance = (
  ctx: CanvasRenderingContext2D,
  l1: any[],
  l2: any[],
  type: 'palm' | 'finger' | 'thumb' | 'pinky',
  w: number,
  h: number
) => {
  const getPos = (lms: any[]) => {
    if (type === 'finger') return lms[8];
    if (type === 'thumb') return lms[4];
    if (type === 'pinky') return lms[20];
    return {
      x: (lms[0].x + lms[5].x + lms[17].x) / 3,
      y: (lms[0].y + lms[5].y + lms[17].y) / 3
    };
  };

  const p1 = getPos(l1);
  const p2 = getPos(l2);
  if (!p1 || !p2) return;

  const x1 = (1 - p1.x) * w;
  const y1 = p1.y * h;
  const x2 = (1 - p2.x) * w;
  const y2 = p2.y * h;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);

  // Monochromatic technical hierarchy
  const strokeColor = type === 'palm' ? '#E5E7EB' : type === 'finger' ? '#EE3B2B' : '#9CA3AF';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.stroke();

  const dist = Math.hypot(x2 - x1, y2 - y1);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  const labelText = `${type.toUpperCase()}: ${Math.round(dist)}px`;
  const textWidth = ctx.measureText(labelText).width;
  ctx.fillRect(midX - (textWidth / 2) - 4, midY - 14, textWidth + 8, 18);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(labelText, midX, midY);
  ctx.restore();
};

export const drawCenterEstimate = (
  ctx: CanvasRenderingContext2D,
  l1: any[] | null,
  l2: any[] | null,
  w: number,
  h: number
) => {
  const points: { x: number; y: number }[] = [];
  if (l1 && l1[0]) points.push({ x: (1 - l1[0].x) * w, y: l1[0].y * h });
  if (l2 && l2[0]) points.push({ x: (1 - l2[0].x) * w, y: l2[0].y * h });

  if (points.length === 0) return;

  let cx = 0, cy = 0;
  points.forEach(p => { cx += p.x; cy += p.y; });
  cx /= points.length;
  cy /= points.length;

  const screenCx = w / 2;
  const screenCy = h / 2;

  // Screen Center Line
  ctx.beginPath();
  ctx.moveTo(screenCx, 0);
  ctx.lineTo(screenCx, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Calculated Center
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Connection Line
  ctx.beginPath();
  ctx.moveTo(screenCx, cy);
  ctx.lineTo(cx, cy);
  ctx.strokeStyle = '#9CA3AF';
  ctx.lineWidth = 2;
  ctx.stroke();

  const offset = cx - screenCx;
  const direction = offset > 0 ? "RIGHT" : "LEFT";

  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(cx - 65, cy + 24, 130, 20);
  ctx.font = "bold 11px monospace";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`OFFSET: ${Math.abs(offset).toFixed(0)}px ${direction}`, cx - 58, cy + 38);
  ctx.restore();
};

export const drawHandStateLabel = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  gesture: string,
  w: number,
  h: number
) => {
  if (!landmarks || !landmarks[0]) return;
  const wrist = landmarks[0];
  const wx = (1 - wrist.x) * w;
  const wy = wrist.y * h;
  ctx.save();
  ctx.font = 'bold 12px monospace';
  const width = ctx.measureText(gesture).width;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(wx - (width / 2) - 8, wy + 24, width + 16, 22);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.strokeRect(wx - (width / 2) - 8, wy + 24, width + 16, 22);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(gesture, wx, wy + 39);
  ctx.restore();
};

export const drawBasisVectors = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  w: number,
  h: number
) => {
  if (!landmarks || landmarks.length < 18) return;
  const p0 = landmarks[0];
  const p5 = landmarks[5];
  const p17 = landmarks[17];
  const vec = (l: any) => new THREE.Vector3(l.x, l.y, l.z || 0);
  const v0 = vec(p0);
  const v5 = vec(p5);
  const v17 = vec(p17);

  const vY = new THREE.Vector3().subVectors(v5, v0).normalize();
  const vTemp = new THREE.Vector3().subVectors(v17, v0).normalize();
  const vZ = new THREE.Vector3().crossVectors(vY, vTemp).normalize();
  const vX = new THREE.Vector3().crossVectors(vY, vZ).normalize();

  const cx = (p0.x + p5.x + p17.x) / 3;
  const cy = (p0.y + p5.y + p17.y) / 3;
  const startX = (1 - cx) * w;
  const startY = cy * h;

  const drawArrow = (v: THREE.Vector3, color: string) => {
    const scale = 70;
    const endX = startX - (v.x * scale);
    const endY = startY + (v.y * scale);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(endX, endY, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  };

  // High contrast RGB basis vectors with drop shadow
  drawArrow(vZ, '#9CA3AF'); // Z vector (neutral)
  drawArrow(vX, '#EE3B2B'); // X vector (vermilion)
  drawArrow(vY, '#E5E7EB'); // Y vector (white)
};
