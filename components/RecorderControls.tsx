
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useState } from 'react';
import { Circle, Square, Play, Pause, Download, Upload, ChevronDown, Music, Activity, FileJson } from 'lucide-react';

interface RecorderControlsProps {
    isRecording: boolean;
    isPlaying: boolean;
    hasData: boolean;
    frameCount: number;
    hasAudio?: boolean;
    onRecord: () => void;
    onStop: () => void;
    onPlayToggle: () => void;
    onExport: (format?: 'full' | 'kinematics' | 'audio') => void;
    onImport: (file: File) => void;
}

const RecorderControls: React.FC<RecorderControlsProps> = ({
    isRecording,
    isPlaying,
    hasData,
    frameCount,
    hasAudio,
    onRecord,
    onStop,
    onPlayToggle,
    onExport,
    onImport
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);

    return (
        <div className="flex flex-col gap-3 bg-[#090A0C]/90 backdrop-blur-md border border-white/15 p-4 rounded-xl shadow-2xl min-w-[280px]">
            {/* Header Stats */}
            <div className="flex justify-between items-center text-[11px] font-mono text-gray-400 border-b border-white/10 pb-2">
                <span className="flex items-center gap-1.5 font-bold tracking-wider text-white">
                    SYS.RECORDER
                    {hasAudio && (
                        <span className="text-[9px] text-white bg-white/10 border border-white/20 px-1 py-0.5 rounded">
                            AUDIO ACTIVE
                        </span>
                    )}
                </span>
                <div className="flex gap-2.5">
                    <span>FRAMES: <span className="text-white font-bold">{frameCount}</span></span>
                    <span>
                        <span className={isRecording ? "text-[#EE3B2B] font-bold animate-pulse" : isPlaying ? "text-white font-bold" : "text-gray-500"}>
                            {isRecording ? "● REC" : isPlaying ? "▶ PLAY" : "IDLE"}
                        </span>
                    </span>
                </div>
            </div>

            {/* Main Transport Controls */}
            <div className="flex items-center justify-center gap-4 my-1">
                {/* Record / Stop */}
                {!isRecording ? (
                    <button 
                        onClick={onRecord}
                        disabled={isPlaying}
                        className="w-11 h-11 rounded-full bg-white/5 hover:bg-[#EE3B2B]/20 border border-white/20 hover:border-[#EE3B2B] flex items-center justify-center group transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Start Recording (With Audio)"
                    >
                        <Circle fill="#EE3B2B" className="text-[#EE3B2B] group-hover:scale-105 transition-transform" size={16} />
                    </button>
                ) : (
                    <button 
                        onClick={onStop}
                        className="w-11 h-11 rounded-full bg-[#EE3B2B] hover:bg-[#EE3B2B]/90 text-white flex items-center justify-center animate-pulse shadow-[0_0_12px_rgba(238,59,43,0.6)]"
                        title="Stop Recording"
                    >
                        <Square fill="currentColor" size={16} />
                    </button>
                )}

                {/* Play / Pause */}
                <button 
                    onClick={onPlayToggle}
                    disabled={!hasData || isRecording}
                    className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                        isPlaying 
                        ? 'bg-white text-black border-white shadow-[0_0_12px_rgba(255,255,255,0.4)]' 
                        : 'bg-white/5 border-white/20 text-white hover:bg-white/15'
                    }`}
                    title={isPlaying ? "Pause" : "Play Replay"}
                >
                    {isPlaying ? <Pause fill="currentColor" size={16} /> : <Play fill="currentColor" size={16} className="ml-0.5" />}
                </button>
            </div>

            {/* File Operations */}
            <div className="relative flex gap-2 mt-1">
                {/* Export Dropdown Group */}
                <div className="flex-1 flex rounded-lg overflow-hidden border border-white/10 bg-white/5">
                    <button 
                        onClick={() => onExport('full')}
                        disabled={!hasData}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 hover:bg-white/10 text-[11px] font-mono text-gray-200 transition-colors disabled:opacity-30"
                        title="Export Full Session Bundle (.json)"
                    >
                        <Download size={13} /> Export
                    </button>
                    <button 
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        disabled={!hasData}
                        className="px-2 border-l border-white/10 hover:bg-white/10 text-gray-300 disabled:opacity-30"
                        title="Export Formats"
                    >
                        <ChevronDown size={13} />
                    </button>
                </div>

                {/* Import Button */}
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-200 border border-white/10 transition-colors"
                >
                    <Upload size={13} /> Load JSON
                </button>
                <input 
                    ref={fileInputRef}
                    type="file" 
                    accept=".json" 
                    className="hidden"
                    onChange={(e) => {
                        if (e.target.files?.[0]) onImport(e.target.files[0]);
                        e.target.value = ''; 
                    }}
                />

                {/* Export Options Popover */}
                {showExportMenu && (
                    <div className="absolute bottom-full mb-2 left-0 right-0 bg-[#111317] border border-white/20 rounded-lg p-1.5 shadow-2xl z-50 flex flex-col gap-1 text-[11px] font-mono">
                        <div className="px-2 py-1 text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-white/10">
                            Select Export Format
                        </div>
                        <button
                            onClick={() => { onExport('full'); setShowExportMenu(false); }}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/10 text-left text-gray-200"
                        >
                            <FileJson size={13} className="text-white" />
                            <div>
                                <div className="font-semibold text-white">Full Session (.json)</div>
                                <div className="text-[9px] text-gray-400">Frames + Audio Bundle</div>
                            </div>
                        </button>
                        <button
                            onClick={() => { onExport('kinematics'); setShowExportMenu(false); }}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/10 text-left text-gray-200"
                        >
                            <Activity size={13} className="text-gray-300" />
                            <div>
                                <div className="font-semibold text-white">Animation Trackers (.json)</div>
                                <div className="text-[9px] text-gray-400">Pure 3D coordinates (Blender/Maya)</div>
                            </div>
                        </button>
                        {hasAudio && (
                            <button
                                onClick={() => { onExport('audio'); setShowExportMenu(false); }}
                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/10 text-left text-gray-200 border-t border-white/10 mt-0.5 pt-1.5"
                            >
                                <Music size={13} className="text-white" />
                                <div>
                                    <div className="font-semibold text-white">Audio Track (.webm)</div>
                                    <div className="text-[9px] text-gray-400">Clean microphone track</div>
                                </div>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RecorderControls;
