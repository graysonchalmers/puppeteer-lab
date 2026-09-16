
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import * as THREE from 'three';

export enum GameStatus {
  LOADING = 'LOADING',
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}

export type AppMode = 'home' | 'game' | 'aircanvas' | 'telemetry' | 'recorder' | 'face';

export type HandType = 'left' | 'right';

// 0: Up, 1: Down, 2: Left, 3: Right, 4: Any (Dot)
export enum CutDirection {
  UP = 0,
  DOWN = 1,
  LEFT = 2,
  RIGHT = 3,
  ANY = 4
}

export interface NoteData {
  id: string;
  time: number;     // Time in seconds when it should reach the player
  lineIndex: number; // 0-3 (horizontal position)
  lineLayer: number; // 0-2 (vertical position)
  type: HandType;    // which hand should cut it
  cutDirection: CutDirection;
  hit?: boolean;
  missed?: boolean;
  hitTime?: number; // Time when hit occurred
}

export interface HandPositions {
  left: THREE.Vector3 | null;
  right: THREE.Vector3 | null;
  leftVelocity: THREE.Vector3;
  rightVelocity: THREE.Vector3;
}

export const COLORS = {
  left: '#ef4444',  // Red-ish
  right: '#3b82f6', // Blue-ish
  track: '#111111',
  hittable: '#ffffff'
};

// --- EXPORT / RECORDING TYPES ---

export type TrackingType = 'HAND' | 'FACE';

export interface FrameData {
    timestamp: number; // Relative time in ms
    
    // HAND DATA
    leftHand?: THREE.Vector3 | null;
    rightHand?: THREE.Vector3 | null;
    landmarks?: any[]; // Raw 2D landmarks
    
    // FACE DATA
    faceLandmarks?: any[]; // Raw 2D/3D landmarks
    blendshapes?: Record<string, number>;
}

export interface RecordingSession {
    version: string;
    date: string;
    type: TrackingType;
    duration: number; // Seconds
    frames: FrameData[];
    audioBase64?: string; // Synchronized audio data URL (data:audio/webm;base64,...)
    audioMimeType?: string;
    hasAudio?: boolean;
}

// --- V3 RECORDING SCHEMA ---
// See docs/tdd/TDD-002-recording-schema-and-export.md and
// docs/superpowers/plans/2026-09-16-item6-schema-v3-blender-importer.md.
// Added alongside FrameData/RecordingSession above, not replacing them: the
// live recording buffer in useRecorder.ts stays FrameData[] end to end. The
// v3 shape exists only at the export/import boundary, built and read by
// components/shared/recordingSchema.ts.

export type RecordingV3Side = 'left' | 'right';

/** [x, y, z] triple. Landmarks and world points are stored as tuples, not
 * {x,y,z} objects, per the v3 compactness rule (about 40% smaller once
 * stringified). */
export type Vec3Tuple = [number, number, number];

export interface RecordingV3World {
    mapping: string; // e.g. "mapHandToWorld@1"
    xRange: number;
    yRange: number;
    yOffset: number;
    zScale: number;
}

export interface RecordingV3Source {
    app: string;
    commit: string;
}

export interface RecordingV3Capture {
    fps: number; // measured, see the fps formula in recordingSchema.ts
    durationMs: number;
    frameCount: number;
    video?: { width: number; height: number };
}

export type RecordingV3Channel = 'hands' | 'face';

export interface RecordingV3Hand {
    side: RecordingV3Side;
    score: number;
    /**
     * True when only a single already-mapped point is known for this hand
     * (legacy Motion Recorder captures, which only ever stored leftHand /
     * rightHand, never per-landmark data). When true, landmarks is null and
     * world has exactly one non-null entry at index 8 (the index fingertip,
     * the same point useMediaPipe.ts maps for the on-screen cursor). Not part
     * of the TDD's literal four-field shorthand for a hand entry; added so
     * migrateV2's v3-in path can invert buildEnvelope losslessly.
     */
    partial?: boolean;
    landmarks: Vec3Tuple[] | null; // 21 x [x,y,z] normalized, 4 dp
    world: (Vec3Tuple | null)[] | null; // 21 x [x,y,z] world units, 3 dp
}

export interface RecordingV3Face {
    landmarks: Vec3Tuple[] | null; // ~478 x [x,y,z] normalized, 4 dp
    blendshapes: Record<string, number>;
}

export interface RecordingV3Frame {
    t: number; // ms since capture start
    hands: RecordingV3Hand[];
    face: RecordingV3Face | null;
}

export interface RecordingV3Audio {
    mimeType: string;
    base64: string; // payload only, no "data:...;base64," prefix
}

export interface RecordingV3 {
    schema: 'puppeteer-lab/recording';
    version: 3;
    createdAt: string;
    source: RecordingV3Source;
    capture: RecordingV3Capture;
    world: RecordingV3World;
    channels: RecordingV3Channel[];
    frames: RecordingV3Frame[];
    audio: RecordingV3Audio | null;
}

export interface RecordingV3KinematicsHand {
    side: RecordingV3Side;
    world: (Vec3Tuple | null)[] | null;
}

export interface RecordingV3KinematicsFace {
    blendshapes: Record<string, number>;
}

export interface RecordingV3KinematicsFrame {
    t: number;
    hands: RecordingV3KinematicsHand[];
    face: RecordingV3KinematicsFace | null;
}

export interface RecordingV3Kinematics {
    schema: 'puppeteer-lab/kinematics';
    version: 3;
    createdAt: string;
    source: RecordingV3Source;
    capture: RecordingV3Capture;
    world: RecordingV3World;
    channels: RecordingV3Channel[];
    frames: RecordingV3KinematicsFrame[];
}
