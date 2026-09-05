/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The "Global Smoothing Filter" panel shared by Air Canvas and Hand Telemetry.
 * Presentational only: it owns no state, renders `value`, and reports changes
 * back through `onChange`.
 */
import React from 'react';
import { Waves } from 'lucide-react';
import { SMOOTHING_PRESETS } from './smoothing';

interface SmoothingControlProps {
  value: number;
  onChange: (value: number) => void;
}

const SmoothingControl: React.FC<SmoothingControlProps> = ({ value, onChange }) => (
  <div className="bg-[#15171C] p-3.5 rounded border border-white/10">
    <div className="flex justify-between items-center mb-2.5">
      <h3 className="text-[10px] uppercase tracking-wider text-white font-bold flex items-center gap-1.5">
        <Waves size={12} /> Global Smoothing Filter
      </h3>
      <span className="text-[11px] font-bold text-[#EE3B2B]">
        {(value * 100).toFixed(0)}%
      </span>
    </div>

    {/* Quick Presets */}
    <div className="grid grid-cols-4 gap-1 mb-3">
      {SMOOTHING_PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.val)}
          className={`py-1 text-[10px] rounded border transition-colors ${
            Math.abs(value - p.val) < 0.05
              ? 'bg-white text-black border-white font-bold'
              : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>

    <div className="space-y-1">
      <div className="flex justify-between text-[9px] text-gray-400">
        <span>0% Direct Camera</span>
        <span>100% Interpolated</span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-[#22242B] rounded-lg appearance-none cursor-pointer accent-[#EE3B2B]"
      />
    </div>
  </div>
);

export default SmoothingControl;
