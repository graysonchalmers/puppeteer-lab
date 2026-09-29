import { describe, it, expect } from 'vitest';
import { createFpsMeter } from './fpsMeter';

describe('createFpsMeter', () => {
  it('returns 0 until it has two samples', () => {
    const m = createFpsMeter();
    expect(m.tick(0)).toBe(0);
  });
  it('reads ~30 fps for 33.3 ms frames', () => {
    const m = createFpsMeter();
    let fps = 0;
    for (let i = 0; i < 120; i++) fps = m.tick(i * (1000 / 30));
    expect(fps).toBeCloseTo(30, 0);
  });
  it('reads ~60 fps for 16.7 ms frames', () => {
    const m = createFpsMeter();
    let fps = 0;
    for (let i = 0; i < 240; i++) fps = m.tick(i * (1000 / 60));
    expect(fps).toBeCloseTo(60, 0);
  });
  it('forgets frames older than the window', () => {
    const m = createFpsMeter(1000);
    for (let i = 0; i < 60; i++) m.tick(i * 16.7);
    const after = m.tick(10_000); // long stall
    expect(after).toBe(0);
  });
});
