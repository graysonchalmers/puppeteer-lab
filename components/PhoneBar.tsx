/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phone-only fixed bottom bar: record/play transport, camera flip, and the
 * Controls drawer toggle. Everything is 44px or larger.
 */
import React from 'react';
import { Circle, Square, Play, Pause, SwitchCamera, SlidersHorizontal } from 'lucide-react';

interface PhoneBarProps {
  isRecording: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  hasData: boolean;
  /** Export in progress or recording: locks everything but Stop. */
  busy: boolean;
  canFlip: boolean;
  /** Extra flip lock, e.g. while the camera is still opening. */
  flipDisabled?: boolean;
  controlsOpen: boolean;
  onRecord: () => void;
  onStop: () => void;
  onPlayToggle: () => void;
  onStopPlayback: () => void;
  onFlip: () => void;
  onToggleControls: () => void;
}

const round =
  'w-11 h-11 rounded-full border flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed';

// bottom-12: the 48px strip below the bar is reserved for the deploy-time attribution badge
// (fixed, bottom-right, z 9999) that would otherwise cover the bar's rightmost button.
const PhoneBar: React.FC<PhoneBarProps> = (p) => (
  <div data-testid="phone-bar" className="fixed inset-x-0 bottom-12 z-50 h-16 flex items-center justify-around px-3 bg-[#090A0C]/95 backdrop-blur-md border-t border-white/10 font-mono">
    {!p.isRecording ? (
      <button
        aria-label="Record"
        title="Start Recording (With Audio)"
        onClick={p.onRecord}
        disabled={p.isPlaying || p.busy}
        className={`${round} bg-white/5 border-white/20`}
      >
        <Circle fill="#EE3B2B" className="text-[#EE3B2B]" size={16} />
      </button>
    ) : (
      <button
        aria-label="Stop recording"
        title="Stop Recording"
        onClick={p.onStop}
        className={`${round} bg-[#EE3B2B] border-[#EE3B2B] text-white animate-pulse`}
      >
        <Square fill="currentColor" size={16} />
      </button>
    )}

    <button
      aria-label={p.isPaused ? 'Resume' : p.isPlaying ? 'Pause' : 'Play'}
      onClick={p.onPlayToggle}
      disabled={!p.hasData || p.isRecording || p.busy}
      className={`${round} ${p.isPlaying && !p.isPaused ? 'bg-white text-black border-white' : 'bg-white/5 border-white/20 text-white'}`}
    >
      {p.isPlaying && !p.isPaused ? <Pause fill="currentColor" size={16} /> : <Play fill="currentColor" size={16} className="ml-0.5" />}
    </button>

    {p.isPlaying && (
      <button aria-label="Stop playback" onClick={p.onStopPlayback} disabled={p.busy} className={`${round} bg-white/5 border-white/20 text-white`}>
        <Square fill="currentColor" size={14} />
      </button>
    )}

    {p.canFlip && (
      <button
        aria-label="Flip camera"
        onClick={p.onFlip}
        disabled={p.flipDisabled || p.busy || p.isRecording || p.isPlaying}
        className={`${round} bg-white/5 border-white/20 text-white`}
      >
        <SwitchCamera size={18} />
      </button>
    )}

    <button
      aria-label="Controls"
      aria-expanded={p.controlsOpen}
      onClick={p.onToggleControls}
      className={`${round} ${p.controlsOpen ? 'bg-white text-black border-white' : 'bg-white/5 border-white/20 text-white'}`}
    >
      <SlidersHorizontal size={18} />
    </button>
  </div>
);

export default PhoneBar;
