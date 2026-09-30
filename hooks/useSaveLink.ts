/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * State and actions behind "Save & get link". Lives in FaceDemo (not in SaveLink) so it survives SaveLink remounting:
 * rotating a phone past the md breakpoint swaps the phone drawer for the desktop panel, and an in-flight or finished
 * upload must not be dropped (or offered again, archiving a second copy). The /api/config fetch happens once here too.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUploadConfig, oversizeMessage, uploadTake, UploadConfig, UploadError } from '../components/shared/takeApi';

export type SavePhase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; url: string; expiresAt: number }
  | { kind: 'error'; message: string };

export interface SaveLinkState {
  /** null until /api/config answers, and when there is no API. */
  cfg: UploadConfig | null;
  phase: SavePhase;
  copied: boolean;
  save: () => void;
  copy: () => void;
}

/**
 * @param getBlob the take as v3 recording JSON (read through a ref, so a new function each render is fine)
 * @param takeKey changes whenever the take changes, so a link is never shown for a different take
 */
export function useSaveLink(getBlob: () => Promise<Blob>, takeKey: string): SaveLinkState {
  const [cfg, setCfg] = useState<UploadConfig | null>(null);
  const [phase, setPhase] = useState<SavePhase>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const runRef = useRef(0); // ignores an upload that finishes after the take changed
  const getBlobRef = useRef(getBlob);
  getBlobRef.current = getBlob;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchUploadConfig().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    runRef.current++;
    setPhase((p) => (p.kind === 'idle' ? p : { kind: 'idle' })); // same object while idle: no extra FaceDemo render per recorded frame
    setCopied(false);
  }, [takeKey]);

  const save = useCallback(async () => {
    const run = ++runRef.current;
    setPhase({ kind: 'uploading' });
    try {
      const blob = await getBlobRef.current();
      if (run !== runRef.current) return;
      const tooBig = cfgRef.current ? oversizeMessage(blob.size, cfgRef.current.maxBytes) : null;
      if (tooBig) {
        setPhase({ kind: 'error', message: tooBig });
        return;
      }
      const r = await uploadTake(blob);
      if (run !== runRef.current) return;
      setPhase({ kind: 'done', url: new URL(r.url, window.location.origin).toString(), expiresAt: r.expiresAt });
    } catch (e) {
      if (run !== runRef.current) return;
      setPhase({ kind: 'error', message: e instanceof UploadError ? e.message : 'Could not save this take. Use Export to keep it.' });
    }
  }, []);

  const copy = useCallback(async () => {
    const p = phaseRef.current;
    if (p.kind !== 'done') return;
    try {
      await navigator.clipboard.writeText(p.url);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the URL box is selectable; the user can copy by hand */
    }
  }, []);

  return { cfg, phase, copied, save, copy };
}
