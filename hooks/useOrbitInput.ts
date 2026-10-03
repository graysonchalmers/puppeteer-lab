/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pointer wiring for the orbit view: one pointer drags, two pinch, the wheel zooms, a double tap/click resets.
 * The view lives in a ref (the render loops read it every frame), so dragging causes no React renders.
 */
import { RefObject, useEffect } from 'react';
import { FRONT_VIEW, OrbitView, dragView, pinchFactor, wheelFactor, zoomView } from '../components/face/orbitState';

const TAP_MS = 300;
const TAP_SLOP_PX = 24;
const MOVE_SLOP_PX = 8;

export function useOrbitInput(ref: RefObject<HTMLElement>, enabled: boolean, viewRef: { current: OrbitView }): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const prevTouch = el.style.touchAction;
    const prevCursor = el.style.cursor;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let travel = 0;
    let multi = false;
    let lastTap = 0;
    let lastX = 0;
    let lastY = 0;
    const size = () => Math.max(1, Math.min(el.clientWidth, el.clientHeight));
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const down = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        multi = true;
        pinchDist = spread();
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      travel += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 1) {
        viewRef.current = dragView(viewRef.current, dx, dy, size());
      } else if (pointers.size === 2) {
        const d = spread();
        viewRef.current = zoomView(viewRef.current, pinchFactor(pinchDist, d));
        pinchDist = d;
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      const isTap = !multi && travel < MOVE_SLOP_PX && e.type === 'pointerup';
      multi = false;
      travel = 0;
      if (!isTap) return;
      const now = performance.now();
      if (now - lastTap < TAP_MS && Math.hypot(e.clientX - lastX, e.clientY - lastY) < TAP_SLOP_PX) {
        viewRef.current = FRONT_VIEW;
        lastTap = 0;
      } else {
        lastTap = now;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaMode 1 = lines, 2 = pages; normalize to pixels before the factor curve.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      viewRef.current = zoomView(viewRef.current, wheelFactor(e.deltaY * unit));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.style.touchAction = prevTouch;
      el.style.cursor = prevCursor;
    };
  }, [ref, enabled, viewRef]);
}
