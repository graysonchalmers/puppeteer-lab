/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small "Demos" menu in Face Puppet's header: jump to another demo or the all-demos
 * overview. On phones the other demos are listed with a quiet "desktop recommended"
 * hint (only Face Puppet has been ported to phones). Also carries the build stamp,
 * which the old hub footer used to be the only place to show.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { AppMode } from '../types';

const ITEMS: { id: AppMode; label: string }[] = [
  { id: 'face', label: 'Face Puppet' },
  { id: 'telemetry', label: 'Hand Telemetry' },
  { id: 'aircanvas', label: 'Air Canvas' },
  { id: 'game', label: 'Tempo Strike' },
  { id: 'recorder', label: 'Motion Recorder' },
];

interface DemoSwitcherProps {
  current: AppMode;
  isPhone: boolean;
  onSelect: (mode: AppMode) => void;
}

const DemoSwitcher: React.FC<DemoSwitcherProps> = ({ current, isPhone, onSelect }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (m: AppMode) => {
    setOpen(false);
    if (m !== current) onSelect(m);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3.5 py-1.5 rounded-lg border border-white/15 transition-all text-xs font-mono text-white cursor-pointer min-h-[44px] md:min-h-0"
      >
        Demos <ChevronDown size={14} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="demo-menu"
          className="absolute left-0 top-full mt-2 w-64 max-w-[80vw] bg-[#111317] border border-white/15 rounded-lg shadow-2xl overflow-hidden font-mono z-[60]"
        >
          {ITEMS.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              onClick={() => pick(it.id)}
              className={`w-full text-left px-3 min-h-[44px] flex flex-col justify-center text-xs hover:bg-white/10 ${it.id === current ? 'text-white font-bold bg-white/5' : 'text-gray-300'}`}
            >
              <span>{it.label}</span>
              {isPhone && it.id !== 'face' && <span className="text-[10px] font-normal text-gray-500">Desktop recommended</span>}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('home')}
            className="w-full text-left px-3 min-h-[44px] flex items-center gap-2 text-xs text-gray-300 hover:bg-white/10 border-t border-white/10"
          >
            <LayoutGrid size={13} /> All demos
          </button>
          <div className="px-3 py-1.5 text-[10px] text-gray-600 border-t border-white/10" title="Build stamp (commit-derived)">
            {__BUILD_STAMP__}
          </div>
        </div>
      )}
    </div>
  );
};

export default DemoSwitcher;
