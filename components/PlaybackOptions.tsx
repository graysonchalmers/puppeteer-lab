/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Playback options under the stage: the Clean up switch with its strength slider and gap badge.
 */
import React from 'react';
import { CleanReport } from './shared/cleanTake';
import { reportLabel } from './shared/cleanupPrefs';

export interface PlaybackOptionsProps {
  cleanup: {
    enabled: boolean;
    strength: number;
    report: CleanReport | null;
    onEnabled(v: boolean): void;
    onStrength(v: number): void;
  };
  disabled?: boolean;
  className?: string;
}

const PlaybackOptions: React.FC<PlaybackOptionsProps> = ({ cleanup, disabled, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] text-gray-300 ${className}`}>
    <button
      data-testid="cleanup-toggle"
      role="switch"
      aria-checked={cleanup.enabled}
      disabled={disabled}
      onClick={() => cleanup.onEnabled(!cleanup.enabled)}
      className={`min-h-[44px] md:min-h-0 px-3 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        cleanup.enabled ? 'bg-white/15 text-white font-semibold' : 'bg-white/10 text-gray-300 hover:text-white'
      }`}
    >
      CLEAN UP {cleanup.enabled ? 'ON' : 'OFF'}
    </button>
    {cleanup.enabled && (
      <>
        <input
          data-testid="cleanup-strength"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={cleanup.strength}
          aria-label="Cleanup strength"
          onChange={(e) => cleanup.onStrength(parseFloat(e.target.value))}
          className="w-24 accent-[#EE3B2B]"
        />
        <span data-testid="cleanup-badge" className="text-gray-400">
          {reportLabel(cleanup.report)}
        </span>
      </>
    )}
  </div>
);

export default PlaybackOptions;
