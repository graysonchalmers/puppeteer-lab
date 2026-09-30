import { describe, it, expect } from 'vitest';
import { createDailyLimiter } from './rateLimit.mjs';

describe('createDailyLimiter', () => {
  it('allows up to max per key, then reports when to retry', () => {
    let t = 1000;
    const l = createDailyLimiter({ max: 2, windowMs: 10_000, now: () => t });
    expect(l.take('a')).toEqual({ ok: true });
    expect(l.take('a')).toEqual({ ok: true });
    t = 4000;
    expect(l.take('a')).toEqual({ ok: false, retryAfterMs: 7000 });
    expect(l.take('b')).toEqual({ ok: true });
  });

  it('starts a fresh window once the old one has elapsed', () => {
    let t = 0;
    const l = createDailyLimiter({ max: 1, windowMs: 10_000, now: () => t });
    l.take('a');
    expect(l.take('a').ok).toBe(false);
    t = 10_000;
    expect(l.take('a')).toEqual({ ok: true });
  });
});
