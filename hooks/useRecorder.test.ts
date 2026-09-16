import { describe, it, expect } from 'vitest';
import { findFrameIndex } from './useRecorder';

const frames = [{ timestamp: 16 }, { timestamp: 32 }, { timestamp: 50 }, { timestamp: 66 }];

describe('findFrameIndex', () => {
  it('before first returns 0', () => expect(findFrameIndex(frames, 0)).toBe(0));
  it('exact match returns that index', () => expect(findFrameIndex(frames, 50)).toBe(2));
  it('between returns the last frame at or before t', () => expect(findFrameIndex(frames, 40)).toBe(1));
  it('after last returns last index', () => expect(findFrameIndex(frames, 999)).toBe(3));
  it('empty returns 0', () => expect(findFrameIndex([], 10)).toBe(0));
});
