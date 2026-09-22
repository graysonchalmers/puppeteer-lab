
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { FrameData, TrackingType } from '../types';
import {
    serializeV3Chunked,
    migrateV2,
    parseDataUrl,
    toDataUrl,
    detectTrackingType,
    SerializeRequest,
    SerializeResponse,
} from '../components/shared/recordingSchema';
import { downloadBlob } from '../components/shared/download';
import { extensionForMime } from '../components/face/exportPack';

/** Runs one export through serialize.worker.ts and resolves with the Blob it
 * posts back. Constructed lazily (only when exportData actually runs, never
 * at module scope) so importing this hook never touches `Worker` or
 * `import.meta.url` in an environment that lacks them (e.g. the vitest
 * 'node' environment this project's other tests run under). Rejects (instead
 * of throwing) on missing Worker support, a construction failure, or a
 * worker-side error/failed load, so callers can uniformly fall back to
 * serializeV3Chunked with a single try/catch. */
function runSerializeWorker(request: SerializeRequest): Promise<Blob> {
    return new Promise((resolve, reject) => {
        if (typeof Worker === 'undefined') {
            reject(new Error('Worker is not available in this environment.'));
            return;
        }

        let worker: Worker;
        try {
            worker = new Worker(new URL('../components/shared/serialize.worker.ts', import.meta.url), { type: 'module' });
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        const settle = (fn: () => void) => {
            worker.terminate();
            fn();
        };

        worker.onmessage = (event: MessageEvent<SerializeResponse>) => {
            const response = event.data;
            if (response.status === 'ok') {
                const blob = response.blob;
                settle(() => resolve(blob));
            } else {
                const error = response.error;
                settle(() => reject(new Error(error)));
            }
        };

        // A module worker that fails to LOAD (e.g. blocked by CSP, missing
        // chunk) surfaces as an 'error' event on the worker, not a throw from
        // the constructor above, so this needs its own fallback trigger.
        worker.onerror = (event) => {
            settle(() => reject(new Error(event.message || 'serialize.worker.ts failed to load or run.')));
        };

        worker.postMessage(request);
    });
}

/** Last frame index whose timestamp <= t (binary search). 0 when t precedes the first frame. */
export function findFrameIndex(frames: { timestamp: number }[], t: number): number {
    let lo = 0, hi = frames.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].timestamp <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
}

// Exported recordings carry landmarks smoothed at whatever the Global Smoothing
// slider was set to during capture (RAW = unsmoothed).
export const useRecorder = (type: TrackingType) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [frameCount, setFrameCount] = useState(0);
    const [hasAudio, setHasAudio] = useState(false);
    
    // The main data store
    const bufferRef = useRef<FrameData[]>([]);
    
    // Timing refs
    const startTimeRef = useRef<number>(0);
    const playbackStartTimeRef = useRef<number>(0);

    // Scrub/pause: isPlaying stays true while paused so consumers keep reading
    // playback frames; the clock is frozen at pausedAtMsRef.
    const pausedRef = useRef(false);
    const pausedAtMsRef = useRef(0);
    const resumeAfterScrubRef = useRef(false);
    const [durationMs, setDurationMs] = useState(0);

    // Audio recording & playback refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioUrlRef = useRef<string | null>(null);
    const audioBase64Ref = useRef<string | null>(null);
    const audioBlobRef = useRef<Blob | null>(null);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);

    const lastTimestamp = () => {
        const b = bufferRef.current;
        return b.length ? b[b.length - 1].timestamp : 0;
    };

    // Cleanup audio on unmount
    useEffect(() => {
        return () => {
            if (audioStreamRef.current) {
                audioStreamRef.current.getTracks().forEach(t => t.stop());
            }
            if (audioElementRef.current) {
                audioElementRef.current.pause();
                audioElementRef.current = null;
            }
            if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
                URL.revokeObjectURL(audioUrlRef.current);
            }
        };
    }, []);

    // --- RECORDING ---
    const startRecording = useCallback(() => {
        bufferRef.current = [];
        setFrameCount(0);
        setDurationMs(0);
        pausedRef.current = false;
        setIsPlaying(false);
        setIsPaused(false);
        setIsRecording(true);
        startTimeRef.current = performance.now();

        // Audio initialization
        audioChunksRef.current = [];
        if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
            URL.revokeObjectURL(audioUrlRef.current);
        }
        audioUrlRef.current = null;
        audioBase64Ref.current = null;
        audioBlobRef.current = null;
        setHasAudio(false);

        if (audioElementRef.current) {
            audioElementRef.current.pause();
        }

        // Request audio stream from microphone
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    audioStreamRef.current = stream;
                    
                    let mimeType = 'audio/webm';
                    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
                        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                            mimeType = 'audio/webm;codecs=opus';
                        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                            mimeType = 'audio/mp4';
                        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                            mimeType = 'audio/ogg';
                        }
                    }

                    try {
                        const recorder = new MediaRecorder(stream, { mimeType });
                        mediaRecorderRef.current = recorder;

                        recorder.ondataavailable = (e) => {
                            if (e.data && e.data.size > 0) {
                                audioChunksRef.current.push(e.data);
                            }
                        };

                        recorder.onstop = () => {
                            const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                            if (audioBlob.size > 0) {
                                const url = URL.createObjectURL(audioBlob);
                                audioUrlRef.current = url;
                                audioBlobRef.current = audioBlob;
                                setHasAudio(true);

                                // Convert to base64 for persistent JSON export
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    if (typeof reader.result === 'string') {
                                        audioBase64Ref.current = reader.result;
                                    }
                                };
                                reader.readAsDataURL(audioBlob);
                            }
                        };

                        recorder.start(100);
                    } catch (err) {
                        console.warn("Could not start MediaRecorder for audio:", err);
                    }
                })
                .catch(err => {
                    console.warn("Microphone not available or permission denied, recording motion only:", err);
                });
        }
    }, []);

    const stopRecording = useCallback(() => {
        setIsRecording(false);
        setIsPaused(false);
        setFrameCount(bufferRef.current.length);
        setDurationMs(lastTimestamp());

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            try {
                mediaRecorderRef.current.stop();
            } catch (e) {
                console.warn("Error stopping MediaRecorder:", e);
            }
        }

        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(track => track.stop());
            audioStreamRef.current = null;
        }
    }, []);

    const captureFrame = useCallback((data: Omit<FrameData, 'timestamp'>) => {
        if (!isRecording) return;
        
        const now = performance.now();
        const relativeTime = now - startTimeRef.current;

        bufferRef.current.push({
            timestamp: relativeTime,
            ...data
        });
        
        // Only update UI count every ~10 frames to save React renders
        if (bufferRef.current.length % 10 === 0) {
            setFrameCount(bufferRef.current.length);
        }
    }, [isRecording]);

    // --- PLAYBACK ---
    const prepareAudio = () => {
        if (!audioUrlRef.current) return null;
        if (!audioElementRef.current) audioElementRef.current = new Audio();
        audioElementRef.current.src = audioUrlRef.current;
        audioElementRef.current.currentTime = 0;
        return audioElementRef.current;
    };

    const togglePlayback = useCallback(() => {
        if (bufferRef.current.length === 0) return;

        if (isPlaying) {
            if (pausedRef.current) {
                // Play pressed while paused after a scrub: resume from there.
                pausedRef.current = false;
                setIsPaused(false);
                playbackStartTimeRef.current = performance.now() - pausedAtMsRef.current;
                audioElementRef.current?.play().catch(() => {});
                return;
            }
            setIsPlaying(false);
            audioElementRef.current?.pause();
        } else {
            setIsRecording(false);
            setIsPlaying(true);
            pausedRef.current = false;
            setIsPaused(false);
            playbackStartTimeRef.current = performance.now();
            prepareAudio()?.play().catch(err => {
                console.warn("Audio playback interrupted or blocked:", err);
            });
        }
    }, [isPlaying]);

    const getPlaybackTimeMs = useCallback((): number => {
        const d = lastTimestamp();
        const t = pausedRef.current ? pausedAtMsRef.current : performance.now() - playbackStartTimeRef.current;
        return Math.max(0, Math.min(d, t));
    }, []);

    const scrubTo = useCallback((timeMs: number) => {
        const ms = Math.max(0, Math.min(lastTimestamp(), timeMs));
        pausedAtMsRef.current = ms;
        playbackStartTimeRef.current = performance.now() - ms;
        if (audioElementRef.current && audioUrlRef.current) {
            try { audioElementRef.current.currentTime = ms / 1000; } catch { /* seek before audio metadata is loaded */ }
        }
    }, []);

    const beginScrub = useCallback(() => {
        if (bufferRef.current.length === 0) return;
        resumeAfterScrubRef.current = isPlaying && !pausedRef.current;
        if (!isPlaying) {
            // Scrubbing from stopped: enter playback, paused, at the current clock.
            setIsRecording(false);
            setIsPlaying(true);
            playbackStartTimeRef.current = performance.now();
            prepareAudio();
        }
        pausedAtMsRef.current = isPlaying ? getPlaybackTimeMs() : 0;
        pausedRef.current = true;
        setIsPaused(true);
        audioElementRef.current?.pause();
    }, [isPlaying, getPlaybackTimeMs]);

    const endScrub = useCallback(() => {
        if (!resumeAfterScrubRef.current) return; // stay paused on the scrubbed frame
        resumeAfterScrubRef.current = false;
        pausedRef.current = false;
        setIsPaused(false);
        playbackStartTimeRef.current = performance.now() - pausedAtMsRef.current;
        audioElementRef.current?.play().catch(() => {});
    }, []);

    /** Exit playback entirely: back to live view in one click. */
    const stopPlayback = useCallback(() => {
        setIsPlaying(false);
        pausedRef.current = false;
        setIsPaused(false);
        audioElementRef.current?.pause();
    }, []);

    // Helper to get the current frame during playback
    const getPlaybackFrame = useCallback((): FrameData | null => {
        const frames = bufferRef.current;
        if (!isPlaying || frames.length === 0) return null;

        const now = performance.now();
        let playbackTime = pausedRef.current ? pausedAtMsRef.current : now - playbackStartTimeRef.current;
        const duration = frames[frames.length - 1].timestamp;

        // Loop (never while paused; never on a degenerate one-frame take)
        if (!pausedRef.current && duration > 0 && playbackTime > duration) {
            playbackStartTimeRef.current = now;
            playbackTime = 0;
            if (audioElementRef.current && audioUrlRef.current) {
                audioElementRef.current.currentTime = 0;
                audioElementRef.current.play().catch(() => {});
            }
        }

        return frames[findFrameIndex(frames, playbackTime)];
    }, [isPlaying]);

    // --- EXPORT / IMPORT ---
    const getFrames = useCallback((): FrameData[] => bufferRef.current, []);

    /** The take's audio as a Blob: the live recording, or decoded from an imported file's data URL. */
    const getAudio = useCallback((): { blob: Blob; mimeType: string } | null => {
        if (audioBlobRef.current) {
            return { blob: audioBlobRef.current, mimeType: audioBlobRef.current.type || 'audio/webm' };
        }
        const parsed = audioBase64Ref.current ? parseDataUrl(audioBase64Ref.current) : null;
        if (!parsed) return null;
        const bin = atob(parsed.base64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return { blob: new Blob([buf], { type: parsed.mimeType }), mimeType: parsed.mimeType };
    }, []);

    /** 'full' / 'kinematics' v3 JSON as a Blob (worker first, chunked main-thread fallback).
     *
     * Async since the 'full'/'kinematics' paths try a Worker first (TDD-002
     * P2): callers (RecorderControls.tsx's onClick handlers) already just
     * call exportData fire-and-forget, never `await` it, so the returned
     * promise resolving after the fact is invisible to them - the download
     * still lands the same way it always has, just not necessarily on the
     * same tick.
     *
     * 'full' and 'kinematics', v3 shape (TDD-002 P1 shape, P2 dispatch): try
     * the Worker first so a long take's buildEnvelope/buildKinematics +
     * JSON.stringify runs off the main thread; fall back to the chunked
     * main-thread path in recordingSchema.ts if Workers are unavailable or
     * the worker fails to construct, load, or run.
     *
     * Audio plumbing (refs, state) is unchanged from v2: audioBase64Ref
     * still holds a data URL. parseDataUrl is one cheap string split, so it
     * stays synchronous here (not moved into the worker); only the
     * already-parsed { mimeType, base64 } crosses into the worker/fallback,
     * to be attached to the envelope before the one expensive serializeV3
     * call (kinematics exports never carry audio, matching
     * RecordingV3Kinematics having no audio field).
     *
     * Note: audioBase64Ref is only filled by a FileReader after recording
     * stops, so buildRecordingBlob('full') called immediately after Stop
     * could miss audio; that race exists today and is unchanged. getAudio
     * does not have it (it prefers the live blob).
     */
    const buildRecordingBlob = useCallback(async (kind: 'full' | 'kinematics'): Promise<Blob> => {
        const audio = kind === 'full' && audioBase64Ref.current ? (parseDataUrl(audioBase64Ref.current) ?? undefined) : undefined;
        const request: SerializeRequest = { frames: bufferRef.current, type, kind, durationMs: lastTimestamp(), audio };
        try {
            return await runSerializeWorker(request);
        } catch (err) {
            console.warn('Worker export unavailable, falling back to chunked main-thread serialize:', err);
            const json = await serializeV3Chunked(request.frames, request.type, request.kind, {
                durationMs: request.durationMs,
                video: request.video,
                audio: request.audio,
            });
            return new Blob([json], { type: 'application/json' });
        }
    }, [type]);

    const exportData = useCallback(async (format: 'full' | 'kinematics' | 'audio' = 'full') => {
        if (bufferRef.current.length === 0 && format !== 'audio') {
            alert("No recording to export.");
            return;
        }

        const dateStr = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

        if (format === 'audio') {
            const audio = getAudio();
            if (!audio) {
                alert("No audio track recorded in this session.");
                return;
            }
            downloadBlob(audio.blob, `${type.toLowerCase()}_audio_${dateStr}.${extensionForMime(audio.mimeType)}`);
            return;
        }

        const blob = await buildRecordingBlob(format);
        downloadBlob(blob, `${type.toLowerCase()}_${format === 'kinematics' ? 'kinematics' : 'recording'}_${dateStr}.json`);
    }, [type, getAudio, buildRecordingBlob]);

    const loadData = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json: unknown = JSON.parse(e.target?.result as string);

                // Basic validation, before migrateV2 so a malformed file still
                // gets a clear message instead of silently loading 0 frames.
                if (!json || typeof json !== 'object' || !Array.isArray((json as any).frames)) {
                    throw new Error("Invalid file format: missing frames");
                }

                const fileType = detectTrackingType(json);
                if (fileType && fileType !== type) {
                    const confirm = window.confirm(`This file is type "${fileType}" but you are in "${type}" mode. Load anyway?`);
                    if (!confirm) return;
                }

                // Runs v2 ("2.0" / "2.0-kinematics"), v3 ("puppeteer-lab/recording"),
                // and any already-FrameData[] shape through one code path.
                const frames = migrateV2(json);

                bufferRef.current = frames;
                setFrameCount(frames.length);
                setDurationMs(lastTimestamp());
                setIsPlaying(false);
                setIsRecording(false);

                // Load synchronized audio if present. v3 files carry it as
                // audio: { mimeType, base64 }; v2 files carry a top-level
                // audioBase64 data URL directly.
                const v3Audio = (json as any).audio as { mimeType: string; base64: string } | null | undefined;
                const audioDataUrl = v3Audio ? toDataUrl(v3Audio.mimeType, v3Audio.base64) : (json as any).audioBase64;

                // A loaded session has no live Blob, so clear audioBlobRef and let
                // audio export fall through to the base64 decode path.
                audioBlobRef.current = null;
                if (audioDataUrl) {
                    audioBase64Ref.current = audioDataUrl;
                    setHasAudio(true);
                    // Convert the data URL to a blob URL (TDD-002 risk fix):
                    // seeking on a data URL is slower than on a blob URL in
                    // some browsers, and the unmount cleanup already only
                    // revokes URLs that start with 'blob:'.
                    fetch(audioDataUrl)
                        .then((r) => r.blob())
                        .then((blob) => {
                            if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
                                URL.revokeObjectURL(audioUrlRef.current);
                            }
                            const blobUrl = URL.createObjectURL(blob);
                            audioUrlRef.current = blobUrl;
                            if (!audioElementRef.current) {
                                audioElementRef.current = new Audio();
                            }
                            audioElementRef.current.src = blobUrl;
                        })
                        .catch((err) => console.warn("Failed to convert loaded audio to a blob URL:", err));
                } else {
                    setHasAudio(false);
                    audioUrlRef.current = null;
                    audioBase64Ref.current = null;
                }

                alert(`Loaded ${frames.length} frames.${audioDataUrl ? ' (With synchronized audio)' : ''}`);

            } catch (err) {
                console.error(err);
                alert("Failed to load file. Check console for details.");
            }
        };
        reader.readAsText(file);
    }, [type]);

    return {
        isRecording,
        isPlaying,
        isPaused,
        frameCount,
        hasAudio,
        durationMs,
        startRecording,
        stopRecording,
        captureFrame,
        togglePlayback,
        stopPlayback,
        getPlaybackTimeMs,
        beginScrub,
        scrubTo,
        endScrub,
        getPlaybackFrame,
        exportData,
        loadData,
        getFrames,
        getAudio,
        buildRecordingBlob,
        hasData: frameCount > 0
    };
};
