/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CLEANUP_PREFS, parseCleanupPrefs, serializeCleanupPrefs, reportLabel } from './cleanupPrefs';

describe('parseCleanupPrefs', () => {
  it('defaults to off at strength 0.5', () => {
    expect(DEFAULT_CLEANUP_PREFS).toEqual({ enabled: false, strength: 0.5 });
    expect(parseCleanupPrefs(null)).toEqual(DEFAULT_CLEANUP_PREFS);
  });
  it('survives garbage', () => {
    expect(parseCleanupPrefs('not json')).toEqual(DEFAULT_CLEANUP_PREFS);
    expect(parseCleanupPrefs('42')).toEqual(DEFAULT_CLEANUP_PREFS);
    expect(parseCleanupPrefs('{"enabled":"yes","strength":"high"}')).toEqual(DEFAULT_CLEANUP_PREFS);
  });
  it('clamps strength to 0..1', () => {
    expect(parseCleanupPrefs('{"enabled":true,"strength":7}')).toEqual({ enabled: true, strength: 1 });
    expect(parseCleanupPrefs('{"enabled":true,"strength":-3}')).toEqual({ enabled: true, strength: 0 });
  });
  it('round-trips', () => {
    const p = { enabled: true, strength: 0.25 };
    expect(parseCleanupPrefs(serializeCleanupPrefs(p))).toEqual(p);
  });
});

describe('reportLabel', () => {
  it('is empty without a report', () => expect(reportLabel(null)).toBe(''));
  it('says so when the take is too long', () =>
    expect(reportLabel({ gapsFilled: 0, gapsLeft: 0, filledMs: 0, skipped: true })).toBe('Take too long to clean up'));
  it('says so when there is nothing to fill', () =>
    expect(reportLabel({ gapsFilled: 0, gapsLeft: 0, filledMs: 0 })).toBe('No gaps to fill'));
  it('pluralises and rounds seconds to one decimal', () => {
    expect(reportLabel({ gapsFilled: 1, gapsLeft: 0, filledMs: 200 })).toBe('Filled 1 gap (0.2 s)');
    expect(reportLabel({ gapsFilled: 3, gapsLeft: 0, filledMs: 400 })).toBe('Filled 3 gaps (0.4 s)');
  });
  it('mentions gaps that were too long to fill', () => {
    expect(reportLabel({ gapsFilled: 1, gapsLeft: 2, filledMs: 200 })).toBe('Filled 1 gap (0.2 s) · 2 too long to fill');
    expect(reportLabel({ gapsFilled: 0, gapsLeft: 1, filledMs: 0 })).toBe('1 too long to fill');
  });
});
