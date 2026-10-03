/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cleaned copy of a take for playback (spec: take cleanup layer). Memoized here, not inside cleanTake: the
 * recorder's buffer is mutated in place while recording, so `version` (frame count and duration) joins the array
 * identity in the key. The raw frames come back untouched whenever the switch is off.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FrameData } from '../types';
import { CleanReport, cleanTake } from '../components/shared/cleanTake';
import {
  CLEANUP_STORAGE_KEY,
  CleanupPrefs,
  DEFAULT_CLEANUP_PREFS,
  parseCleanupPrefs,
  serializeCleanupPrefs,
} from '../components/shared/cleanupPrefs';

export function useCleanupPrefs() {
  const [prefs, setPrefs] = useState<CleanupPrefs>(() => {
    try {
      return parseCleanupPrefs(localStorage.getItem(CLEANUP_STORAGE_KEY));
    } catch {
      return { ...DEFAULT_CLEANUP_PREFS };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLEANUP_STORAGE_KEY, serializeCleanupPrefs(prefs));
    } catch {
      /* private window or blocked storage: the choice just is not remembered */
    }
  }, [prefs]);
  const update = useCallback((patch: Partial<CleanupPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return [prefs, update] as const;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useCleanedFrames(
  raw: FrameData[],
  version: string,
  enabled: boolean,
  strength: number,
): { frames: FrameData[]; report: CleanReport | null } {
  const settled = useDebounced(strength, 150);
  return useMemo(() => {
    if (!enabled || raw.length < 2) return { frames: raw, report: null };
    return cleanTake(raw, { strength: settled });
  }, [raw, version, enabled, settled]);
}
