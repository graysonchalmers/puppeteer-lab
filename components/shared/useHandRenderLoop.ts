/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared per-frame scaffolding for the hand-tracking demos: size the canvas to
 * the video, draw the mirrored webcam frame, and run the rAF loop. Each demo
 * supplies its own drawFrame for everything it paints on top.
 */
import { useEffect } from 'react';

export interface RenderFrame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  nowMs: number;
}

export function useHandRenderLoop(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  videoRef: React.RefObject<HTMLVideoElement>,
  active: boolean,
  isCameraReady: boolean,
  drawFrame: (frame: RenderFrame) => void
): void {
  useEffect(() => {
    if (!active) return;

    let animationFrameId: number;
    const renderLoop = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (video && video.videoWidth > 0) {
            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (isCameraReady && video && video.readyState >= 2) {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.translate(-canvas.width, 0);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }

          drawFrame({ canvas, ctx, nowMs: performance.now() });
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [active, isCameraReady, canvasRef, videoRef, drawFrame]);
}
