/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The page behind a share link (/t/<id>): plays the take back with the Face Puppet renderer, offers the JSON
 * as a download and shows when the link expires. No camera, no MediaPipe.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { fetchTake, expiresLabel } from './shared/takeApi';
import { takeShape, TakeShape } from './shared/takeShape';
import { findFrameIndex } from '../hooks/useRecorder';
import { drawPuppet, disposePuppet } from './face/FaceMeshRenderer';
import type { MeshDetail } from './face/faceGeometry';
import { INITIAL_PUPPET_STATE, stepPuppetState } from './face/puppetState';
import PlaybackOptions from './PlaybackOptions';
import { useCleanedFrames, useCleanupPrefs } from '../hooks/useCleanedFrames';
import { FRONT_VIEW, OrbitView } from './face/orbitState';
import { useOrbitInput } from '../hooks/useOrbitInput';
import { useTakeDepth } from '../hooks/useTakeDepth';

type Loaded = TakeShape & { audioUrl: string | null; expiresAt: number | null };
type View = { kind: 'loading' } | { kind: 'expired' } | { kind: 'not-found' } | { kind: 'error' } | { kind: 'ready'; take: Loaded };

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full h-full flex flex-col bg-[#090A0C] text-[#EDEDED]">
    <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 font-mono text-xs">
      <a href="/" className="font-bold tracking-wider text-white">PUPPETEER LAB</a>
      <span className="text-gray-400">Shared take</span>
    </header>
    {children}
  </div>
);

const Message: React.FC<{ title: string; body: string; retry?: boolean }> = ({ title, body, retry }) => (
  <div data-testid="take-state" className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center font-mono">
    <p className="text-white text-sm font-bold">{title}</p>
    <p className="text-gray-400 text-xs max-w-sm leading-relaxed">{body}</p>
    <div className="flex gap-2 pt-2">
      {retry && <button onClick={() => window.location.reload()} className="min-h-[44px] px-5 rounded-lg bg-white/10 text-white text-xs">Try again</button>}
      <a href="/" className="min-h-[44px] px-5 rounded-lg bg-[#EE3B2B] text-white text-xs font-bold inline-flex items-center">Make your own</a>
    </div>
  </div>
);

const Player: React.FC<{ id: string; take: Loaded }> = ({ id, take }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const startRef = useRef(0); // performance.now() at take time 0 while playing
  const pausedAtRef = useRef(0);
  const stateRef = useRef(INITIAL_PUPPET_STATE);
  const [prefs, setPrefs] = useCleanupPrefs();
  const cleaned = useCleanedFrames(take.frames, '', prefs.enabled, prefs.strength);
  const framesRef = useRef(take.frames);
  framesRef.current = cleaned.frames; // read by the draw loop, which does not re-run when the switch flips
  const [orbitOn, setOrbitOn] = useState(false);
  const orbitViewRef = useRef<OrbitView>(FRONT_VIEW);
  const orbitOnRef = useRef(false);
  orbitOnRef.current = orbitOn;
  useOrbitInput(canvasRef, orbitOn, orbitViewRef);
  const depth = useTakeDepth(cleaned.frames, take.aspect, orbitOn);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const [playing, setPlaying] = useState(false);
  const [clockMs, setClockMs] = useState(0);
  const [nowWall, setNowWall] = useState(() => Date.now());

  const timeMs = () =>
    Math.max(0, Math.min(take.durationMs, playingRef.current ? performance.now() - startRef.current : pausedAtRef.current));

  useEffect(() => {
    if (!take.audioUrl) return;
    const a = new Audio(take.audioUrl);
    audioRef.current = a;
    return () => {
      a.pause();
      audioRef.current = null;
      URL.revokeObjectURL(take.audioUrl!);
    };
  }, [take.audioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    // Harness-only (scripts/looks-sheet.mjs): ?mesh=full renders the dense mesh. Unknown values mean the default.
    const meshDetail: MeshDetail = new URLSearchParams(window.location.search).get('mesh') === 'full' ? 'full' : 'low';
    const draw = () => {
      const parent = canvas.parentElement;
      if (parent && (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight)) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      let t = timeMs();
      if (playingRef.current && take.durationMs > 0 && performance.now() - startRef.current > take.durationMs) {
        startRef.current = performance.now();
        t = 0;
        const a = audioRef.current;
        if (a) { a.currentTime = 0; a.play().catch(() => {}); }
      }
      const frames = framesRef.current;
      const idx = findFrameIndex(frames, t);
      const frame = frames[idx];
      stateRef.current = stepPuppetState(stateRef.current, frame.faceLandmarks, frame.blendshapes || {}, take.aspect, 0.5);
      const orbiting = orbitOnRef.current;
      drawPuppet(ctx, { face: frame.faceLandmarks ?? null, hands: frame.landmarks ?? [], state: stateRef.current, handR: orbiting ? depthRef.current.handR[idx] : undefined }, canvas.width, canvas.height, {
        showGazeRays: false, showMocapDots: false, videoAspect: take.aspect,
        browBoost: 0.5, jawBoost: 0.75, blinkBoost: 0.5, creaseAngle: 35, meshDetail,
        view: orbiting ? { ...orbitViewRef.current, pivot: depthRef.current.pivot } : null,
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); disposePuppet(canvas); };
  }, [take]);

  useEffect(() => {
    const id = setInterval(() => { setClockMs(timeMs()); setNowWall(Date.now()); }, 100);
    return () => clearInterval(id);
  }, [take]);

  const toggle = () => {
    if (playingRef.current) {
      pausedAtRef.current = timeMs();
      playingRef.current = false;
      setPlaying(false);
      audioRef.current?.pause();
      return;
    }
    const from = pausedAtRef.current >= take.durationMs ? 0 : pausedAtRef.current;
    startRef.current = performance.now() - from;
    playingRef.current = true;
    setPlaying(true);
    const a = audioRef.current;
    if (a) {
      try { a.currentTime = from / 1000; } catch { /* metadata not loaded yet */ }
      a.play().catch(() => {});
    }
  };

  const seek = (ms: number) => {
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    pausedAtRef.current = ms;
    setClockMs(ms);
    try { if (audioRef.current) audioRef.current.currentTime = ms / 1000; } catch { /* not loaded yet */ }
  };

  return (
    <>
      <div className="flex-1 min-h-0 relative bg-[#090A0C] overflow-hidden">
        <canvas data-testid="take-canvas" ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="px-4 pt-3 pb-14 md:pb-4 border-t border-white/10 flex flex-col gap-3 font-mono text-[11px] text-gray-300">
        <div className="flex items-center gap-3">
          <button
            data-testid="take-play"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="w-11 h-11 shrink-0 rounded-full bg-white text-black flex items-center justify-center"
          >
            {playing ? <Pause fill="currentColor" size={16} /> : <Play fill="currentColor" size={16} className="ml-0.5" />}
          </button>
          <input
            type="range" min={0} max={Math.max(1, take.durationMs)} step={16} value={clockMs}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="flex-1 h-1.5 accent-[#EE3B2B]" aria-label="Scrub"
          />
          <span data-testid="take-clock" className="tabular-nums shrink-0">{fmt(clockMs)} / {fmt(take.durationMs)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PlaybackOptions
            cleanup={{
              enabled: prefs.enabled,
              strength: prefs.strength,
              report: cleaned.report,
              onEnabled: (enabled) => setPrefs({ enabled }),
              onStrength: (strength) => setPrefs({ strength }),
            }}
            orbit={{
              enabled: orbitOn,
              onEnabled: (on) => { orbitViewRef.current = FRONT_VIEW; setOrbitOn(on); },
              onReset: () => { orbitViewRef.current = FRONT_VIEW; },
            }}
          />
          <a
            data-testid="take-download"
            href={`/api/takes/${id}?download=1`}
            download
            className="min-h-[44px] md:min-h-0 px-4 rounded-lg bg-white/10 hover:bg-white/15 text-white inline-flex items-center gap-1.5"
          >
            <Download size={13} /> Download JSON
          </a>
          <a href="/" className="min-h-[44px] md:min-h-0 inline-flex items-center text-[#EE3B2B] font-bold">Make your own</a>
          {take.expiresAt !== null && <span data-testid="take-expiry" className="text-gray-500">Link {expiresLabel(take.expiresAt, nowWall)}</span>}
          {take.hasAudio && <span className="text-gray-500">Tap play for sound</span>}
        </div>
      </div>
    </>
  );
};

/** `id` is null for a path under /t/ that is not a valid id (cut off or mistyped): not found, without asking the server. */
const TakeViewer: React.FC<{ id: string | null }> = ({ id }) => {
  const [view, setView] = useState<View>(() => (id === null ? { kind: 'not-found' } : { kind: 'loading' }));

  useEffect(() => {
    if (id === null) return;
    let alive = true;
    (async () => {
      const r = await fetchTake(id);
      if (!alive) return;
      if (r.status !== 'ok') return setView({ kind: r.status });
      const shape = takeShape(r.json);
      if (shape.frames.length === 0) return setView({ kind: 'error' });
      let audioUrl: string | null = null;
      if (shape.audioDataUrl) {
        try {
          audioUrl = URL.createObjectURL(await (await fetch(shape.audioDataUrl)).blob());
        } catch {
          /* play it silently */
        }
      }
      if (!alive) {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        return;
      }
      setView({ kind: 'ready', take: { ...shape, audioUrl, expiresAt: r.expiresAt } });
    })();
    return () => { alive = false; };
  }, [id]);

  return (
    <Shell>
      {view.kind === 'loading' && <div className="flex-1 flex items-center justify-center text-gray-400 text-xs font-mono animate-pulse">Loading take...</div>}
      {view.kind === 'expired' && <Message title="This link has expired" body="Links to a saved take work for 24 hours. Record a new one and save it again." />}
      {view.kind === 'not-found' && <Message title="We can't find that take" body="The link may be mistyped or cut off. Check that you copied all of it." />}
      {view.kind === 'error' && <Message title="Could not load this take" body="Something went wrong loading it. Check your connection and try again." retry />}
      {view.kind === 'ready' && id !== null && <Player id={id} take={view.take} />}
    </Shell>
  );
};

export default TakeViewer;
