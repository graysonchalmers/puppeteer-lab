
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import * as THREE from 'three';
import React from 'react';

export enum GameStatus {
  LOADING = 'LOADING',
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}

export type AppMode = 'home' | 'game' | 'debug' | 'recorder' | 'face';

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


// Type augmentation for React Three Fiber elements to fix JSX.IntrinsicElements errors
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      spotLight: any;
      directionalLight: any;
      color: any;
      fog: any;
      mesh: any;
      group: any;
      position: any;
      gridHelper: any;
      sphereGeometry: any;
      boxGeometry: any;
      planeGeometry: any;
      cylinderGeometry: any;
      capsuleGeometry: any;
      torusGeometry: any;
      ringGeometry: any;
      extrudeGeometry: any;
      octahedronGeometry: any;
      icosahedronGeometry: any;
      meshStandardMaterial: any;
      meshBasicMaterial: any;
      meshPhysicalMaterial: any;
      meshNormalMaterial: any;
      primitive: any;
      canvas: any;
      [elemName: string]: any;
    }
  }
}
