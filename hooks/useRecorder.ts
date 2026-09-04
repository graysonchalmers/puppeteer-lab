
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { FrameData, RecordingSession, TrackingType } from '../types';

export const useRecorder = (type: TrackingType) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [frameCount, setFrameCount] = useState(0);
    const [hasAudio, setHasAudio] = useState(false);
    
    // The main data store
    const bufferRef = useRef<FrameData[]>([]);
    
    // Timing refs
    const startTimeRef = useRef<number>(0);
    const playbackStartTimeRef = useRef<number>(0);

    // Audio recording & playback refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioUrlRef = useRef<string | null>(null);
    const audioBase64Ref = useRef<string | null>(null);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);

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
        setIsPlaying(false);
        setIsRecording(true);
        startTimeRef.current = performance.now();

        // Audio initialization
        audioChunksRef.current = [];
        if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
            URL.revokeObjectURL(audioUrlRef.current);
        }
        audioUrlRef.current = null;
        audioBase64Ref.current = null;
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
        setFrameCount(bufferRef.current.length);

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
    const togglePlayback = useCallback(() => {
        if (bufferRef.current.length === 0) return;
        
        if (isPlaying) {
            setIsPlaying(false);
            if (audioElementRef.current) {
                audioElementRef.current.pause();
            }
        } else {
            setIsRecording(false);
            setIsPlaying(true);
            playbackStartTimeRef.current = performance.now();

            if (audioUrlRef.current) {
                if (!audioElementRef.current) {
                    audioElementRef.current = new Audio();
                }
                audioElementRef.current.src = audioUrlRef.current;
                audioElementRef.current.currentTime = 0;
                audioElementRef.current.play().catch(err => {
                    console.warn("Audio playback interrupted or blocked:", err);
                });
            }
        }
    }, [isPlaying]);

    // Seek playback to specific relative time (ms)
    const seekPlayback = useCallback((timeMs: number) => {
        playbackStartTimeRef.current = performance.now() - timeMs;
        if (audioElementRef.current && audioUrlRef.current) {
            try {
                audioElementRef.current.currentTime = Math.max(0, timeMs / 1000);
            } catch (e) {}
        }
    }, []);

    // Helper to get the current frame during playback
    const getPlaybackFrame = useCallback((): FrameData | null => {
        if (!isPlaying || bufferRef.current.length === 0) return null;

        const now = performance.now();
        let playbackTime = now - playbackStartTimeRef.current;
        
        const duration = bufferRef.current[bufferRef.current.length - 1].timestamp;

        // Loop
        if (playbackTime > duration) {
            playbackStartTimeRef.current = now;
            playbackTime = 0;

            if (audioElementRef.current && audioUrlRef.current) {
                audioElementRef.current.currentTime = 0;
                audioElementRef.current.play().catch(() => {});
            }
        }

        // Find frame
        const frame = bufferRef.current.find(f => f.timestamp >= playbackTime);
        return frame || bufferRef.current[bufferRef.current.length - 1];

    }, [isPlaying]);

    // --- EXPORT / IMPORT ---
    const exportData = useCallback((format: 'full' | 'kinematics' | 'audio' = 'full') => {
        if (bufferRef.current.length === 0 && format !== 'audio') {
            alert("No recording to export.");
            return;
        }

        const dateStr = new Date().toISOString().slice(0, 19).replace(/:/g, "-");

        if (format === 'audio') {
            if (!audioBase64Ref.current && !audioBlobRef.current) {
                alert("No audio track recorded in this session.");
                return;
            }
            // Download audio blob or base64
            let audioBlob: Blob;
            if (audioBlobRef.current) {
                audioBlob = audioBlobRef.current;
            } else {
                const byteCharacters = atob(audioBase64Ref.current!.split(',')[1] || audioBase64Ref.current!);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                audioBlob = new Blob([new Uint8Array(byteNumbers)], { type: 'audio/webm' });
            }

            const url = URL.createObjectURL(audioBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${type.toLowerCase()}_audio_${dateStr}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }

        if (format === 'kinematics') {
            // Export raw 3D animation telemetry without base64 audio
            const kinematicsSession = {
                version: "2.0-kinematics",
                type: type,
                date: new Date().toISOString(),
                fps: 60,
                frameCount: bufferRef.current.length,
                durationSeconds: bufferRef.current.length > 0 ? bufferRef.current[bufferRef.current.length - 1].timestamp / 1000 : 0,
                frames: bufferRef.current.map(f => ({
                    timestampMs: f.timestamp,
                    handLandmarks: f.handLandmarks,
                    faceLandmarks: f.faceLandmarks,
                    blendshapes: f.blendshapes
                }))
            };

            const blob = new Blob([JSON.stringify(kinematicsSession, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${type.toLowerCase()}_kinematics_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }

        // Full Session bundle
        const session: RecordingSession = {
            version: "2.0",
            type: type,
            date: new Date().toISOString(),
            duration: bufferRef.current.length > 0 ? bufferRef.current[bufferRef.current.length - 1].timestamp / 1000 : 0,
            frames: bufferRef.current,
            hasAudio: Boolean(audioUrlRef.current),
            audioBase64: audioBase64Ref.current || undefined
        };

        const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${type.toLowerCase()}_recording_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [type]);

    const loadData = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target?.result as string) as RecordingSession;
                
                // Basic validation
                if (!json.frames || !Array.isArray(json.frames)) {
                    throw new Error("Invalid file format: missing frames");
                }

                if (json.type !== type) {
                    const confirm = window.confirm(`This file is type "${json.type}" but you are in "${type}" mode. Load anyway?`);
                    if (!confirm) return;
                }

                bufferRef.current = json.frames;
                setFrameCount(json.frames.length);
                setIsPlaying(false);
                setIsRecording(false);

                // Load synchronized audio if present
                if (json.audioBase64) {
                    audioBase64Ref.current = json.audioBase64;
                    audioUrlRef.current = json.audioBase64;
                    setHasAudio(true);
                    if (!audioElementRef.current) {
                        audioElementRef.current = new Audio();
                    }
                    audioElementRef.current.src = json.audioBase64;
                } else {
                    setHasAudio(false);
                    audioUrlRef.current = null;
                    audioBase64Ref.current = null;
                }

                alert(`Loaded ${json.frames.length} frames.${json.audioBase64 ? ' (With synchronized audio)' : ''}`);

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
        frameCount,
        hasAudio,
        startRecording,
        stopRecording,
        captureFrame,
        togglePlayback,
        seekPlayback,
        getPlaybackFrame,
        exportData,
        loadData,
        hasData: frameCount > 0
    };
};
