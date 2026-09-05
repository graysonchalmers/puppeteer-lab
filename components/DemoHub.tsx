/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  PenTool,
  Gamepad2,
  Video,
  Smile,
  ChevronRight,
  Move,
  Swords,
  Flame,
  Volume2,
  Sliders,
  Share2,
  Eye,
  Disc,
  RotateCcw
} from 'lucide-react';
import { AppMode } from '../types';

interface DemoHubProps {
  onSelectMode: (mode: AppMode) => void;
}

interface DemoSection {
  id: AppMode;
  tag: string;
  tagColor: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  highlights: {
    icon: React.ReactNode;
    title: string;
    detail: string;
  }[];
  actionLabel: string;
  accentColor: string;
  buttonHoverBg: string;
}

const DEMO_SECTIONS: DemoSection[] = [
  {
    id: 'aircanvas',
    tag: 'SPATIAL DRAWING',
    tagColor: 'text-[#38BDF8] border-[#38BDF8]/30 bg-[#38BDF8]/10',
    title: 'Air Canvas',
    description: 'Draw, move, and erase 3D vector lines in mid-air using bimanual hand pinches.',
    icon: <PenTool size={18} className="text-[#38BDF8]" />,
    highlights: [
      {
        icon: <PenTool size={13} className="text-[#EE3B2B]" />,
        title: 'Right Hand Draw',
        detail: 'Pinch thumb and index to sketch glowing 3D vector lines.'
      },
      {
        icon: <Move size={13} className="text-[#38BDF8]" />,
        title: 'Left Hand Move & Delete',
        detail: 'Pinch near a line to reposition; hold still 1s to delete.'
      },
      {
        icon: <RotateCcw size={13} className="text-amber-400" />,
        title: 'Air-Touch Undo & Clear',
        detail: 'Point at on-screen targets hands-free with dwell timers.'
      }
    ],
    actionLabel: 'Launch Canvas',
    accentColor: 'hover:border-[#38BDF8]/50',
    buttonHoverBg: 'hover:bg-[#38BDF8] hover:text-black'
  },
  {
    id: 'game',
    tag: 'TEMPO STRIKE',
    tagColor: 'text-[#EE3B2B] border-[#EE3B2B]/30 bg-[#EE3B2B]/10',
    title: 'Games',
    description: 'Fast-paced 3D spatial gaming where your physical hands become dual light sabers.',
    icon: <Gamepad2 size={18} className="text-[#EE3B2B]" />,
    highlights: [
      {
        icon: <Swords size={13} className="text-[#EE3B2B]" />,
        title: 'Dual 3D Sabers',
        detail: 'Left and right hands drive real-time red and blue laser blades.'
      },
      {
        icon: <Disc size={13} className="text-white" />,
        title: 'Cut to the Beat',
        detail: 'Slice oncoming target cubes synchronized to electronic music.'
      },
      {
        icon: <Flame size={13} className="text-orange-400" />,
        title: 'Velocity Scoring',
        detail: 'Swing faster for bonus points; chain streaks for multipliers.'
      }
    ],
    actionLabel: 'Play Games',
    accentColor: 'hover:border-[#EE3B2B]/50',
    buttonHoverBg: 'hover:bg-[#EE3B2B] hover:text-white'
  },
  {
    id: 'recorder',
    tag: 'MOCAP & AUDIO',
    tagColor: 'text-white border-white/30 bg-white/10',
    title: 'Motion Recorder',
    description: 'Record physical 3D hand motion and microphone audio together with 3D replay.',
    icon: <Video size={18} className="text-white" />,
    highlights: [
      {
        icon: <Volume2 size={13} className="text-blue-400" />,
        title: 'Sync Audio & Motion',
        detail: 'Captures 3D skeletal positions alongside microphone voice.'
      },
      {
        icon: <Sliders size={13} className="text-purple-400" />,
        title: '3D Timeline Scrubber',
        detail: 'Orbit, pan, and scrub through takes with synced audio.'
      },
      {
        icon: <Share2 size={13} className="text-emerald-400" />,
        title: 'Export for 3D Tools',
        detail: 'Download JSON mocap for Blender/Maya or clean WebM audio.'
      }
    ],
    actionLabel: 'Open Recorder',
    accentColor: 'hover:border-white/50',
    buttonHoverBg: 'hover:bg-white hover:text-black'
  },
  {
    id: 'face',
    tag: 'CHARACTER MIMIC',
    tagColor: 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/10',
    title: 'Face Puppet',
    description: 'Stylized 3D character puppet that mirrors your head turns, expressions, and speech.',
    icon: <Smile size={18} className="text-[#22C55E]" />,
    highlights: [
      {
        icon: <Smile size={13} className="text-[#22C55E]" />,
        title: '52 Face Blendshapes',
        detail: 'Tracks smiles, winks, eyebrow raises, and mouth speech shapes.'
      },
      {
        icon: <Eye size={13} className="text-cyan-400" />,
        title: 'Real-Time Eye Gaze',
        detail: '3D character eyeballs match where you are looking live.'
      },
      {
        icon: <Disc size={13} className="text-yellow-400" />,
        title: 'Performance Replay',
        detail: 'Record an acting take and replay your voice in sync.'
      }
    ],
    actionLabel: 'Open Puppet',
    accentColor: 'hover:border-[#22C55E]/50',
    buttonHoverBg: 'hover:bg-[#22C55E] hover:text-black'
  }
];

const DemoHub: React.FC<DemoHubProps> = ({ onSelectMode }) => {
  return (
    <div className="relative w-full h-screen max-h-screen flex flex-col bg-[#090A0C] text-[#EDEDED] font-sans overflow-hidden select-none">
      {/* Subtle background grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-15"
        style={{
          backgroundImage: `
            linear-gradient(to right, #22252C 1px, transparent 1px),
            linear-gradient(to bottom, #22252C 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px'
        }}
      />

      {/* Clean, Transparent Compact Header */}
      <header className="relative z-10 w-full shrink-0 border-b border-white/10 bg-[#090A0C]/80 backdrop-blur-md px-4 sm:px-6 py-2.5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-white/15 to-white/5 border border-white/20 flex items-center justify-center text-white font-mono font-bold text-xs tracking-wider shadow-inner">
            PL
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white font-mono flex items-center gap-1.5 leading-none">
              PUPPETEER LAB
              <span className="w-1.5 h-1.5 rounded-full bg-[#EE3B2B] inline-block" />
            </h1>
            <p className="text-[11px] text-gray-400 font-sans tracking-wide mt-0.5 leading-none">
              Tracking and recording for games and media
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-gray-400">
          <span className="px-2.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300 text-[11px]">
            Zero-Hardware Webcam Tracking
          </span>
        </div>
      </header>

      {/* Main Single-Screen Content Area */}
      <main className="relative z-10 flex-1 min-h-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full flex flex-col justify-center overflow-y-auto lg:overflow-hidden">
        {/* Intro Subtitle Bar */}
        <div className="shrink-0 mb-4 flex justify-between items-center border-b border-white/10 pb-2.5">
          <p className="text-xs sm:text-sm text-gray-300 font-medium">
            Select a live demo powered by your standard webcam:
          </p>
          <span className="font-mono text-[11px] text-gray-500">
            4 Interactive Demos
          </span>
        </div>

        {/* 4 Cards Grid - Natural balanced height, no excessive stretching */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          {DEMO_SECTIONS.map((section) => (
            <div
              key={section.id}
              className={`relative border border-[#22252C] bg-[#111317]/95 p-4 sm:p-5 rounded-xl flex flex-col transition-all duration-200 group ${section.accentColor} shadow-xl`}
            >
              {/* Card Header: Tag & Icon */}
              <div className="flex items-center justify-between gap-2 mb-2.5 shrink-0">
                <span className={`px-2 py-0.5 border rounded text-[10px] font-mono font-semibold tracking-wider ${section.tagColor}`}>
                  {section.tag}
                </span>
                <div className="p-1.5 rounded-md bg-white/5 border border-white/10">
                  {section.icon}
                </div>
              </div>

              {/* Title / Name */}
              <h3 className="text-base font-bold text-white mb-2 font-mono shrink-0">
                {section.title}
              </h3>

              {/* Action Button: Positioned directly beneath the name */}
              <button
                onClick={() => onSelectMode(section.id)}
                className={`w-full flex items-center justify-center gap-1.5 bg-white/10 text-white py-2 px-3 rounded-lg font-mono text-xs uppercase font-bold tracking-wider transition-all duration-150 cursor-pointer border border-white/15 mb-3 shrink-0 ${section.buttonHoverBg}`}
              >
                {section.actionLabel} <ChevronRight size={13} />
              </button>

              {/* Description */}
              <p className="text-[11px] text-gray-400 mb-3 leading-snug font-sans shrink-0 min-h-[32px]">
                {section.description}
              </p>

              {/* Features List */}
              <div className="space-y-1.5 pt-2.5 border-t border-white/5 flex-1">
                {section.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-1.5 rounded-lg bg-[#161920] border border-white/5 text-[11px]"
                  >
                    <div className="mt-0.5 shrink-0">{h.icon}</div>
                    <div className="min-w-0">
                      <span className="font-semibold text-white block text-[11px] font-mono truncate">
                        {h.title}
                      </span>
                      <span className="text-gray-400 text-[10px] leading-tight font-sans block">
                        {h.detail}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Compact Minimalist Footer */}
      <footer className="relative z-10 w-full shrink-0 border-t border-white/10 bg-[#090A0C]/90 px-4 sm:px-6 py-2 flex justify-between items-center text-[10px] font-mono text-gray-500">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 font-semibold">PUPPETEER LAB</span>
          <span>•</span>
          <span className="hidden sm:inline">Zero-hardware tracking for games and media</span>
        </div>
        <div className="text-gray-400">
          Browser Native • Standard Webcam
        </div>
      </footer>
    </div>
  );
};

export default DemoHub;
