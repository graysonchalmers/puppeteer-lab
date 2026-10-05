/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { parseFacePrefs, DEFAULT_FACE_PREFS } from './facePrefs';

describe('parseFacePrefs', () => {
  it('returns the defaults for nothing stored or corrupt JSON', () => {
    expect(parseFacePrefs(null)).toEqual(DEFAULT_FACE_PREFS);
    expect(parseFacePrefs('{nope')).toEqual(DEFAULT_FACE_PREFS);
  });
  it('keeps valid fields, clamps to 0..1, defaults the rest', () => {
    expect(parseFacePrefs(JSON.stringify({ jawBoost: 0.4, browBoost: 3, blinkBoost: 'x' }))).toEqual({
      ...DEFAULT_FACE_PREFS, jawBoost: 0.4, browBoost: 1,
    });
  });
});
