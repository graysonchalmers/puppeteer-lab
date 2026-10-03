/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orbit camera state for take playback: pure functions over { yaw, pitch, zoom }. Only the front surface of the
 * head was captured, so the range is limited (no look-behind). The pointer wiring lives in hooks/useOrbitInput.ts.
 */
export interface OrbitView {
  yaw: number; // radians; the camera moves toward +x for positive yaw
  pitch: number; // radians; positive lifts the camera
  zoom: number; // distance multiplier from the front pose
}

export const FRONT_VIEW: OrbitView = { yaw: 0, pitch: 0, zoom: 1 };
export const YAW_LIMIT = (75 * Math.PI) / 180;
export const PITCH_LIMIT = (40 * Math.PI) / 180;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampView(v: OrbitView): OrbitView {
  return { yaw: clamp(v.yaw, -YAW_LIMIT, YAW_LIMIT), pitch: clamp(v.pitch, -PITCH_LIMIT, PITCH_LIMIT), zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX) };
}

/** A drag across the whole element is 180 degrees. Drag right turns the camera toward -yaw; drag down raises it. */
export function dragView(v: OrbitView, dxPx: number, dyPx: number, sizePx: number): OrbitView {
  const k = Math.PI / Math.max(1, sizePx);
  return clampView({ ...v, yaw: v.yaw - dxPx * k, pitch: v.pitch + dyPx * k });
}

export function zoomView(v: OrbitView, factor: number): OrbitView {
  return clampView({ ...v, zoom: v.zoom * factor });
}

export const wheelFactor = (deltaY: number): number => Math.exp(clamp(deltaY, -500, 500) * 0.002);

export const pinchFactor = (prevDist: number, nextDist: number): number => (prevDist > 0 && nextDist > 0 ? prevDist / nextDist : 1);

export const isFrontView = (v: OrbitView): boolean => v.yaw === 0 && v.pitch === 0 && v.zoom === 1;
