/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Line Reliability: pure geometry helpers for the Air Canvas trace.
 *
 * These functions make a hand-drawn line survive sparse frames and brief
 * tracking dropouts, and let the drawn trail visibly relax toward a smoothed
 * shape over time. They are deliberately free of React and canvas so they can
 * be unit-tested in isolation. The stateful capture loop that drives them lives
 * in DebugView; the per-frame velocity bridging and settling are wired there.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Velocity {
  vx: number; // px per ms
  vy: number; // px per ms
}

export interface ReliabilityParams {
  /** How long a tracking dropout is tolerated before the stroke ends (ms). */
  graceMs: number;
  /** Insert points so no segment exceeds this length (px). Infinity = off. */
  densifySpacing: number;
  /** 0..1 amount of neighbour-average smoothing applied to the trace. */
  smoothingStrength: number;
  /** 0..1 per-frame easing of the drawn line toward its smoothed target. */
  relaxAlpha: number;
  /** Upper bound on points synthesised to bridge a dropout. */
  maxBridgePoints: number;
  /** Multiplier on predicted travel that sets the max plausible resume jump. */
  bridgePlausibility: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Maps the single "Line Reliability" slider (0..1) to the internal knobs.
 * At 0 every behaviour collapses to raw passthrough, so the slider has a true
 * "off" that reproduces the original capture semantics.
 */
export function reliabilityParams(slider01: number): ReliabilityParams {
  const s = clamp01(slider01);
  return {
    graceMs: s * 600,
    densifySpacing: s === 0 ? Infinity : 40 - s * 32,
    smoothingStrength: s * 0.9,
    relaxAlpha: 1 - s * 0.85,
    maxBridgePoints: 30,
    bridgePlausibility: 3,
  };
}

/**
 * Inserts linearly-interpolated points so no segment exceeds `spacing`.
 * Keeps fast sparse motion from looking polygonal. No-op when spacing is
 * Infinity (or non-positive) or there is nothing to fill.
 */
export function densify(raw: Pt[], spacing: number): Pt[] {
  if (raw.length < 2 || !isFinite(spacing) || spacing <= 0) {
    return raw.slice();
  }

  const out: Pt[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    out.push({ x: a.x, y: a.y });

    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist > spacing) {
      const steps = Math.ceil(dist / spacing);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }

  const last = raw[raw.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * Neighbour-average smoothing that pulls each interior point a fraction
 * (`strength`) toward the midpoint of its neighbours. Endpoints are fixed so
 * the line still starts and ends where the hand did.
 */
export function smoothLine(pts: Pt[], strength: number): Pt[] {
  const s = clamp01(strength);
  if (pts.length < 3 || s <= 0) {
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }

  const out = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let i = 1; i < pts.length - 1; i++) {
    const avgX = (pts[i - 1].x + pts[i + 1].x) * 0.5;
    const avgY = (pts[i - 1].y + pts[i + 1].y) * 0.5;
    out[i] = {
      x: pts[i].x + (avgX - pts[i].x) * s,
      y: pts[i].y + (avgY - pts[i].y) * s,
    };
  }
  return out;
}

/**
 * Densify then smooth: the smoothed target a stroke's display eases toward.
 */
export function resampleAndSmooth(raw: Pt[], params: ReliabilityParams): Pt[] {
  return smoothLine(densify(raw, params.densifySpacing), params.smoothingStrength);
}

/**
 * Eases the current `display` points a fraction (`alpha`) toward `target`.
 * When the two differ in length (the target gained or lost points) it snaps to
 * a fresh copy of the target rather than trying to pair mismatched indices.
 */
export function relaxToward(display: Pt[], target: Pt[], alpha: number): Pt[] {
  if (display.length !== target.length) {
    return target.map((p) => ({ x: p.x, y: p.y }));
  }
  const a = clamp01(alpha);
  return display.map((p, i) => ({
    x: p.x + (target[i].x - p.x) * a,
    y: p.y + (target[i].y - p.y) * a,
  }));
}

/**
 * Builds a velocity-predicted bridge from `last` to `resume` across a dropout.
 * Uses the pre-dropout velocity as a quadratic-bezier control point so the
 * bridge curves the way the hand was probably heading. Returns null when the
 * resume point is implausibly far for the elapsed time, signalling the caller
 * to start a fresh stroke instead of gluing two unrelated segments together.
 */
export function bridgeGap(
  last: Pt,
  vel: Velocity,
  resume: Pt,
  dtMs: number,
  params: ReliabilityParams
): Pt[] | null {
  const speed = Math.hypot(vel.vx, vel.vy); // px/ms
  const predictedTravel = speed * dtMs;
  const gapDist = Math.hypot(resume.x - last.x, resume.y - last.y);

  // Slack constant so a near-still hand that briefly drops still reconnects.
  const maxPlausible = predictedTravel * params.bridgePlausibility + 60;
  if (gapDist > maxPlausible) {
    return null;
  }

  const ctrl: Pt = { x: last.x + vel.vx * dtMs, y: last.y + vel.vy * dtMs };
  const spacing = Math.min(params.densifySpacing, 24);
  const steps = Math.min(
    params.maxBridgePoints,
    Math.max(1, Math.ceil(gapDist / spacing))
  );

  const out: Pt[] = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const mt = 1 - t;
    out.push({
      x: mt * mt * last.x + 2 * mt * t * ctrl.x + t * t * resume.x,
      y: mt * mt * last.y + 2 * mt * t * ctrl.y + t * t * resume.y,
    });
  }
  return out;
}
