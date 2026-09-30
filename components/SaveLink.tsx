/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Save & get link": uploads the current take on an explicit tap and shows a 24 h link (copy / share).
 * Renders nothing when the site has no API (static host, local dev without `npm run server`, or uploads disabled),
 * so the rest of the app is unchanged there.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link2, Copy, Check, Share2, Loader2 } from 'lucide-react';
import { fetchUploadConfig, uploadTake, expiresLabel, UploadConfig, UploadError } from './shared/takeApi';

interface SaveLinkProps {
    /** The take as a v3 recording JSON blob (recorder.buildRecordingBlob('full')). */
    getBlob: () => Promise<Blob>;
    disabled: boolean;
    hasAudio: boolean;
    /** Changes whenever the take changes, so a link is never shown for a different take. */
    takeKey: string;
}

type Phase =
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'done'; url: string; expiresAt: number }
    | { kind: 'error'; message: string };

const SaveLink: React.FC<SaveLinkProps> = ({ getBlob, disabled, hasAudio, takeKey }) => {
    const [cfg, setCfg] = useState<UploadConfig | null>(null);
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const [copied, setCopied] = useState(false);
    const runRef = useRef(0); // ignores an upload that finishes after the take changed

    useEffect(() => {
        let alive = true;
        fetchUploadConfig().then((c) => { if (alive) setCfg(c); });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        runRef.current++;
        setPhase({ kind: 'idle' });
        setCopied(false);
    }, [takeKey]);

    if (!cfg || !cfg.uploadsEnabled) return null;

    const save = async () => {
        const run = ++runRef.current;
        setPhase({ kind: 'uploading' });
        try {
            const r = await uploadTake(await getBlob());
            if (run !== runRef.current) return;
            setPhase({ kind: 'done', url: new URL(r.url, window.location.origin).toString(), expiresAt: r.expiresAt });
        } catch (e) {
            if (run !== runRef.current) return;
            setPhase({ kind: 'error', message: e instanceof UploadError ? e.message : 'Could not save this take. Use Export to keep it.' });
        }
    };

    const copy = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* the URL box is selectable; the user can copy by hand */
        }
    };

    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const btn = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-200 border border-white/10 transition-colors disabled:opacity-30 min-h-[44px] md:min-h-0';

    return (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            {phase.kind !== 'done' && (
                <button
                    data-testid="save-link-button"
                    onClick={save}
                    disabled={disabled || phase.kind === 'uploading'}
                    className={btn}
                    title="Upload this take and get a link that works for 24 hours"
                >
                    {phase.kind === 'uploading' ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                    {phase.kind === 'uploading' ? 'Saving...' : 'Save & get link'}
                </button>
            )}

            {phase.kind === 'done' && (
                <div className="flex flex-col gap-2">
                    <input
                        data-testid="save-link-url"
                        readOnly
                        value={phase.url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full bg-black/40 border border-white/15 rounded px-2 py-1.5 text-[11px] font-mono text-white min-h-[44px] md:min-h-0"
                    />
                    <div className="flex gap-2">
                        <button data-testid="save-link-copy" onClick={() => copy(phase.url)} className={`${btn} flex-1`}>
                            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}
                        </button>
                        {canShare && (
                            <button onClick={() => navigator.share({ title: 'Puppeteer Lab take', url: phase.url }).catch(() => {})} className={`${btn} flex-1`}>
                                <Share2 size={13} /> Share
                            </button>
                        )}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-snug">Link {expiresLabel(phase.expiresAt, Date.now())}.</p>
                </div>
            )}

            {phase.kind === 'error' && (
                <p data-testid="save-link-error" className="text-[10px] text-[#EE3B2B] leading-snug">{phase.message}</p>
            )}

            <p data-testid="save-link-disclosure" className="text-[10px] text-gray-500 leading-snug">
                We keep a copy of every take you save (motion{hasAudio ? ' and your voice' : ''}). The link works for {cfg.ttlHours} hours.
                To have a take removed, email {cfg.contactEmail}.
            </p>
        </div>
    );
};

export default SaveLink;
