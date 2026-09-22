/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect } from 'react';
import { VideoOff } from 'lucide-react';
import { IDLE_MS, resume, useIdlePaused } from './shared/idle';

/** Shown when the idle auto-pause has shut the camera off; click or any key resumes. */
const IdleOverlay: React.FC = () => {
  const paused = useIdlePaused();

  // Leaving the demo (back to the hub) never leaves a stale pause behind.
  useEffect(() => () => resume(), []);

  useEffect(() => {
    if (!paused) return;
    window.addEventListener('keydown', resume);
    return () => window.removeEventListener('keydown', resume);
  }, [paused]);

  if (!paused) return null;
  return (
    <button
      type="button"
      onClick={resume}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#090A0C]/80 backdrop-blur-sm cursor-pointer"
    >
      <div className="bg-[#111317] border border-white/10 rounded px-6 py-5 text-center font-mono">
        <VideoOff size={22} className="mx-auto mb-3 text-[#EE3B2B]" />
        <div className="text-sm text-white font-bold tracking-wider">CAMERA PAUSED</div>
        <div className="text-[11px] text-gray-400 mt-1.5">
          No activity for {IDLE_MS / 1000} s. Click or press any key to resume.
        </div>
      </div>
    </button>
  );
};

export default IdleOverlay;
