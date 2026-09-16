/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The v3 recording envelope: a versioned, compact, self-describing shape for
 * exported takes (docs/tdd/TDD-002-recording-schema-and-export.md). This
 * module owns building it from FrameData[], serializing it, and migrating
 * older files back into FrameData[] on load.
 *
 * Deliberately NOT the live recording buffer: useRecorder.ts's bufferRef
 * stays FrameData[] end to end (see the plan's Architecture note). This
 * module is called only at the export/import boundary, so it stays a pure,
 * synchronous, unit-testable module with no React/DOM/Worker dependency
 * (Task 2 imports it into a Worker unchanged).
 */
import { Vector3 } from 'three';
import {
    FrameData,
    TrackingType,
    RecordingV3,
    RecordingV3Kinematics,
    RecordingV3Frame,
    RecordingV3KinematicsFrame,
    RecordingV3Hand,
    RecordingV3KinematicsHand,
    RecordingV3Face,
    RecordingV3Side,
    RecordingV3World,
    Vec3Tuple,
} from '../../types';

// World mapping constants, ported from hooks/useMediaPipe.ts's mapHandToWorld
// (lines ~14-35), not copied from the TDD's prose. Kept as plain numbers (no
// THREE dependency for the math itself) so this module stays cheap to import
// into a Worker in Task 2.
//
// mapHandToWorld mirrors X (worldX = (0.5 - x) * xRange): normalized x=0 is
// screen-left, and with facingMode 'user' that is the user's physically
// RIGHT hand. Anything that reads world[] and cares which physical hand is
// which needs to account for this mirror, not just the "left"/"right" side
// label.
const GAME_X_RANGE = 5;
const GAME_Y_RANGE = 3.5;
const Y_OFFSET = 0.8;
const Z_SCALE = 8;

const WORLD_META: RecordingV3World = {
    mapping: 'mapHandToWorld@1',
    xRange: GAME_X_RANGE,
    yRange: GAME_Y_RANGE,
    yOffset: Y_OFFSET,
    zScale: Z_SCALE,
};

/** Index of the landmark useMediaPipe.ts maps for the leftHand/rightHand
 * cursor position (INDEX_FINGER_TIP). Motion Recorder never stored the other
 * 20 landmarks, so a migrated/partial hand only ever has this one point. */
const PARTIAL_HAND_LANDMARK_INDEX = 8;
const HAND_LANDMARK_COUNT = 21;

const round = (n: number, dp: number): number => {
    const f = 10 ** dp;
    const r = Math.round(n * f) / f;
    // Normalize -0 to 0: JSON.stringify already collapses -0 to "0", so
    // leaving -0 in the in-memory envelope would make it unequal to itself
    // after a serialize+parse round trip.
    return r === 0 ? 0 : r;
};

const roundTriple = (x: number, y: number, z: number, dp: number): Vec3Tuple => [round(x, dp), round(y, dp), round(z, dp)];

/**
 * Same formula as useMediaPipe.ts's mapHandToWorld, applied per landmark.
 * The app's on-screen cursor feeds this a hand-size-derived depth offset (see
 * useMediaPipe.ts:193-204), but a per-landmark world[] array instead passes
 * that landmark's own relative z straight through * zScale, so the root
 * "world" metadata block fully describes the transform (no hidden baseline
 * constant an importer would need to guess).
 */
const mapPointToWorld = (x: number, y: number, z: number): Vec3Tuple => {
    const worldX = (0.5 - x) * GAME_X_RANGE;
    const worldY = (1.0 - y) * GAME_Y_RANGE - GAME_Y_RANGE / 2 + Y_OFFSET;
    const worldZ = z * Z_SCALE;
    return roundTriple(worldX, Math.max(0.1, worldY), worldZ, 3);
};

const buildStamp = (): string => (typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : 'dev/unknown');

/** frameCount > 1: (frameCount - 1) / (durationMs / 1000); n frames span
 * n-1 intervals. 0 (never NaN/Infinity) for a degenerate 0- or 1-frame take,
 * or a zero-duration take. */
const measureFps = (frameCount: number, durationMs: number): number => {
    if (frameCount <= 1 || durationMs <= 0) return 0;
    return (frameCount - 1) / (durationMs / 1000);
};

interface LandmarkLike {
    x: number;
    y: number;
    z?: number;
}

/** Full hand, from a raw landmarks array (Hand Telemetry pattern): side is
 * inferred from array order (index 0 = right, index 1 = left), matching
 * resolveHands.ts's own fallback and the fact that FrameData.landmarks never
 * carried handedness even in live capture. */
const buildFullHand = (landmarks: LandmarkLike[], side: RecordingV3Side): RecordingV3Hand => ({
    side,
    score: 1,
    landmarks: landmarks.map((lm) => roundTriple(lm.x, lm.y, lm.z ?? 0, 4)),
    world: landmarks.map((lm) => mapPointToWorld(lm.x, lm.y, lm.z ?? 0)),
});

/** Partial hand, from an already-mapped single point (Motion Recorder
 * pattern): only world[8] is known, landmarks stays null. */
const buildPartialHand = (point: { x: number; y: number; z: number }, side: RecordingV3Side): RecordingV3Hand => {
    const world: (Vec3Tuple | null)[] = new Array(HAND_LANDMARK_COUNT).fill(null);
    world[PARTIAL_HAND_LANDMARK_INDEX] = roundTriple(point.x, point.y, point.z, 3);
    return { side, score: 1, partial: true, landmarks: null, world };
};

/** Maps one FrameData frame's hand fields to v3 hands[], per TDD-002's three
 * field patterns. landmarks (when present) is the richer source and wins
 * over leftHand/rightHand: tip/velocity/pinch derive from landmarks and are
 * not stored separately (per the TDD's compactness rules), and leftHand /
 * rightHand are exactly that derived tip position. */
const mapFrameHands = (frame: FrameData): RecordingV3Hand[] => {
    if (frame.landmarks && frame.landmarks.length > 0) {
        return frame.landmarks
            .slice(0, 2)
            .map((lm: LandmarkLike[], i: number) => buildFullHand(lm, i === 0 ? 'right' : 'left'));
    }
    const hands: RecordingV3Hand[] = [];
    if (frame.rightHand) hands.push(buildPartialHand(frame.rightHand, 'right'));
    if (frame.leftHand) hands.push(buildPartialHand(frame.leftHand, 'left'));
    return hands;
};

const mapFrameFace = (frame: FrameData): RecordingV3Face | null => {
    if (!frame.faceLandmarks && !frame.blendshapes) return null;
    return {
        landmarks: frame.faceLandmarks ? frame.faceLandmarks.map((lm: LandmarkLike) => roundTriple(lm.x, lm.y, lm.z ?? 0, 4)) : null,
        blendshapes: frame.blendshapes ?? {},
    };
};

export function buildEnvelope(
    frames: FrameData[],
    type: TrackingType,
    opts: { durationMs: number; video?: { width: number; height: number } }
): RecordingV3 {
    const v3Frames: RecordingV3Frame[] = frames.map((frame) => ({
        t: frame.timestamp,
        hands: mapFrameHands(frame),
        face: mapFrameFace(frame),
    }));

    return {
        schema: 'puppeteer-lab/recording',
        version: 3,
        createdAt: new Date().toISOString(),
        source: { app: 'puppeteer-lab', commit: buildStamp() },
        capture: {
            fps: measureFps(frames.length, opts.durationMs),
            durationMs: opts.durationMs,
            frameCount: frames.length,
            video: opts.video,
        },
        world: WORLD_META,
        channels: type === 'FACE' ? ['face'] : ['hands'],
        frames: v3Frames,
        audio: null,
    };
}

export function buildKinematics(frames: FrameData[], type: TrackingType, durationMs: number): RecordingV3Kinematics {
    const v3Frames: RecordingV3KinematicsFrame[] = frames.map((frame) => {
        const hands: RecordingV3KinematicsHand[] = mapFrameHands(frame).map((h) => ({ side: h.side, world: h.world }));
        const face = mapFrameFace(frame);
        return {
            t: frame.timestamp,
            hands,
            face: face ? { blendshapes: face.blendshapes } : null,
        };
    });

    return {
        schema: 'puppeteer-lab/kinematics',
        version: 3,
        createdAt: new Date().toISOString(),
        source: { app: 'puppeteer-lab', commit: buildStamp() },
        capture: {
            fps: measureFps(frames.length, durationMs),
            durationMs,
            frameCount: frames.length,
        },
        world: WORLD_META,
        channels: type === 'FACE' ? ['face'] : ['hands'],
        frames: v3Frames,
    };
}

export function serializeV3(envelope: RecordingV3 | RecordingV3Kinematics): string {
    return JSON.stringify(envelope);
}

// --- migrateV2 ---

const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null;

const vectorOrNull = (v: any): Vector3 | null => {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') return null;
    return new Vector3(v.x, v.y, v.z);
};

/** v3 hands[] -> the FrameData fields the demo components already read:
 * a full (non-partial) hand contributes to `landmarks` (right first, then
 * left, matching the array-order convention buildEnvelope reads it with);
 * a partial hand's world[8] becomes leftHand/rightHand. */
const extractHandsFromV3 = (hands: RecordingV3Hand[]): Pick<FrameData, 'landmarks' | 'leftHand' | 'rightHand'> => {
    const out: Pick<FrameData, 'landmarks' | 'leftHand' | 'rightHand'> = {};

    const fullHands = hands.filter((h) => !h.partial && h.landmarks);
    if (fullHands.length > 0) {
        const ordered = [...fullHands].sort((a, b) => (a.side === 'right' ? 0 : 1) - (b.side === 'right' ? 0 : 1));
        out.landmarks = ordered.map((h) => h.landmarks!.map(([x, y, z]) => ({ x, y, z })));
    }

    for (const hand of hands) {
        if (!hand.partial || !hand.world) continue;
        const point = hand.world[PARTIAL_HAND_LANDMARK_INDEX];
        if (!point) continue;
        const v = new Vector3(point[0], point[1], point[2]);
        if (hand.side === 'left') out.leftHand = v;
        else out.rightHand = v;
    }

    return out;
};

const extractFaceFromV3 = (face: RecordingV3Face | null): Pick<FrameData, 'faceLandmarks' | 'blendshapes'> => {
    if (!face) return {};
    const out: Pick<FrameData, 'faceLandmarks' | 'blendshapes'> = {};
    if (face.landmarks) out.faceLandmarks = face.landmarks.map(([x, y, z]) => ({ x, y, z }));
    if (face.blendshapes) out.blendshapes = face.blendshapes;
    return out;
};

/** Inverse of buildEnvelope: a v3 file's frames[] back to FrameData[], so
 * loadData has one code path regardless of which version was on disk. */
const extractFramesFromV3 = (frames: RecordingV3Frame[]): FrameData[] =>
    frames.map((frame) => ({
        timestamp: frame.t,
        ...extractHandsFromV3(frame.hands),
        ...extractFaceFromV3(frame.face),
    }));

/** v2 "2.0" files: frames already match FrameData's field names one to one
 * (that format IS bufferRef.current run through JSON.stringify). The only
 * real work is reconstructing Vector3 instances from the plain {x,y,z}
 * objects JSON.parse hands back, since MotionRecorder.tsx's playback path
 * calls frame.leftHand.clone()-style THREE methods. */
const migrateV2Full = (frames: any[]): FrameData[] =>
    frames.map((f) => {
        const out: FrameData = { timestamp: f.timestamp ?? 0 };
        const left = vectorOrNull(f.leftHand);
        const right = vectorOrNull(f.rightHand);
        if (f.leftHand !== undefined) out.leftHand = left;
        if (f.rightHand !== undefined) out.rightHand = right;
        if (f.landmarks) out.landmarks = f.landmarks;
        if (f.faceLandmarks) out.faceLandmarks = f.faceLandmarks;
        if (f.blendshapes) out.blendshapes = f.blendshapes;
        return out;
    });

/** v2 "2.0-kinematics" files: same fields, renamed (timestampMs ->
 * timestamp, handLandmarks -> landmarks) per the shape useRecorder.ts's
 * current exportData('kinematics') writes. */
const migrateV2Kinematics = (frames: any[]): FrameData[] =>
    frames.map((f) => {
        const out: FrameData = { timestamp: f.timestampMs ?? 0 };
        const left = vectorOrNull(f.leftHand);
        const right = vectorOrNull(f.rightHand);
        if (f.leftHand !== undefined) out.leftHand = left;
        if (f.rightHand !== undefined) out.rightHand = right;
        if (f.handLandmarks) out.landmarks = f.handLandmarks;
        if (f.faceLandmarks) out.faceLandmarks = f.faceLandmarks;
        if (f.blendshapes) out.blendshapes = f.blendshapes;
        return out;
    });

/** Splits a "data:<mime>;base64,<payload>" URL into its parts, or null if it
 * is not a base64 data URL. Used at the export/import boundary so audio sits
 * in the v3 envelope as { mimeType, base64 } (matching the TDD schema, and
 * what tools/blender_import_recording.py in Task 3 reads), while the app's
 * own audio refs keep storing a data URL exactly as before. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
    // mimeType itself can contain ";" (e.g. "audio/webm;codecs=opus"), so
    // match greedily up to the LAST ";base64," marker, not the first ";".
    const match = /^data:(.+);base64,([\s\S]*)$/.exec(dataUrl);
    if (!match) return null;
    return { mimeType: match[1], base64: match[2] };
}

export function toDataUrl(mimeType: string, base64: string): string {
    return `data:${mimeType};base64,${base64}`;
}

/** Best-effort recording type for loadData's "you're about to load a
 * different mode" confirm dialog: v2 files carry `type` directly; v3 files
 * carry `channels` instead. */
export function detectTrackingType(json: unknown): TrackingType | undefined {
    if (!isRecord(json)) return undefined;
    if (json.type === 'HAND' || json.type === 'FACE') return json.type;
    if (Array.isArray(json.channels)) {
        if (json.channels.includes('face')) return 'FACE';
        if (json.channels.includes('hands')) return 'HAND';
    }
    return undefined;
}

export function migrateV2(json: unknown): FrameData[] {
    if (!isRecord(json) || !Array.isArray(json.frames)) return [];

    if (json.schema === 'puppeteer-lab/recording') {
        return extractFramesFromV3(json.frames as RecordingV3Frame[]);
    }
    if (json.version === '2.0-kinematics') {
        return migrateV2Kinematics(json.frames);
    }
    if (json.version === '2.0') {
        return migrateV2Full(json.frames);
    }

    // Unknown shape: best-effort passthrough, matching "migrateV2-or-passthrough".
    return json.frames as FrameData[];
}
