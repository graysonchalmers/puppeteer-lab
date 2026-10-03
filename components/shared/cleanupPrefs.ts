/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The remembered "Clean up" choice and the badge text. Pure; storage access lives in the hook.
 */
import { CleanReport } from './cleanTake';

export interface CleanupPrefs {
  enabled: boolean;
  strength: number;
}

export const DEFAULT_CLEANUP_PREFS: CleanupPrefs = { enabled: false, strength: 0.5 };
export const CLEANUP_STORAGE_KEY = 'puppeteerlab.cleanup';

export function parseCleanupPrefs(raw: string | null): CleanupPrefs {
  if (!raw) return { ...DEFAULT_CLEANUP_PREFS };
  try {
    const j = JSON.parse(raw);
    const strength =
      typeof j?.strength === 'number' && Number.isFinite(j.strength)
        ? Math.min(1, Math.max(0, j.strength))
        : DEFAULT_CLEANUP_PREFS.strength;
    return { enabled: j?.enabled === true, strength };
  } catch {
    return { ...DEFAULT_CLEANUP_PREFS };
  }
}

export const serializeCleanupPrefs = (p: CleanupPrefs): string => JSON.stringify({ enabled: p.enabled, strength: p.strength });

export function reportLabel(r: CleanReport | null): string {
  if (!r) return '';
  if (r.skipped) return 'Take too long to clean up';
  if (r.gapsFilled === 0 && r.gapsLeft === 0) return 'No gaps to fill';
  const parts: string[] = [];
  if (r.gapsFilled > 0) parts.push(`Filled ${r.gapsFilled} gap${r.gapsFilled === 1 ? '' : 's'} (${(r.filledMs / 1000).toFixed(1)} s)`);
  if (r.gapsLeft > 0) parts.push(`${r.gapsLeft} too long to fill`);
  return parts.join(' · ');
}
