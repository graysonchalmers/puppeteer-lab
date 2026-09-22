/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure tests for the v3 recording envelope: build, serialize, fps
 * measurement, and migrateV2 (both legacy v2 field patterns and the v3-in
 * inverse path). No DOM, no Worker: everything here is plain data in, plain
 * data out, matching TDD-002 P1's synchronous scope.
 */
import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { buildEnvelope, buildKinematics, serializeV3, serializeV3Chunked, migrateV2, parseDataUrl, toDataUrl, detectTrackingType, channelsFor } from './recordingSchema';
import { FrameData } from '../../types';

// --- fixtures ---

const landmark = (x: number, y: number, z: number) => ({ x, y, z });

/** 21 deterministic points; offset shifts a whole hand so two hands differ. */
const handLandmarks = (offset: number) =>
  Array.from({ length: 21 }, (_, i) => landmark(0.1 + i * 0.01 + offset, 0.2 + i * 0.01 + offset, -0.01 * i));

describe('buildEnvelope + serializeV3', () => {
  it('round-trips a synthetic 2-hand frame within rounding tolerance (4 dp normalized, 3 dp world)', () => {
    const frame: FrameData = {
      timestamp: 0,
      landmarks: [handLandmarks(0), handLandmarks(0.3)],
    };
    const envelope = buildEnvelope([frame], 'HAND', { durationMs: 0 });
    const json = serializeV3(envelope);
    const parsed = JSON.parse(json);

    // Serializing then parsing must not lose or shift any value: buildEnvelope
    // rounds once, so the JSON round trip should be exact.
    expect(parsed).toEqual(envelope);

    expect(parsed.frames[0].hands).toHaveLength(2);
    expect(parsed.frames[0].hands[0].side).toBe('right');
    expect(parsed.frames[0].hands[1].side).toBe('left');

    const rawHand0 = handLandmarks(0);
    for (let i = 0; i < 21; i++) {
      const [x, y, z] = parsed.frames[0].hands[0].landmarks[i];
      expect(x).toBeCloseTo(rawHand0[i].x, 4);
      expect(y).toBeCloseTo(rawHand0[i].y, 4);
      expect(z).toBeCloseTo(rawHand0[i].z, 4);

      const world = parsed.frames[0].hands[0].world[i];
      expect(world).not.toBeNull();
      const [wx, wy, wz] = world;
      expect(typeof wx).toBe('number');
      expect(typeof wy).toBe('number');
      expect(typeof wz).toBe('number');
    }
  });

  it('stamps schema, version, source, capture, world metadata, and channels', () => {
    const envelope = buildEnvelope([{ timestamp: 0 }], 'HAND', { durationMs: 0, video: { width: 640, height: 480 } });
    expect(envelope.schema).toBe('puppeteer-lab/recording');
    expect(envelope.version).toBe(3);
    expect(envelope.channels).toEqual(['hands']);
    expect(envelope.capture.video).toEqual({ width: 640, height: 480 });
    expect(envelope.world).toEqual({ mapping: 'mapHandToWorld@1', xRange: 5, yRange: 3.5, yOffset: 0.8, zScale: 8 });
    expect(typeof envelope.source.commit).toBe('string');
    expect(envelope.audio).toBeNull();
  });

  it('maps a Motion Recorder frame (leftHand/rightHand only, no landmarks) to a partial hand at world[8]', () => {
    const frame: FrameData = { timestamp: 0, leftHand: null, rightHand: new Vector3(1.5, 0.9, -0.2) };
    const envelope = buildEnvelope([frame], 'HAND', { durationMs: 0 });
    const hands = envelope.frames[0].hands;
    expect(hands).toHaveLength(1);
    expect(hands[0].side).toBe('right');
    expect(hands[0].partial).toBe(true);
    expect(hands[0].landmarks).toBeNull();
    expect(hands[0].world).not.toBeNull();
    expect(hands[0].world![8]).toEqual([1.5, 0.9, -0.2]);
    for (let i = 0; i < 21; i++) {
      if (i !== 8) expect(hands[0].world![i]).toBeNull();
    }
  });

  it('ignores leftHand/rightHand when landmarks is present (landmarks is the richer source)', () => {
    const frame: FrameData = {
      timestamp: 0,
      landmarks: [handLandmarks(0)],
      leftHand: new Vector3(9, 9, 9),
      rightHand: new Vector3(9, 9, 9),
    };
    const envelope = buildEnvelope([frame], 'HAND', { durationMs: 0 });
    expect(envelope.frames[0].hands).toHaveLength(1);
    expect(envelope.frames[0].hands[0].partial).toBeFalsy();
  });

  it('maps face frames from faceLandmarks/blendshapes', () => {
    const frame: FrameData = {
      timestamp: 0,
      faceLandmarks: [landmark(0.11111, 0.22222, 0.33333)],
      blendshapes: { jawOpen: 0.5 },
    };
    const envelope = buildEnvelope([frame], 'FACE', { durationMs: 0 });
    expect(envelope.channels).toEqual(['face']);
    expect(envelope.frames[0].face).not.toBeNull();
    expect(envelope.frames[0].face!.landmarks![0]).toEqual([0.1111, 0.2222, 0.3333]);
    expect(envelope.frames[0].face!.blendshapes).toEqual({ jawOpen: 0.5 });
  });
});

describe('capture.fps', () => {
  it('is 59 for 60 frames spanning 1000ms (n frames span n-1 intervals, not n)', () => {
    const frames: FrameData[] = Array.from({ length: 60 }, (_, i) => ({ timestamp: i }));
    const envelope = buildEnvelope(frames, 'HAND', { durationMs: 1000 });
    expect(envelope.capture.fps).toBe(59);
  });

  it('is 0, not NaN or Infinity, for a single-frame take', () => {
    const envelope = buildEnvelope([{ timestamp: 0 }], 'HAND', { durationMs: 0 });
    expect(envelope.capture.fps).toBe(0);
    expect(Number.isFinite(envelope.capture.fps)).toBe(true);
  });

  it('is 0, not Infinity, for a degenerate zero-duration multi-frame take', () => {
    const envelope = buildEnvelope([{ timestamp: 0 }, { timestamp: 0 }], 'HAND', { durationMs: 0 });
    expect(envelope.capture.fps).toBe(0);
    expect(Number.isFinite(envelope.capture.fps)).toBe(true);
  });
});

describe('buildKinematics', () => {
  it('keeps only t, per-hand side+world, and face.blendshapes', () => {
    const frames: FrameData[] = [
      {
        timestamp: 0,
        landmarks: [handLandmarks(0), handLandmarks(0.3)],
        faceLandmarks: [landmark(0.1, 0.2, 0.3)],
        blendshapes: { jawOpen: 0.2 },
      },
    ];
    const kin = buildKinematics(frames, 'HAND', 0);
    expect(kin.schema).toBe('puppeteer-lab/kinematics');
    const f = kin.frames[0];
    expect(f.hands[0]).not.toHaveProperty('landmarks');
    expect(f.hands[0]).not.toHaveProperty('score');
    expect(f.hands[0].side).toBe('right');
    expect(f.hands[0].world).not.toBeNull();
    expect(f.face).toEqual({ blendshapes: { jawOpen: 0.2 } });
  });
});

describe('migrateV2', () => {
  it('maps pattern (a): leftHand/rightHand only, a Motion Recorder "2.0" file', () => {
    const v2 = {
      version: '2.0',
      type: 'HAND',
      date: new Date().toISOString(),
      duration: 0.016,
      frames: [
        { timestamp: 0, leftHand: { x: 1, y: 2, z: 3 }, rightHand: null },
        { timestamp: 16, leftHand: null, rightHand: { x: -1, y: 0.5, z: 0.2 } },
      ],
    };
    const frames = migrateV2(v2);
    expect(frames).toHaveLength(2);
    expect(frames[0].leftHand).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(frames[0].rightHand).toBeNull();
    expect(frames[1].rightHand).toMatchObject({ x: -1, y: 0.5, z: 0.2 });
  });

  it('maps pattern (b): landmarks array with side inferred from array order, a Hand Telemetry "2.0" file', () => {
    const v2 = {
      version: '2.0',
      type: 'HAND',
      date: new Date().toISOString(),
      duration: 0.016,
      frames: [{ timestamp: 0, landmarks: [handLandmarks(0), handLandmarks(0.5)] }],
    };
    const frames = migrateV2(v2);
    expect(frames[0].landmarks).toHaveLength(2);
    expect((frames[0].landmarks as any[])[0][0]).toMatchObject({ x: 0.1, y: 0.2 });
  });

  it('maps pattern (c): faceLandmarks/blendshapes, a Face Puppet "2.0" file', () => {
    const v2 = {
      version: '2.0',
      type: 'FACE',
      date: new Date().toISOString(),
      duration: 0.016,
      frames: [{ timestamp: 0, faceLandmarks: [landmark(0.1, 0.2, 0.3)], blendshapes: { jawOpen: 0.5 } }],
    };
    const frames = migrateV2(v2);
    expect(frames[0].faceLandmarks).toEqual([{ x: 0.1, y: 0.2, z: 0.3 }]);
    expect(frames[0].blendshapes).toEqual({ jawOpen: 0.5 });
  });

  it('maps a "2.0-kinematics" file, renaming timestampMs back to timestamp and handLandmarks back to landmarks', () => {
    const v2k = {
      version: '2.0-kinematics',
      type: 'HAND',
      date: new Date().toISOString(),
      fps: 60,
      frameCount: 1,
      durationSeconds: 0,
      frames: [
        {
          timestampMs: 33,
          leftHand: { x: 1, y: 1, z: 1 },
          rightHand: null,
          handLandmarks: [handLandmarks(0)],
        },
      ],
    };
    const frames = migrateV2(v2k);
    expect(frames[0].timestamp).toBe(33);
    expect(frames[0].landmarks).toHaveLength(1);
    expect(frames[0].leftHand).toMatchObject({ x: 1, y: 1, z: 1 });
  });

  it('loads a real v2 full-export fixture (matching todays RecordingSession) into frames the existing playback readers can consume', () => {
    const fixture = {
      version: '2.0',
      type: 'HAND',
      date: new Date().toISOString(),
      duration: 0.032,
      frames: [
        { timestamp: 0, leftHand: { x: -1.2, y: 1.1, z: 0 }, rightHand: { x: 1.2, y: 1.1, z: 0 } },
        { timestamp: 16, landmarks: [handLandmarks(0)] },
      ],
      hasAudio: false,
    };
    const frames = migrateV2(fixture);
    expect(frames).toHaveLength(2);
    // MotionRecorder.tsx playback reads frame.leftHand / frame.rightHand directly.
    expect(frames[0].leftHand).toMatchObject({ x: -1.2, y: 1.1, z: 0 });
    expect(frames[0].rightHand).toMatchObject({ x: 1.2, y: 1.1, z: 0 });
    // HandTelemetry.tsx playback reads frame.landmarks directly.
    expect(frames[1].landmarks).toHaveLength(1);
  });

  it('treats a face v2 file the same way, preserving faceLandmarks/blendshapes for FaceDemo.tsx playback', () => {
    const fixture = {
      version: '2.0',
      type: 'FACE',
      date: new Date().toISOString(),
      duration: 0.016,
      frames: [{ timestamp: 0, faceLandmarks: [landmark(0.4, 0.5, 0.6)], blendshapes: { mouthSmile: 0.9 } }],
    };
    const frames = migrateV2(fixture);
    expect(frames[0].faceLandmarks).toEqual([{ x: 0.4, y: 0.5, z: 0.6 }]);
    expect(frames[0].blendshapes).toEqual({ mouthSmile: 0.9 });
  });

  it('treats schema "puppeteer-lab/recording" as v3-in and inverts it back to FrameData[] (the same code path as v2)', () => {
    const frames: FrameData[] = [
      { timestamp: 0, landmarks: [handLandmarks(0)] },
      { timestamp: 16, rightHand: new Vector3(2, 1, 0.5), leftHand: null },
      { timestamp: 32, faceLandmarks: [landmark(0.1, 0.2, 0.3)], blendshapes: { jawOpen: 0.4 } },
    ];
    const envelope = buildEnvelope(frames, 'HAND', { durationMs: 32 });

    const roundTripped = migrateV2(envelope);
    expect(roundTripped).toHaveLength(3);

    expect(roundTripped[0].landmarks).toHaveLength(1);
    const lm0 = (roundTripped[0].landmarks as any[])[0][0];
    expect(lm0.x).toBeCloseTo(handLandmarks(0)[0].x, 4);

    expect(roundTripped[1].rightHand).not.toBeNull();
    expect(roundTripped[1].rightHand!.x).toBeCloseTo(2, 3);
    expect(roundTripped[1].rightHand!.y).toBeCloseTo(1, 3);
    expect(roundTripped[1].rightHand!.z).toBeCloseTo(0.5, 3);
    expect(roundTripped[1].leftHand).toBeFalsy();

    expect(roundTripped[2].faceLandmarks![0]).toMatchObject({ x: 0.1, y: 0.2, z: 0.3 });
    expect(roundTripped[2].blendshapes).toEqual({ jawOpen: 0.4 });
  });

  it('passes an unrecognized shape through as already-FrameData[] rather than throwing', () => {
    const alreadyFrameData = { frames: [{ timestamp: 0, leftHand: null, rightHand: null }] };
    const frames = migrateV2(alreadyFrameData);
    expect(frames).toEqual(alreadyFrameData.frames);
  });
});

describe('parseDataUrl / toDataUrl', () => {
  it('splits a data URL into mimeType and base64 payload, and rebuilds it', () => {
    const dataUrl = 'data:audio/webm;codecs=opus;base64,AAECAw==';
    const parsed = parseDataUrl(dataUrl);
    expect(parsed).toEqual({ mimeType: 'audio/webm;codecs=opus', base64: 'AAECAw==' });
    expect(toDataUrl(parsed!.mimeType, parsed!.base64)).toBe(dataUrl);
  });

  it('returns null for a non-data-URL string', () => {
    expect(parseDataUrl('blob:http://localhost/abc-123')).toBeNull();
  });
});

describe('detectTrackingType', () => {
  it('reads type directly from a v2 file', () => {
    expect(detectTrackingType({ type: 'HAND' })).toBe('HAND');
    expect(detectTrackingType({ type: 'FACE' })).toBe('FACE');
  });

  it('derives type from channels on a v3 file', () => {
    expect(detectTrackingType({ channels: ['hands'] })).toBe('HAND');
    expect(detectTrackingType({ channels: ['face'] })).toBe('FACE');
  });

  it('returns undefined for an unrecognized shape', () => {
    expect(detectTrackingType({})).toBeUndefined();
    expect(detectTrackingType(null)).toBeUndefined();
  });
});

describe('channelsFor', () => {
  const faceFrame = { timestamp: 0, faceLandmarks: [{ x: 0.5, y: 0.5, z: 0 }], blendshapes: {} };
  const hand21 = Array.from({ length: 21 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.5, z: 0 }));

  it('HAND takes stay hands', () => {
    expect(channelsFor([{ timestamp: 0 }], 'HAND')).toEqual(['hands']);
  });
  it('FACE takes without hands stay face-only', () => {
    expect(channelsFor([faceFrame], 'FACE')).toEqual(['face']);
  });
  it('FACE takes with hands in any frame carry both', () => {
    expect(channelsFor([faceFrame, { ...faceFrame, timestamp: 33, landmarks: [hand21] }], 'FACE')).toEqual(['face', 'hands']);
  });
  it('a face+hands take round-trips through v3 with its hand', () => {
    const frames = [{ ...faceFrame, landmarks: [hand21] }];
    const json = JSON.parse(serializeV3(buildEnvelope(frames, 'FACE', { durationMs: 0 })));
    expect(json.channels).toEqual(['face', 'hands']);
    expect(detectTrackingType(json)).toBe('FACE');
    const back = migrateV2(json);
    expect(back[0].landmarks).toHaveLength(1);
    expect(back[0].landmarks![0]).toHaveLength(21);
    expect(back[0].faceLandmarks).toHaveLength(1);
  });
});

describe('performance (TDD-002 P1 gate)', () => {
  it('builds and serializes a synthetic 30s hand take (~1800 frames x 2 hands x 21 landmarks) in under 100ms', () => {
    const frameCount = 1800;
    const frames: FrameData[] = new Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      frames[i] = {
        timestamp: (i * 1000) / 60,
        landmarks: [handLandmarks(0), handLandmarks(0.3)],
      };
    }

    const start = performance.now();
    const envelope = buildEnvelope(frames, 'HAND', { durationMs: (frameCount * 1000) / 60 });
    const json = serializeV3(envelope);
    const elapsed = performance.now() - start;

    expect(json.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('serializeV3Chunked (TDD-002 P2 fallback)', () => {
  // createdAt is `new Date().toISOString()` per call, so a byte/deep compare
  // against a synchronously-built envelope must exclude it or the assertion
  // flakes on whichever millisecond the two calls happen to land on.
  const stripCreatedAt = (obj: any) => {
    const { createdAt, ...rest } = obj;
    return rest;
  };

  it('matches buildEnvelope + serializeV3 for a small full export, ignoring createdAt', async () => {
    const frames: FrameData[] = [
      { timestamp: 0, landmarks: [handLandmarks(0), handLandmarks(0.3)] },
      { timestamp: 16, landmarks: [handLandmarks(0), handLandmarks(0.3)] },
    ];
    const sync = JSON.parse(serializeV3(buildEnvelope(frames, 'HAND', { durationMs: 16 })));
    const chunked = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'full', { durationMs: 16 }));
    expect(stripCreatedAt(chunked)).toEqual(stripCreatedAt(sync));
  });

  it('matches buildKinematics + serializeV3 for a small kinematics export, ignoring createdAt', async () => {
    const frames: FrameData[] = [{ timestamp: 0, landmarks: [handLandmarks(0)] }];
    const sync = JSON.parse(serializeV3(buildKinematics(frames, 'HAND', 0)));
    const chunked = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'kinematics', { durationMs: 0 }));
    expect(stripCreatedAt(chunked)).toEqual(stripCreatedAt(sync));
  });

  it('attaches audio to a full export but a kinematics export never carries an audio field', async () => {
    const frames: FrameData[] = [{ timestamp: 0, landmarks: [handLandmarks(0)] }];
    const audio = { mimeType: 'audio/webm', base64: 'AAECAw==' };

    const full = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'full', { durationMs: 0, audio }));
    expect(full.audio).toEqual(audio);

    const kinematics = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'kinematics', { durationMs: 0, audio }));
    expect(kinematics.audio).toBeUndefined();
  });

  it('a full export with no audio serializes audio: null, matching buildEnvelope', async () => {
    const frames: FrameData[] = [{ timestamp: 0, landmarks: [handLandmarks(0)] }];
    const chunked = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'full', { durationMs: 0 }));
    expect(chunked.audio).toBeNull();
  });

  it('computes capture.fps/frameCount against the WHOLE take, not a chunk slice, at the 500-frame chunk boundary', async () => {
    const frameCount = 500;
    const frames: FrameData[] = Array.from({ length: frameCount }, (_, i) => ({ timestamp: (i * 1000) / 60 }));
    const durationMs = frames[frameCount - 1].timestamp;
    const expected = buildEnvelope(frames, 'HAND', { durationMs });

    const chunked = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'full', { durationMs }));
    expect(chunked.capture.frameCount).toBe(frameCount);
    expect(chunked.capture.fps).toBe(expected.capture.fps);
  });

  it('computes capture.fps/frameCount correctly across TWO chunk boundaries (1200 frames)', async () => {
    const frameCount = 1200;
    const frames: FrameData[] = Array.from({ length: frameCount }, (_, i) => ({ timestamp: (i * 1000) / 60 }));
    const durationMs = frames[frameCount - 1].timestamp;
    const expected = buildKinematics(frames, 'HAND', durationMs);

    const chunked = JSON.parse(await serializeV3Chunked(frames, 'HAND', 'kinematics', { durationMs }));
    expect(chunked.capture.frameCount).toBe(frameCount);
    expect(chunked.capture.fps).toBe(expected.capture.fps);
    expect(chunked.frames).toHaveLength(frameCount);
  });

  it('yields via setTimeout(0) every 500 frames - two yields for 1200 frames, none for a stub', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const frames: FrameData[] = Array.from({ length: 1200 }, (_, i) => ({ timestamp: i }));
    await serializeV3Chunked(frames, 'HAND', 'full', { durationMs: 1200 });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    setTimeoutSpy.mockRestore();
  });

  it('handles 0 frames without yielding and without NaN/Infinity fps', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const json = await serializeV3Chunked([], 'HAND', 'full', { durationMs: 0 });
    const parsed = JSON.parse(json);
    expect(parsed.capture.frameCount).toBe(0);
    expect(parsed.capture.fps).toBe(0);
    expect(Number.isFinite(parsed.capture.fps)).toBe(true);
    expect(parsed.frames).toEqual([]);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});
