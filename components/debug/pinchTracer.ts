/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface StrokePoint {
  x: number;
  y: number;
}

/**
 * A drawn stroke carries two buffers: `raw` (exactly what the hand gave us,
 * the source of truth for re-smoothing and manipulation) and `display` (the
 * smoothed geometry actually rendered, which eases toward its target so the
 * trail visibly relaxes). `settleMsLeft` counts down the post-commit window
 * during which `display` is still easing toward its smoothed target.
 */
export interface Stroke {
  raw: StrokePoint[];
  display: StrokePoint[];
  settleMsLeft: number;
}

export interface TracerParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  decay: number;
  color: string;
  gravity?: number;
  drag?: number;
}

const PARTICLE_PALETTE = ['#F59E0B', '#FCD34D', '#F97316', '#FEF08A', '#38BDF8'];

/**
 * Spawns kinetic spark particles with drag and gravity parameters
 */
export const spawnTracerParticles = (
  particles: TracerParticle[],
  x: number,
  y: number,
  count = 5
) => {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Initial velocity burst
    const speed = 2.0 + Math.random() * 4.5;
    const color = PARTICLE_PALETTE[Math.floor(Math.random() * PARTICLE_PALETTE.length)];
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2, // slight upward explosion before gravity kicks in
      size: 3.5 + Math.random() * 3.5,
      life: 1.0,
      decay: 0.012 + Math.random() * 0.016,
      color,
      gravity: 0.22, // Downward gravitational acceleration
      drag: 0.965    // Air resistance deceleration
    });
  }
  // Cap max particles to ensure high 60fps performance
  if (particles.length > 350) {
    particles.splice(0, particles.length - 350);
  }
};

/**
 * Updates physics (Drag + Gravity) and renders active particles
 */
export const updateAndRenderParticles = (
  ctx: CanvasRenderingContext2D,
  particles: TracerParticle[]
) => {
  if (particles.length === 0) return;

  ctx.save();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    
    // Apply realistic gravity & air resistance drag
    const grav = p.gravity ?? 0.22;
    const drag = p.drag ?? 0.965;

    p.vy += grav;
    p.vx *= drag;
    p.vy *= drag;

    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    p.size *= 0.985;

    if (p.life <= 0 || p.size < 0.5) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    
    // Spark circular particle with bloom
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
};

/**
 * Calculates minimum distance from a point to any segment in a stroke
 */
export const distToStroke = (px: number, py: number, stroke: StrokePoint[]): number => {
  if (stroke.length === 0) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < stroke.length; i++) {
    const d = Math.hypot(stroke[i].x - px, stroke[i].y - py);
    if (d < minDist) minDist = d;
  }
  return minDist;
};

export interface LeftHandGrabState {
  grabbedStrokeIndex: number | null;
  lastPinchX: number;
  lastPinchY: number;
  holdAnchorX: number;
  holdAnchorY: number;
  holdDurationMs: number;
  justDeleted: boolean;
}

export interface LeftHandInteractionResult {
  action: 'grab' | 'emit' | 'delete' | 'none';
  grabbedIndex?: number;
  holdProgress?: number; // 0.0 to 1.0 (for deletion progress)
}

/**
 * Handles Left Hand Pinch:
 * 1. Grabs existing drawn strokes if pinched within 45px.
 * 2. Moves the grabbed stroke as the left hand translates.
 * 3. Deletes the grabbed stroke if held stationary for 1.0 second.
 * 4. Emits kinetic gravity/drag spark particles if pinching in open air.
 */
export const handleLeftHandStrokeInteraction = (
  pinchX: number,
  pinchY: number,
  isPinching: boolean,
  completedStrokes: Stroke[],
  state: LeftHandGrabState,
  particles: TracerParticle[],
  dtSeconds: number
): LeftHandInteractionResult => {
  if (!isPinching) {
    state.grabbedStrokeIndex = null;
    state.holdDurationMs = 0;
    state.justDeleted = false;
    return { action: 'none' };
  }

  // If currently not grabbing any stroke, try to find a stroke within grab radius
  if (state.grabbedStrokeIndex === null) {
    let closestIndex = -1;
    let closestDist = 48; // Grab proximity threshold in pixels

    for (let i = completedStrokes.length - 1; i >= 0; i--) {
      // Hit-test against the displayed geometry, since that is what the user sees.
      const d = distToStroke(pinchX, pinchY, completedStrokes[i].display);
      if (d < closestDist) {
        closestDist = d;
        closestIndex = i;
      }
    }

    if (closestIndex !== -1) {
      state.grabbedStrokeIndex = closestIndex;
      state.lastPinchX = pinchX;
      state.lastPinchY = pinchY;
      state.holdAnchorX = pinchX;
      state.holdAnchorY = pinchY;
      state.holdDurationMs = 0;
      state.justDeleted = false;
    } else {
      // In open air: spawn dynamic particles with drag and gravity
      spawnTracerParticles(particles, pinchX, pinchY, 4);
      return { action: 'emit' };
    }
  }

  // Active stroke grab processing
  if (state.grabbedStrokeIndex !== null) {
    if (state.grabbedStrokeIndex >= completedStrokes.length) {
      state.grabbedStrokeIndex = null;
      return { action: 'none' };
    }

    const stroke = completedStrokes[state.grabbedStrokeIndex];
    const dx = pinchX - state.lastPinchX;
    const dy = pinchY - state.lastPinchY;

    // Rigid translation moves both buffers so the smoothed shape is preserved
    // and future re-smoothing of the raw points stays correct.
    const translateStroke = (mdx: number, mdy: number) => {
      for (const p of stroke.raw) {
        p.x += mdx;
        p.y += mdy;
      }
      for (const p of stroke.display) {
        p.x += mdx;
        p.y += mdy;
      }
    };

    // Check displacement from anchor to determine if moving or holding still
    const distFromAnchor = Math.hypot(pinchX - state.holdAnchorX, pinchY - state.holdAnchorY);

    if (distFromAnchor > 10) {
      // User is moving/translating the line
      state.holdDurationMs = 0;
      state.holdAnchorX = pinchX;
      state.holdAnchorY = pinchY;

      translateStroke(dx, dy);

      state.lastPinchX = pinchX;
      state.lastPinchY = pinchY;

      return {
        action: 'grab',
        grabbedIndex: state.grabbedStrokeIndex,
        holdProgress: 0
      };
    } else {
      // User is holding stationary: accumulate deletion dwell timer
      state.holdDurationMs += dtSeconds * 1000;

      // Apply small incremental translation to keep feel smooth
      translateStroke(dx, dy);
      state.lastPinchX = pinchX;
      state.lastPinchY = pinchY;

      // Trigger deletion when held stationary for 1.0 second (1000ms)
      if (state.holdDurationMs >= 1000) {
        completedStrokes.splice(state.grabbedStrokeIndex, 1);
        // Burst of sparks when deleted
        spawnTracerParticles(particles, pinchX, pinchY, 16);

        state.grabbedStrokeIndex = null;
        state.holdDurationMs = 0;
        state.justDeleted = true;
        return { action: 'delete' };
      }

      const holdProgress = Math.min(1.0, state.holdDurationMs / 1000);
      return {
        action: 'grab',
        grabbedIndex: state.grabbedStrokeIndex,
        holdProgress
      };
    }
  }

  return { action: 'none' };
};

/**
 * Renders complete persistent strokes and active drawing stroke
 */
export const renderStrokes = (
  ctx: CanvasRenderingContext2D,
  completedStrokes: Stroke[],
  currentDisplay: StrokePoint[],
  primaryColor = '#EE3B2B',
  grabbedIndex: number | null = null,
  grabHoldProgress = 0,
  leftPinchPos: { x: number; y: number } | null = null
) => {
  // Render each completed stroke's smoothed display buffer, then the live one.
  const allStrokes: StrokePoint[][] = completedStrokes.map((s) =>
    s.display.length > 1 ? s.display : s.raw
  );
  if (currentDisplay.length > 1) allStrokes.push(currentDisplay);
  if (allStrokes.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  allStrokes.forEach((stroke, idx) => {
    if (stroke.length < 2) return;

    const isGrabbed = idx === grabbedIndex;

    // Outer bloom
    ctx.beginPath();
    ctx.strokeStyle = isGrabbed ? 'rgba(56, 189, 248, 0.45)' : 'rgba(238, 59, 43, 0.35)';
    ctx.lineWidth = isGrabbed ? 12 : 8;
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();

    // High-contrast inner laser core
    ctx.beginPath();
    ctx.strokeStyle = isGrabbed ? '#38BDF8' : primaryColor;
    ctx.lineWidth = isGrabbed ? 4.5 : 3.5;
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();

    // Grabbed manipulation handles
    if (isGrabbed && stroke.length > 0) {
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, 4, 0, Math.PI * 2);
      ctx.arc(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Render Hold-to-Delete Ring at left pinch coordinate
  if (grabbedIndex !== null && leftPinchPos && grabHoldProgress > 0.05) {
    ctx.save();
    const { x, y } = leftPinchPos;
    ctx.beginPath();
    ctx.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + grabHoldProgress * Math.PI * 2);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#EE3B2B';
    ctx.stroke();

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#EE3B2B';
    ctx.textAlign = 'center';
    ctx.fillText(`HOLD TO DELETE ${(grabHoldProgress * 100).toFixed(0)}%`, x, y - 28);
    ctx.restore();
  }

  ctx.restore();
};

/**
 * Renders an aerospace-style targeting reticle when pinch threshold is triggered
 */
export const renderPinchReticle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dist: number,
  modeLabel: string,
  color: string
) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;

  // Pulsing circle
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshairs
  ctx.beginPath();
  ctx.moveTo(x - 22, y);
  ctx.lineTo(x - 12, y);
  ctx.moveTo(x + 12, y);
  ctx.lineTo(x + 22, y);
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x, y - 12);
  ctx.moveTo(x, y + 12);
  ctx.lineTo(x, y + 22);
  ctx.stroke();

  // Technical HUD label
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${modeLabel} [${dist.toFixed(0)}px]`, x, y - 26);
  ctx.restore();
};

/**
 * Hands-Free Air-Touch Dwell Controls: UNDO and CLEAR ALL
 */
export interface AirTouchDwellState {
  undoProgress: number;   // 0.0 to 1.0 (1.2s required)
  clearProgress: number;  // 0.0 to 1.0 (1.5s required)
  undoTriggered: boolean;
  clearTriggered: boolean;
  lastTimeMs: number;
}

export const renderAirTouchControls = (
  ctx: CanvasRenderingContext2D,
  pointers: { x: number; y: number }[],
  state: AirTouchDwellState,
  w: number,
  nowMs: number,
  onUndo: () => void,
  onClear: () => void
) => {
  const dt = state.lastTimeMs > 0 ? (nowMs - state.lastTimeMs) / 1000 : 0.016;
  state.lastTimeMs = nowMs;

  // Targets in top right corner
  const clearBtn = { x: w - 70, y: 75, radius: 26, label: 'CLEAR ALL', timeSec: 1.5 };
  const undoBtn  = { x: w - 145, y: 75, radius: 26, label: 'UNDO', timeSec: 1.2 };

  let clearHovered = false;
  let undoHovered = false;
  let clearPointer: { x: number; y: number } | null = null;
  let undoPointer: { x: number; y: number } | null = null;

  for (const pt of pointers) {
    if (Math.hypot(pt.x - clearBtn.x, pt.y - clearBtn.y) <= clearBtn.radius + 15) {
      clearHovered = true;
      clearPointer = pt;
      break;
    }
  }

  for (const pt of pointers) {
    if (Math.hypot(pt.x - undoBtn.x, pt.y - undoBtn.y) <= undoBtn.radius + 15) {
      undoHovered = true;
      undoPointer = pt;
      break;
    }
  }

  // Handle UNDO dwell timer
  if (undoHovered) {
    if (!state.undoTriggered) {
      state.undoProgress = Math.min(1.0, state.undoProgress + dt / undoBtn.timeSec);
      if (state.undoProgress >= 1.0) {
        state.undoTriggered = true;
        onUndo();
      }
    }
  } else {
    state.undoProgress = Math.max(0, state.undoProgress - dt * 2.5);
    state.undoTriggered = false;
  }

  // Handle CLEAR dwell timer
  if (clearHovered) {
    if (!state.clearTriggered) {
      state.clearProgress = Math.min(1.0, state.clearProgress + dt / clearBtn.timeSec);
      if (state.clearProgress >= 1.0) {
        state.clearTriggered = true;
        onClear();
      }
    }
  } else {
    state.clearProgress = Math.max(0, state.clearProgress - dt * 2.5);
    state.clearTriggered = false;
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;

  // Render UNDO Button
  drawDwellButton(
    ctx,
    undoBtn.x,
    undoBtn.y,
    undoBtn.radius,
    'UNDO',
    '1.2s',
    undoHovered,
    state.undoProgress,
    state.undoTriggered,
    undoPointer,
    '#38BDF8'
  );

  // Render CLEAR ALL Button
  drawDwellButton(
    ctx,
    clearBtn.x,
    clearBtn.y,
    clearBtn.radius,
    'CLEAR',
    '1.5s',
    clearHovered,
    state.clearProgress,
    state.clearTriggered,
    clearPointer,
    '#EE3B2B'
  );

  ctx.restore();
};

const drawDwellButton = (
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  radius: number,
  title: string,
  sub: string,
  hovered: boolean,
  progress: number,
  triggered: boolean,
  pointer: { x: number; y: number } | null,
  accentColor: string
) => {
  // Laser tether from pointing finger
  if (hovered && pointer) {
    ctx.beginPath();
    ctx.moveTo(pointer.x, pointer.y);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Base disc
  ctx.beginPath();
  ctx.arc(bx, by, radius, 0, Math.PI * 2);
  ctx.fillStyle = hovered ? 'rgba(25, 28, 35, 0.95)' : 'rgba(14, 16, 20, 0.75)';
  ctx.fill();
  ctx.lineWidth = hovered ? 2 : 1;
  ctx.strokeStyle = hovered ? accentColor : 'rgba(255, 255, 255, 0.25)';
  ctx.stroke();

  // Progress Ring
  if (progress > 0) {
    ctx.beginPath();
    ctx.arc(bx, by, radius + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = accentColor;
    ctx.stroke();
  }

  // Label
  ctx.fillStyle = hovered ? accentColor : '#FFFFFF';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(triggered ? 'DONE!' : title, bx, by - 4);

  ctx.font = '8px monospace';
  ctx.fillStyle = hovered ? '#E5E7EB' : '#9CA3AF';
  ctx.fillText(sub, bx, by + 7);
};
