/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FRONT_VIEW, PITCH_LIMIT, YAW_LIMIT, ZOOM_MAX, ZOOM_MIN, clampView, dragView, isFrontView, pinchFactor, wheelFactor, zoomView } from './orbitState';

const deg = (d: number) => (d * Math.PI) / 180;

describe('limits', () => {
  it('are 75 degrees yaw, 40 degrees pitch, zoom 0.5 to 2', () => {
    expect(YAW_LIMIT).toBeCloseTo(deg(75), 9);
    expect(PITCH_LIMIT).toBeCloseTo(deg(40), 9);
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.5, 2]);
  });
});

describe('dragView', () => {
  it('a full-size drag is 180 degrees before clamping', () => {
    const v = dragView(FRONT_VIEW, 0, 100, 1000); // 10% of the size = 18 degrees
    expect(v.pitch).toBeCloseTo(deg(18), 6);
  });
  it('dragging right turns the camera toward negative yaw', () => {
    expect(dragView(FRONT_VIEW, 100, 0, 1000).yaw).toBeLessThan(0);
    expect(dragView(FRONT_VIEW, -100, 0, 1000).yaw).toBeGreaterThan(0);
  });
  it('clamps yaw and pitch however far the drag goes', () => {
    const v = dragView(FRONT_VIEW, -100000, 100000, 500);
    expect(v.yaw).toBeCloseTo(YAW_LIMIT, 9);
    expect(v.pitch).toBeCloseTo(PITCH_LIMIT, 9);
    const w = dragView(FRONT_VIEW, 100000, -100000, 500);
    expect(w.yaw).toBeCloseTo(-YAW_LIMIT, 9);
    expect(w.pitch).toBeCloseTo(-PITCH_LIMIT, 9);
  });
  it('tolerates a zero-size element', () => {
    expect(Number.isFinite(dragView(FRONT_VIEW, 10, 10, 0).yaw)).toBe(true);
  });
  it('keeps zoom', () => expect(dragView({ ...FRONT_VIEW, zoom: 1.5 }, 10, 10, 500).zoom).toBe(1.5));
});

describe('zoom', () => {
  it('multiplies and clamps to 0.5..2', () => {
    expect(zoomView(FRONT_VIEW, 1.5).zoom).toBe(1.5);
    expect(zoomView(FRONT_VIEW, 100).zoom).toBe(ZOOM_MAX);
    expect(zoomView(FRONT_VIEW, 0.001).zoom).toBe(ZOOM_MIN);
  });
  it('wheel up (negative deltaY) zooms in, down zooms out, and a huge delta stays finite', () => {
    expect(wheelFactor(-100)).toBeLessThan(1);
    expect(wheelFactor(100)).toBeGreaterThan(1);
    expect(Number.isFinite(wheelFactor(1e9))).toBe(true);
  });
  it('fingers apart zooms in', () => {
    expect(pinchFactor(100, 200)).toBeLessThan(1);
    expect(pinchFactor(200, 100)).toBeGreaterThan(1);
    expect(pinchFactor(0, 100)).toBe(1);
  });
});

describe('reset', () => {
  it('FRONT_VIEW is recognised and a moved view is not', () => {
    expect(isFrontView(FRONT_VIEW)).toBe(true);
    expect(isFrontView(dragView(FRONT_VIEW, 50, 0, 500))).toBe(false);
    expect(clampView({ yaw: 9, pitch: -9, zoom: 9 })).toEqual({ yaw: YAW_LIMIT, pitch: -PITCH_LIMIT, zoom: ZOOM_MAX });
  });
});
