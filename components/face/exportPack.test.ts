/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { pickVideoMime, takeStamp, buildPackZip, VIDEO_MIME_CANDIDATES } from './exportPack';

describe('pickVideoMime', () => {
  it('prefers mp4 with codecs, then mp4, then webm', () => {
    expect(pickVideoMime(() => true)).toBe('video/mp4;codecs=avc1,mp4a');
    expect(pickVideoMime((m) => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickVideoMime((m) => m === 'video/webm')).toBe('video/webm');
    expect(VIDEO_MIME_CANDIDATES[0]).toBe('video/mp4;codecs=avc1,mp4a');
  });
  it('returns null when nothing is supported', () => {
    expect(pickVideoMime(() => false)).toBeNull();
  });
});

describe('takeStamp', () => {
  it('formats local time as YYYYMMDD-HHMMSS', () => {
    expect(takeStamp(new Date(2026, 8, 22, 7, 5, 9))).toBe('20260922-070509');
  });
});

describe('buildPackZip', () => {
  const video = { blob: new Blob([new Uint8Array([1, 2, 3])]), mimeType: 'video/webm;codecs=vp9,opus' };
  const recordingJson = new Blob(['{"schema":"puppeteer-lab/recording"}']);

  it('contains video, recording.json and audio', async () => {
    const audio = { blob: new Blob([new Uint8Array([9, 9])]), mimeType: 'audio/webm;codecs=opus' };
    const files = unzipSync(await buildPackZip({ video, recordingJson, audio }));
    expect(Object.keys(files).sort()).toEqual(['audio.webm', 'puppet.webm', 'recording.json']);
    expect(Array.from(files['puppet.webm'])).toEqual([1, 2, 3]);
    expect(strFromU8(files['recording.json'])).toContain('puppeteer-lab/recording');
  });

  it('omits audio when the take has none', async () => {
    const files = unzipSync(await buildPackZip({ video, recordingJson, audio: null }));
    expect(Object.keys(files).sort()).toEqual(['puppet.webm', 'recording.json']);
  });
});
