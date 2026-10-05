/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face Puppet slider values remembered per browser, so tuning on a phone survives
 * Safari evicting the tab. Pure; storage access lives in FaceDemo (wrapped in try/catch).
 */
export interface FacePrefs {
  faceSmoothing: number;
  browBoost: number;
  jawBoost: number;
  blinkBoost: number;
}

export const DEFAULT_FACE_PREFS: FacePrefs = { faceSmoothing: 0.5, browBoost: 1, jawBoost: 1, blinkBoost: 1 };
export const FACE_PREFS_STORAGE_KEY = 'puppeteerlab.face';

/** Every field is 0..1; anything missing, non-numeric or corrupt falls back to its default. */
export function parseFacePrefs(raw: string | null): FacePrefs {
  const out = { ...DEFAULT_FACE_PREFS };
  if (!raw) return out;
  try {
    const j = JSON.parse(raw);
    for (const k of Object.keys(out) as (keyof FacePrefs)[]) {
      const v = j?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
    }
  } catch {}
  return out;
}
