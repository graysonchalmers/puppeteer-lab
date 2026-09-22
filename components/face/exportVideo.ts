/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Replays a take into an offscreen canvas in real time and records it with
 * MediaRecorder: canvas.captureStream(30) for video plus the take's audio
 * routed through Web Audio into the same stream (not to the speakers). The
 * audio element is the master clock (shifted by the take's audio offsetMs:
 * the mic starts a beat after frame 0), so lips and voice stay in sync. Takes
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
  /** offsetMs: frame time at which the audio's own time 0 falls (v3
   * audio.offsetMs, default 0); the audio clock is shifted by it. */
  audio: { blob: Blob; mimeType: string; offsetMs?: number } | null;
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
  let recorder: MediaRecorder | null = null;
  let stopped: Promise<Blob> | null = null;
  let didStart = false;
  const chunks: Blob[] = [];
  const audioOffsetMs = o.audio?.offsetMs ?? 0;

  // Resolves on Cancel, so a recorder whose onstart never fires can't pin
  // the export (and every control it disables) forever.
  let onAbort: (() => void) | null = null;
  const abortPromise = new Promise<void>((resolve) => {
    if (o.signal.aborted) return resolve();
    onAbort = () => resolve();
    o.signal.addEventListener('abort', onAbort, { once: true });
  });

  // Every throw from here (audio graph or MediaRecorder setup, start(), a bad
  // `draw`, an onProgress that throws, a cancel) lands in `renderError` /
  // o.signal.aborted; the finally block and the cleanup after it run on every
  // path, so the AudioContext, blob URL and canvas track are always released.
  let renderError: unknown = null;
  try {
    if (o.audio) {
      audioUrl = URL.createObjectURL(o.audio.blob);
      audioEl = new Audio(audioUrl);
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaElementSource(audioEl);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest); // deliberately NOT to audioCtx.destination: silent export
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }

    const rec = new MediaRecorder(stream, { mimeType });
    recorder = rec;
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    stopped = new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      rec.onerror = () => reject(new Error('MediaRecorder failed during export.'));
    });
    stopped.catch(() => {}); // observed below only if start() succeeded
    const started = new Promise<void>((resolve) => { rec.onstart = () => resolve(); });

    rec.start(250);
    didStart = true;
    await Promise.race([started, stopped.then(() => {}), abortPromise]);
    if (!o.signal.aborted && rec.state === 'inactive') {
      throw new Error('MediaRecorder stopped before the export started.');
    }

    // Lead-in: hold frame 0 while the encoder warms up, so the take's real
    // first frames aren't the ones dropped once the clock starts.
    await holdFrame(o.signal, LEAD_IN_MS, () => o.draw(ctx, o.frames[0], o.width, o.height));

    if (!o.signal.aborted) {
      const t0 = performance.now();
      if (audioEl && audioCtx) {
        try {
          await audioCtx.resume();
          if (!o.signal.aborted) await audioEl.play();
        } catch (err) {
          console.warn('Export audio could not start; exporting silent video on the wall clock:', err);
          audioEl.pause();
          audioEl = null;
        }
      }

      if (!o.signal.aborted) {
        await new Promise<void>((resolve, reject) => {
          const tick = () => {
            if (o.signal.aborted) return resolve();
            try {
              const clock = audioEl ? audioEl.currentTime * 1000 + audioOffsetMs : performance.now() - t0;
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
      }

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
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch (err) {
      renderError = renderError ?? err;
    }
  }

  let blob: Blob | null = null;
  // Only a recorder that actually started will ever fire onstop/onerror.
  if (didStart && stopped) {
    try {
      blob = await stopped;
    } catch (err) {
      renderError = renderError ?? err;
    }
  }

  // Stream tracks are only released once `stopped` has settled: stopping
  // them earlier can truncate whatever MediaRecorder was still flushing.
  if (onAbort) o.signal.removeEventListener('abort', onAbort);
  stream.getTracks().forEach((t) => t.stop());
  try {
    await audioCtx?.close();
  } catch (err) {
    console.warn('Export AudioContext did not close cleanly:', err);
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);

  if (renderError) throw renderError;
  if (o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  if (!blob) throw new Error('Export produced no video.');
  return { blob, mimeType };
}
