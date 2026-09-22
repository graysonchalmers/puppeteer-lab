/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { extensionForMime } from './download';

describe('extensionForMime', () => {
  it('maps video and audio types', () => {
    expect(extensionForMime('video/mp4;codecs=avc1,mp4a')).toBe('mp4');
    expect(extensionForMime('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('application/x-unknown')).toBe('bin');
  });
});
