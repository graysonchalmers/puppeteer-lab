import { describe, it, expect } from 'vitest';
import { validateTake } from './validate.mjs';

const take = (over = {}) => ({
  schema: 'puppeteer-lab/recording',
  version: 3,
  capture: { fps: 30, durationMs: 100, frameCount: 2 },
  channels: ['face'],
  frames: [{ t: 0, hands: [], face: null }, { t: 100, hands: [], face: null }],
  audio: null,
  ...over,
});

describe('validateTake', () => {
  it('accepts a v3 recording and summarises it', () => {
    expect(validateTake(take())).toEqual({ ok: true, summary: { frames: 2, durationMs: 100, hasAudio: false, channels: ['face'] } });
  });

  it('accepts audio and reports it', () => {
    const r = validateTake(take({ audio: { mimeType: 'audio/webm', base64: 'AAAA', offsetMs: 5 } }));
    expect(r.ok && r.summary.hasAudio).toBe(true);
  });

  it.each([
    ['not-an-object', 'nope'],
    ['not-an-object', null],
    ['not-an-object', [1]],
    ['wrong-schema', take({ schema: 'puppeteer-lab/kinematics' })],
    ['wrong-version', take({ version: 2 })],
    ['no-frames', take({ frames: [] })],
    ['no-frames', take({ frames: 'x' })],
    ['bad-frame', take({ frames: [{ t: 0, hands: [], face: null }, { t: 'x', hands: [] }] })],
    ['bad-frame', take({ frames: [{ t: 0, hands: {} }] })],
    ['bad-frame', take({ frames: [null] })],
    ['bad-capture', take({ capture: null })],
    ['bad-capture', take({ capture: { durationMs: 'x' } })],
    ['bad-audio', take({ audio: { mimeType: 'video/mp4', base64: 'AAAA' } })],
    ['bad-audio', take({ audio: { mimeType: 'audio/webm' } })],
    ['bad-audio', take({ audio: 'x' })],
  ])('rejects %s', (reason, input) => {
    expect(validateTake(input)).toEqual({ ok: false, reason });
  });

  it('rejects an absurd frame count', () => {
    const frames = Array.from({ length: 200_001 }, (_, i) => ({ t: i, hands: [], face: null }));
    expect(validateTake(take({ frames }))).toEqual({ ok: false, reason: 'too-many-frames' });
  });
});
