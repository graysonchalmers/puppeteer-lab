/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Key facial topological contours from MediaPipe 478-point mesh
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10
];

const LIPS_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61
];

const LIPS_INNER = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78
];

const LEFT_EYEBROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_EYEBROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

const LEFT_EYE_CONTOUR = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33];
const RIGHT_EYE_CONTOUR = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263];

const NOSE_BRIDGE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2];

// Motion capture landmark dots across cheeks, forehead and chin
const MOCAP_CHEEK_POINTS = [
  117, 123, 147, 213, 187, 120, // left cheek
  346, 352, 376, 433, 411, 349, // right cheek
  9, 151, 10, 108, 337,         // forehead & temple
  152, 175, 199, 200            // chin & jaw
];

export interface FacePuppetOptions {
  showGazeRays?: boolean;
  showMocapDots?: boolean;
  showWireframeMesh?: boolean;
}

/**
 * Renders an animated stylized character puppet from raw 3D face landmarks and blendshapes.
 */
export const drawFacePuppet = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  blendshapes: Record<string, number> = {},
  w: number,
  h: number,
  options: FacePuppetOptions = { showGazeRays: true, showMocapDots: true, showWireframeMesh: true }
) => {
  if (!landmarks || landmarks.length < 468) return;

  // Coordinate projection helper (mirrored X for intuitive user experience)
  const getX = (lm: any) => (1 - lm.x) * w;
  const getY = (lm: any) => lm.y * h;

  ctx.save();

  // 1. Draw Subtle Tech Grid Background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Set default shadow for technical separation
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 5;

  // 2. Head Silhouette & Jaw Contour
  ctx.beginPath();
  const startPt = landmarks[FACE_OVAL[0]];
  ctx.moveTo(getX(startPt), getY(startPt));
  for (let i = 1; i < FACE_OVAL.length; i++) {
    const pt = landmarks[FACE_OVAL[i]];
    ctx.lineTo(getX(pt), getY(pt));
  }
  ctx.closePath();

  // Soft stylized carbon head fill
  ctx.fillStyle = 'rgba(18, 20, 26, 0.9)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#4B5563'; // neutral slate
  ctx.stroke();

  // 3. Nose Contour & Bridge
  ctx.beginPath();
  const noseStart = landmarks[NOSE_BRIDGE[0]];
  ctx.moveTo(getX(noseStart), getY(noseStart));
  for (let i = 1; i < NOSE_BRIDGE.length; i++) {
    const pt = landmarks[NOSE_BRIDGE[i]];
    ctx.lineTo(getX(pt), getY(pt));
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#9CA3AF';
  ctx.stroke();

  // Nose tip crosshair
  const tip = landmarks[1]; // Tip of nose
  if (tip) {
    const tx = getX(tip);
    const ty = getY(tip);
    ctx.beginPath();
    ctx.arc(tx, ty, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#EE3B2B'; // NASA Red focal point
    ctx.fill();
  }

  // 4. Expressive Eyebrows with tracking points
  const drawEyebrow = (indices: number[]) => {
    ctx.beginPath();
    ctx.moveTo(getX(landmarks[indices[0]]), getY(landmarks[indices[0]]));
    for (let i = 1; i < indices.length; i++) {
      ctx.lineTo(getX(landmarks[indices[i]]), getY(landmarks[indices[i]]));
    }
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineCap = 'round';
    ctx.stroke();

    if (options.showMocapDots) {
      for (const idx of indices) {
        const p = landmarks[idx];
        ctx.beginPath();
        ctx.arc(getX(p), getY(p), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#F59E0B'; // Amber mocap bead
        ctx.fill();
      }
    }
  };

  drawEyebrow(LEFT_EYEBROW);
  drawEyebrow(RIGHT_EYEBROW);

  // 5. Stylized Animated Eyeballs & 3D Gaze Vectors
  const renderStylizedEye = (contourIndices: number[], irisIndex: number, isRightEye: boolean) => {
    // Eye bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let avgX = 0, avgY = 0;
    for (const idx of contourIndices) {
      const p = landmarks[idx];
      const px = getX(p);
      const py = getY(p);
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

    // Draw eye contour
    ctx.beginPath();
    ctx.moveTo(getX(landmarks[contourIndices[0]]), getY(landmarks[contourIndices[0]]));
    for (let i = 1; i < contourIndices.length; i++) {
      ctx.lineTo(getX(landmarks[contourIndices[i]]), getY(landmarks[contourIndices[i]]));
    }
    ctx.closePath();

    if (blinkRatio < 0.15) {
      // Eye is shut / blinking
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      return;
    }

    // Sclera (Eye White)
    ctx.fillStyle = '#F3F4F6';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#4B5563';
    ctx.stroke();

    // Iris & Pupil position
    let pupilX = avgX;
    let pupilY = avgY;
    if (landmarks[irisIndex]) {
      pupilX = getX(landmarks[irisIndex]);
      pupilY = getY(landmarks[irisIndex]);
    }

    // Keep pupil constrained inside eye socket
    pupilX = Math.max(minX + eyeWidth * 0.2, Math.min(maxX - eyeWidth * 0.2, pupilX));
    pupilY = Math.max(minY + eyeHeight * 0.2, Math.min(maxY - eyeHeight * 0.2, pupilY));

    const irisRadius = Math.min(eyeHeight * 0.45, eyeWidth * 0.26);

    // Stylized Dark Iris
    ctx.beginPath();
    ctx.arc(pupilX, pupilY, Math.max(4, irisRadius), 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#60A5FA';
    ctx.stroke();

    // Pupil core
    ctx.beginPath();
    ctx.arc(pupilX, pupilY, Math.max(2, irisRadius * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();

    // Catchlight highlight reflection
    ctx.beginPath();
    ctx.arc(pupilX - irisRadius * 0.35, pupilY - irisRadius * 0.35, Math.max(1.5, irisRadius * 0.25), 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    // 3D Directional Gaze Ray (Gaze indicator)
    if (options.showGazeRays) {
      const gazeDx = pupilX - avgX;
      const gazeDy = pupilY - avgY;
      const rayLen = 45;
      const gazeMagnitude = Math.hypot(gazeDx, gazeDy);
      const nx = gazeMagnitude > 0.5 ? (gazeDx / gazeMagnitude) : 0;
      const ny = gazeMagnitude > 0.5 ? (gazeDy / gazeMagnitude) : 0;

      ctx.beginPath();
      ctx.moveTo(pupilX, pupilY);
      ctx.lineTo(pupilX + nx * rayLen, pupilY + ny * rayLen);
      ctx.strokeStyle = '#EE3B2B'; // Vermilion laser ray
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pupilX + nx * rayLen, pupilY + ny * rayLen, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#EE3B2B';
      ctx.fill();
    }
  };

  // MediaPipe Iris indices: 468 = Left eye iris center, 473 = Right eye iris center
  renderStylizedEye(LEFT_EYE_CONTOUR, 468, false);
  renderStylizedEye(RIGHT_EYE_CONTOUR, 473, true);

  // 6. Mouth & Speaking Cavity
  // Check mouth open amount
  const upperLip = landmarks[13]; // Center upper inner lip
  const lowerLip = landmarks[14]; // Center lower inner lip
  const mouthOpenDist = upperLip && lowerLip ? Math.hypot(getX(upperLip) - getX(lowerLip), getY(upperLip) - getY(lowerLip)) : 0;

  // Outer lips
  ctx.beginPath();
  ctx.moveTo(getX(landmarks[LIPS_OUTER[0]]), getY(landmarks[LIPS_OUTER[0]]));
  for (let i = 1; i < LIPS_OUTER.length; i++) {
    ctx.lineTo(getX(landmarks[LIPS_OUTER[i]]), getY(landmarks[LIPS_OUTER[i]]));
  }
  ctx.closePath();

  if (mouthOpenDist > 4) {
    // Speaking / Open cavity
    ctx.fillStyle = '#111317';
    ctx.fill();

    // Inner mouth cavity outline
    ctx.beginPath();
    ctx.moveTo(getX(landmarks[LIPS_INNER[0]]), getY(landmarks[LIPS_INNER[0]]));
    for (let i = 1; i < LIPS_INNER.length; i++) {
      ctx.lineTo(getX(landmarks[LIPS_INNER[i]]), getY(landmarks[LIPS_INNER[i]]));
    }
    ctx.closePath();
    ctx.fillStyle = '#090A0C';
    ctx.fill();
  }

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#E5E7EB';
  ctx.stroke();

  // 7. Motion Capture Tracking Dots (Cheeks, Jawline, Forehead)
  if (options.showMocapDots) {
    for (const idx of MOCAP_CHEEK_POINTS) {
      if (!landmarks[idx]) continue;
      const pt = landmarks[idx];
      const px = getX(pt);
      const py = getY(pt);

      // Tracking marker ring + bead
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 8. Face Orientation & Expression HUD readout in corner
  const jawDrop = blendshapes['jawOpen'] || (mouthOpenDist > 12 ? 0.6 : 0.0);
  const smileScore = Math.max(blendshapes['mouthSmileLeft'] || 0, blendshapes['mouthSmileRight'] || 0);
  const blinkLeft = blendshapes['eyeBlinkLeft'] || 0;
  const blinkRight = blendshapes['eyeBlinkRight'] || 0;

  // On-canvas Technical Telemetry Badge
  const hudX = 20;
  const hudY = 30;
  ctx.fillStyle = 'rgba(17, 19, 23, 0.85)';
  ctx.fillRect(hudX, hudY, 180, 84);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.strokeRect(hudX, hudY, 180, 84);

  ctx.fillStyle = '#9CA3AF';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('PUPPET KINEMATICS // SYS.04', hudX + 8, hudY + 16);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '10px monospace';
  ctx.fillText(`MOUTH: ${jawDrop > 0.25 ? 'OPEN [SPEAKING]' : 'CLOSED'}`, hudX + 8, hudY + 34);
  ctx.fillText(`EXPRESSION: ${smileScore > 0.3 ? 'SMILING' : 'NEUTRAL'}`, hudX + 8, hudY + 50);
  ctx.fillText(`GAZE: ${options.showGazeRays ? 'ACTIVE 3D VECTORS' : 'IDLE'}`, hudX + 8, hudY + 66);

  ctx.restore();
};
