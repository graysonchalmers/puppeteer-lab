/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Save & get link": uploads the current take on an explicit tap and shows a 24 h link (copy / share).
 * Presentational: the state lives in hooks/useSaveLink (owned by FaceDemo) so it survives this component remounting
 * when a phone rotates between the drawer and the desktop panel.
 * Renders nothing when the site has no API (static host, local dev without `npm run server`, or uploads disabled),
 * so the rest of the app is unchanged there.
 */
import React from 'react';
import { Link2, Copy, Check, Share2, Loader2 } from 'lucide-react';
import { expiresLabel } from './shared/takeApi';
import { SaveLinkState } from '../hooks/useSaveLink';

interface SaveLinkProps {
    state: SaveLinkState;
    disabled: boolean;
    hasAudio: boolean;
}

const SaveLink: React.FC<SaveLinkProps> = ({ state, disabled, hasAudio }) => {
    const { cfg, phase, copied, save, copy } = state;
    if (!cfg || !cfg.uploadsEnabled) return null;

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
                        <button data-testid="save-link-copy" onClick={copy} className={`${btn} flex-1`}>
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
                We keep a copy of every take you save (face and hand motion{hasAudio ? ' and your voice' : ''}). The link works for {cfg.ttlHours} hours.
                To have a take removed, email {cfg.contactEmail}.
            </p>
        </div>
    );
};

export default SaveLink;
