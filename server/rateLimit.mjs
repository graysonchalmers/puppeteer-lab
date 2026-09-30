// Fixed-window counter per key, in memory (a restart resets it).
export function createDailyLimiter({ max, windowMs = 24 * 3600_000, now = Date.now }) {
  const hits = new Map(); // key -> { start, count }
  return {
    take(key) {
      const t = now();
      if (hits.size > 5000) for (const [k, h] of hits) if (t - h.start >= windowMs) hits.delete(k);
      let h = hits.get(key);
      if (!h || t - h.start >= windowMs) {
        h = { start: t, count: 0 };
        hits.set(key, h);
      }
      if (h.count >= max) return { ok: false, retryAfterMs: h.start + windowMs - t };
      h.count++;
      return { ok: true };
    },
  };
}
