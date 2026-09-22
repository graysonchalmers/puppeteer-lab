/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { shouldPause, IDLE_MS } from './idle';

describe('shouldPause', () => {
  it('pauses a running tracker after IDLE_MS without activity', () => {
    expect(shouldPause(IDLE_MS, 0, 1, 0)).toBe(true);
    expect(shouldPause(IDLE_MS - 1, 0, 1, 0)).toBe(false);
  });

  it('never pauses with no tracker running (the hub) or while held (recording, export)', () => {
    expect(shouldPause(IDLE_MS * 10, 0, 0, 0)).toBe(false);
    expect(shouldPause(IDLE_MS * 10, 0, 1, 1)).toBe(false);
  });
});
