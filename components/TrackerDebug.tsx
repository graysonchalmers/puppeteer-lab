/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Debug overlay for the INPUT CAM view: live tracker numbers (loop and draw rate, per-model inference time, the face
 * rate and whether the cost policy is running the face on alternate ticks) plus a graph of the last ticks, coloured
 * by whether a hand was in view, so a slowdown on a phone can be matched to what was on camera. Refreshes 4x a second.
 */
import React, { useEffect, useRef, useState } from 'react';
import { TrackerStats, createTickHistory } from './shared/trackerStats';

interface Props {
  statsRef: React.MutableRefObject<TrackerStats>;
  historyRef: React.MutableRefObject<ReturnType<typeof createTickHistory>>;
  renderFpsRef: React.MutableRefObject<number>;
}

const GRAPH_W = 120, GRAPH_H = 24, GRAPH_MAX_MS = 100, BUDGET_MS = 1000 / 30;

const TrackerDebug: React.FC<Props> = ({ statsRef, historyRef, renderFpsRef }) => {
  const [snap, setSnap] = useState<{ s: TrackerStats; draw: number }>(() => ({ s: { ...statsRef.current }, draw: renderFpsRef.current }));
  const graphRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setSnap({ s: { ...statsRef.current }, draw: renderFpsRef.current });
      const ctx = graphRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);
      const ticks = historyRef.current.read();
      const bw = GRAPH_W / 60;
      ticks.forEach((t, i) => {
        const h = Math.max(1, Math.min(1, t.ms / GRAPH_MAX_MS) * GRAPH_H);
        ctx.fillStyle = t.hands > 0 ? '#ff2bd6' : '#00e5ff'; // hand in view: magenta; face only: cyan
        ctx.globalAlpha = t.faceRan ? 1 : 0.45;              // dim bars = a tick that skipped the face model
        ctx.fillRect(i * bw, GRAPH_H - h, Math.max(1, bw - 0.5), h);
      });
      ctx.globalAlpha = 1;
      const y = GRAPH_H - (BUDGET_MS / GRAPH_MAX_MS) * GRAPH_H;
      ctx.fillStyle = '#ffffff55';
      ctx.fillRect(0, y, GRAPH_W, 1); // 30 fps budget
    }, 250);
    return () => clearInterval(id);
  }, [statsRef, historyRef, renderFpsRef]);

  const { s, draw } = snap;
  const slow = s.tickMs > BUDGET_MS;
  return (
    <div data-testid="tracker-debug" className="w-0 min-w-full pt-1 font-mono text-[8px] md:text-[10px] leading-tight text-[#7CFFB2] whitespace-nowrap overflow-hidden">
      <div>loop {s.trackFps.toFixed(0)}  draw {draw.toFixed(0)} fps</div>
      <div className={slow ? 'text-amber-300' : undefined}>tick {s.tickMs.toFixed(0)}ms  hands {s.hands}</div>
      <div>hand {s.handMs.toFixed(0)}ms  face {s.faceMs.toFixed(0)}ms</div>
      <div className={s.alternating ? 'text-amber-300' : undefined}>face {s.faceFps.toFixed(0)}fps{s.alternating ? '  ALT' : ''}</div>
      <div>{s.delegate ?? 'no-delegate'}  face: {s.face ? 'yes' : 'no'}</div>
      <canvas ref={graphRef} width={GRAPH_W} height={GRAPH_H} className="w-full mt-1 rounded-sm bg-black/50 block" style={{ height: GRAPH_H }} />
    </div>
  );
};

export default TrackerDebug;
