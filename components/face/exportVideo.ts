/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Replays a take into an offscreen canvas in real time and records it with
 * MediaRecorder: canvas.captureStream(30) for video plus the take's audio
 * routed through Web Audio into the same stream (not to the speakers). The
 * audio element is the master clock, so lips and voice stay in sync. Takes
 * as long as the take; rAF pauses in a hidden tab, which stalls (not fails)
 * the export.
 *
 * A short lead-in holds frame 0 while the encoder warms up, and a short tail
 * holds the final frame while MediaRecorder.stop() flushes — both browser
 * behaviors otherwise clip real frames off the ends of the clip. The take's
 * own clock still runs 0..durationMs; only the encoding window is padded.
 */
import { FrameData } from '../../types';
import { findFrameIndex } from '../../hooks/useRecorder';
import { pickVideoMime } from './exportPack';

export interface RenderTakeOptions {
  frames: FrameData[];
  durationMs: number;
  audio: { blob: Blob; mimeType: string } | null;
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, frame: FrameData, w: number, h: number) => void;
  onProgress?: (ms: number) => void;
  signal: AbortSignal;
}

const LEAD_IN_MS = 250;
const TAIL_MS = 250;

/** Redraws via `draw` on every rAF for at least `ms`, bailing immediately if `signal` aborts or `draw` throws. */
function holdFrame(signal: AbortSignal, ms: number, draw: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (signal.aborted) return resolve();
      try {
        draw();
      } catch (err) {
        return reject(err);
      }
      if (performance.now() - start >= ms) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export async function renderTakeToVideo(o: RenderTakeOptions): Promise<{ blob: Blob; mimeType: string }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (no MediaRecorder).');
  const mimeType = pickVideoMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mimeType) throw new Error('This browser cannot record video (no supported MP4/WebM type).');

  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas for export.');
  o.draw(ctx, o.frames[0], o.width, o.height);

  const stream = canvas.captureStream(30);

  let audioEl: HTMLAudioElement | null = null;
  let audioCtx: AudioContext | null = null;
  let audioUrl: string | null = null;
  if (o.audio) {
    audioUrl = URL.createObjectURL(o.audio.blob);
    audioEl = new Audio(audioUrl);
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(audioEl);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest); // deliberately NOT to audioCtx.destination: silent export
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('MediaRecorder failed during export.'));
  });
  const started = new Promise<void>((resolve) => { recorder.onstart = () => resolve(); });

  // Any throw from here (a bad `draw`, an onProgress that throws, a cancel)
  // lands in `renderError` / o.signal.aborted below; the finally block below
  // guarantees the recorder is asked to stop and audio is paused on every
  // path so `stopped` always eventually settles and cleanup can proceed.
  let renderError: unknown = null;
  try {
    recorder.start(250);
    await started;

    // Lead-in: hold frame 0 while the encoder warms up, so the take's real
    // first frames aren't the ones dropped once the clock starts.
    await holdFrame(o.signal, LEAD_IN_MS, () => o.draw(ctx, o.frames[0], o.width, o.height));

    if (!o.signal.aborted) {
      const t0 = performance.now();
      if (audioEl && audioCtx) {
        try {
          await audioCtx.resume();
          await audioEl.play();
        } catch (err) {
          console.warn('Export audio could not start; exporting silent video on the wall clock:', err);
          audioEl = null;
        }
      }

      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (o.signal.aborted) return resolve();
          try {
            const clock = audioEl ? audioEl.currentTime * 1000 : performance.now() - t0;
            o.draw(ctx, o.frames[findFrameIndex(o.frames, clock)], o.width, o.height);
            o.onProgress?.(Math.min(clock, o.durationMs));
            if (clock >= o.durationMs || audioEl?.ended) return resolve();
            requestAnimationFrame(tick);
          } catch (err) {
            reject(err);
          }
        };
        tick();
      });

      if (!o.signal.aborted) {
        // Tail: hold the final frame briefly so MediaRecorder.stop() doesn't
        // clip frames still in flight to the encoder.
        const finalFrame = o.frames[o.frames.length - 1];
        await holdFrame(o.signal, TAIL_MS, () => o.draw(ctx, finalFrame, o.width, o.height));
      }
    }
  } catch (err) {
    renderError = err;
  } finally {
    audioEl?.pause();
    if (recorder.state !== 'inactive') recorder.stop();
  }

  let blob: Blob | null = null;
  try {
    blob = await stopped;
  } catch (err) {
    renderError = renderError ?? err;
  }

  // Stream tracks are only released once `stopped` has settled: stopping
  // them earlier can truncate whatever MediaRecorder was still flushing.
  stream.getTracks().forEach((t) => t.stop());
  await audioCtx?.close();
  if (audioUrl) URL.revokeObjectURL(audioUrl);

  if (renderError) throw renderError;
  if (o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return { blob: blob!, mimeType };
}
