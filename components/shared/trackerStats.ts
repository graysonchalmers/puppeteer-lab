/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live numbers from the tracker loop for the debug overlay: smoothed per-model inference times, the face rate, and a
 * short ring of recent ticks (how long each took, whether a hand was in view, whether the face model ran) so a
 * slowdown can be lined up with what was on camera. Written by useTracker each tick; read a few times a second.
 */
import type { Delegate } from '../../hooks/cameraSupport';

export interface TrackerStats {
  /** Tracker ticks per second (rAF loop, successful ticks only). */
  trackFps: number;
  /** The frame rate the camera track was granted (`getSettings().frameRate`); 0 when the browser does not report it. */
  cameraFps: number;
  /** Face-model runs per second; below trackFps when the face runs on alternate ticks. */
  faceFps: number;
  delegate: Delegate | null;
  /** Smoothed milliseconds spent in each model's detectForVideo (0 until it has run). */
  handMs: number;
  faceMs: number;
  /** Smoothed milliseconds for the whole tick (both models plus buildFrame). */
  tickMs: number;
  /** The face model is running on alternate ticks (the cost policy kicked in). */
  alternating: boolean;
  /** Hands and face found in the latest tick. */
  hands: number;
  face: boolean;
}

export function createTrackerStats(): TrackerStats {
  return { trackFps: 0, cameraFps: 0, faceFps: 0, delegate: null, handMs: 0, faceMs: 0, tickMs: 0, alternating: false, hands: 0, face: false };
}

/** Exponential moving average; the first sample (prev 0) is taken as is. */
export function ema(prev: number, sample: number, alpha = 0.2): number {
  return prev === 0 ? sample : prev + (sample - prev) * alpha;
}

export interface TickSample { ms: number; hands: number; faceRan: boolean }

/** Fixed-size ring of the most recent ticks. */
export function createTickHistory(size = 60) {
  const ms = new Float32Array(size);
  const hands = new Uint8Array(size);
  const faceRan = new Uint8Array(size);
  let next = 0;
  let count = 0;
  return {
    push(s: TickSample) {
      ms[next] = s.ms;
      hands[next] = s.hands;
      faceRan[next] = s.faceRan ? 1 : 0;
      next = (next + 1) % size;
      count = Math.min(count + 1, size);
    },
    /** Oldest to newest. */
    read(): TickSample[] {
      const out: TickSample[] = [];
      for (let k = 0; k < count; k++) {
        const i = (next - count + k + size) % size;
        out.push({ ms: ms[i], hands: hands[i], faceRan: faceRan[i] === 1 });
      }
      return out;
    },
  };
}
