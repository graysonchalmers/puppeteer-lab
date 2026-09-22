/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Idle auto-pause: after IDLE_MS with no input on the page (and no tracked
 * hands, which count as using the app) the camera and trackers shut down so an
 * open tab does not keep the webcam and GPU busy. A click or key resumes.
 * Holds (recording, exporting) keep it awake. Module-level store, read in
 * React with useSyncExternalStore; the timer only runs while a tracker is on.
 */
import { useSyncExternalStore } from 'react';

export const IDLE_MS = 60_000;

let paused = false;
let lastActivity = Date.now();
let trackers = 0;
let holds = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function setPaused(p: boolean) {
  if (p === paused) return;
  paused = p;
  emit();
}

/** Any sign of use: input, tracked hands. Cheap; safe to call every frame. */
export function poke(now = Date.now()) {
  lastActivity = now;
}

export function resume() {
  poke();
  setPaused(false);
}

/** Pure rule, exported for tests. */
export function shouldPause(now: number, last: number, activeTrackers: number, activeHolds: number): boolean {
  return activeTrackers > 0 && activeHolds === 0 && now - last >= IDLE_MS;
}

function check() {
  if (!paused && shouldPause(Date.now(), lastActivity, trackers, holds)) setPaused(true);
}

const onInput = () => (paused ? undefined : poke());
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** A tracker is running (camera on). Returns the release function. */
export function registerTracker(): () => void {
  if (trackers++ === 0) {
    poke();
    INPUT_EVENTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    timer = setInterval(check, 1000);
  }
  return () => {
    if (--trackers > 0) return;
    INPUT_EVENTS.forEach((e) => window.removeEventListener(e, onInput));
    if (timer) clearInterval(timer);
    timer = null;
    // Pausing itself releases the tracker, so this must NOT clear the pause;
    // IdleOverlay clears it when you leave the demo.
  };
}

/** Keep awake while something long-running happens (recording, export). */
export function holdAwake(): () => void {
  holds++;
  poke();
  return () => {
    holds = Math.max(0, holds - 1);
    poke(); // a fresh idle window starts when the hold ends
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useIdlePaused(): boolean {
  return useSyncExternalStore(subscribe, () => paused);
}
