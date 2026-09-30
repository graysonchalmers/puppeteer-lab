/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The camera/microphone permission UI for Face Puppet: the tap-to-start explainer,
 * the per-error card, the "camera stopped" resume card and the quiet mic note.
 * Words come from hooks/cameraAccess.ts (tested); this file only lays them out.
 */
import React from 'react';
import { ScanFace, CameraOff, Mic, MicOff } from 'lucide-react';
import { CameraIssue, MicStatus } from '../hooks/cameraAccess';

const card =
  'absolute inset-x-4 top-1/2 -translate-y-1/2 z-40 mx-auto max-w-sm pointer-events-auto flex flex-col items-center gap-3 bg-[#111317]/95 border rounded-xl p-5 text-center font-mono';
const primaryBtn = 'min-h-[48px] w-full rounded-lg bg-[#EE3B2B] text-white font-mono text-xs font-bold tracking-wider disabled:opacity-40';
const quietBtn = 'min-h-[44px] px-4 rounded-lg border border-white/20 bg-white/5 text-white font-mono text-xs';

interface StartCardProps {
  micWanted: boolean;
  /** The microphone is already refused in the browser: the toggle is off and says so. */
  micBlocked: boolean;
  onMicChange: (wanted: boolean) => void;
  onStart: () => void;
}

/** First load: says what is used, then one tap (the user gesture) asks the browser. */
export const StartCard: React.FC<StartCardProps> = ({ micWanted, micBlocked, onMicChange, onStart }) => (
  <div data-testid="start-card" className={`${card} border-white/15`}>
    <ScanFace size={36} className="text-[#EE3B2B]" />
    <h2 className="text-white font-bold text-sm tracking-wider">FACE PUPPET</h2>
    <p className="text-gray-300 text-xs leading-relaxed">Your camera drives a puppet that copies your face and hands.</p>
    <label className="flex items-start gap-3 text-left w-full min-h-[44px] px-3 py-2 rounded-lg bg-[#161920] border border-white/10 cursor-pointer">
      <input
        type="checkbox"
        checked={micWanted && !micBlocked}
        disabled={micBlocked}
        onChange={(e) => onMicChange(e.target.checked)}
        className="mt-0.5 w-5 h-5 accent-[#EE3B2B] shrink-0"
      />
      <span className="text-[11px] leading-snug text-gray-200">
        Record with sound
        <span className="block text-gray-500">
          {micBlocked
            ? 'Microphone is blocked in your browser, so takes will be motion only.'
            : 'Also asks for the microphone. It is only recorded while you record.'}
        </span>
      </span>
    </label>
    <button type="button" onClick={onStart} className={primaryBtn}>
      Start camera
    </button>
    <p className="text-[10px] text-gray-500 leading-snug">
      Camera video stays on this device. Face and hand motion, and your voice if you record it, are only uploaded if you tap Save &amp; get link.
    </p>
  </div>
);

interface IssueCardProps {
  issue: CameraIssue;
  onRetry: () => void;
  onSkipMic: () => void;
}

/** One camera failure: what happened, what to do, and only the buttons that can help. */
export const IssueCard: React.FC<IssueCardProps> = ({ issue, onRetry, onSkipMic }) => (
  <div data-testid="camera-issue" data-kind={issue.kind} role="alert" className={`${card} border-[#EE3B2B]/40`}>
    <CameraOff size={30} className="text-[#EE3B2B]" />
    <h2 className="text-white font-bold text-sm">{issue.title}</h2>
    <p className="text-gray-300 text-xs leading-relaxed">{issue.message}</p>
    {issue.steps.length > 0 && (
      <ol className="text-left text-[11px] text-gray-400 leading-snug list-decimal pl-5 space-y-1 w-full">
        {issue.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    )}
    <div className="flex flex-col gap-2 w-full">
      {issue.canRetry && (
        <button type="button" onClick={onRetry} className={primaryBtn}>
          Try again
        </button>
      )}
      {issue.micOptional && (
        <button type="button" onClick={onSkipMic} className={quietBtn}>
          Continue without microphone
        </button>
      )}
      {issue.canReload && (
        <button type="button" onClick={() => window.location.reload()} className={quietBtn}>
          Reload page
        </button>
      )}
    </div>
  </div>
);

/** The camera stopped after it was running (iOS backgrounding, another app took it): one tap brings it back. */
export const LostCard: React.FC<{ onResume: () => void; wasRecording: boolean }> = ({ onResume, wasRecording }) => (
  <div data-testid="camera-lost" role="alert" className={`${card} border-white/15`}>
    <CameraOff size={30} className="text-[#EE3B2B]" />
    <h2 className="text-white font-bold text-sm">Camera paused</h2>
    <p className="text-gray-300 text-xs leading-relaxed">
      The camera stopped, usually after switching apps or turning the phone.
      {wasRecording ? ' Your take was saved up to that point.' : ''}
    </p>
    <button type="button" onClick={onResume} className={primaryBtn}>
      Resume camera
    </button>
  </div>
);

interface MicNoteProps {
  status: MicStatus;
  /** 'unavailable' because the browser already refuses it (not a hiccup). */
  onEnable: () => void;
}

/** Quiet one-liner while the microphone is not part of the session; never blocks anything. */
export const MicNote: React.FC<MicNoteProps> = ({ status, onEnable }) => {
  if (status === 'on') return null;
  return (
    <div
      data-testid="mic-note"
      data-status={status}
      className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 max-w-[92%] flex items-center gap-2 font-mono text-[10px] text-gray-400 text-center"
    >
      <MicOff size={12} className="shrink-0" />
      {status === 'off' ? (
        <>
          <span>Sound is off: takes record motion only.</span>
          <button type="button" onClick={onEnable} className="inline-flex items-center gap-1 min-h-[44px] px-2 text-white underline underline-offset-2">
            <Mic size={12} /> Turn on
          </button>
        </>
      ) : (
        <span>Microphone unavailable: takes record motion only.</span>
      )}
    </div>
  );
};
