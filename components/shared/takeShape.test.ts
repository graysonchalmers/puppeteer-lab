import { describe, it, expect } from 'vitest';
import { takeShape } from './takeShape';

const v3 = (over: Record<string, unknown> = {}) => ({
  schema: 'puppeteer-lab/recording',
  version: 3,
  capture: { fps: 30, durationMs: 200, frameCount: 3, video: { width: 1280, height: 720 } },
  channels: ['face'],
  frames: [
    { t: 0, hands: [], face: { landmarks: [[0.5, 0.5, 0]], blendshapes: { jawOpen: 0.2 } } },
    { t: 100, hands: [], face: null },
    { t: 200, hands: [], face: null },
  ],
  audio: null,
  ...over,
});

describe('takeShape', () => {
  it('reads frames, duration and the camera aspect', () => {
    const s = takeShape(v3());
    expect(s.frames).toHaveLength(3);
    expect(s.durationMs).toBe(200);
    expect(s.aspect).toBeCloseTo(1280 / 720);
    expect(s.hasAudio).toBe(false);
    expect(s.audioDataUrl).toBeNull();
  });

  it('builds a data URL for the audio', () => {
    const s = takeShape(v3({ audio: { mimeType: 'audio/webm;codecs=opus', base64: 'QUJD', offsetMs: 12 } }));
    expect(s.hasAudio).toBe(true);
    expect(s.audioDataUrl).toBe('data:audio/webm;codecs=opus;base64,QUJD');
  });

  it('falls back to 4:3 when the take has no camera size', () => {
    expect(takeShape(v3({ capture: { durationMs: 200 } })).aspect).toBeCloseTo(4 / 3);
  });

  it('handles hands-only frames (face null) and a one-frame take', () => {
    const s = takeShape(v3({ capture: { durationMs: 0 }, frames: [{ t: 0, hands: [], face: null }] }));
    expect(s.frames).toHaveLength(1);
    expect(s.durationMs).toBe(0);
  });

  it('returns no frames for junk instead of throwing', () => {
    expect(takeShape(null).frames).toEqual([]);
    expect(takeShape({ schema: 'x' }).frames).toEqual([]);
    expect(takeShape(v3({ frames: 'nope' })).frames).toEqual([]);
  });
});
