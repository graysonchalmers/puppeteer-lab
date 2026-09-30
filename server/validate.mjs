// Structural check of an uploaded take: enough that the viewer and the archive never see junk.
const MAX_FRAMES = 200_000;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateTake(json) {
  if (!isObj(json)) return { ok: false, reason: 'not-an-object' };
  if (json.schema !== 'puppeteer-lab/recording') return { ok: false, reason: 'wrong-schema' };
  if (json.version !== 3) return { ok: false, reason: 'wrong-version' };
  if (!Array.isArray(json.frames) || json.frames.length === 0) return { ok: false, reason: 'no-frames' };
  if (json.frames.length > MAX_FRAMES) return { ok: false, reason: 'too-many-frames' };
  for (const f of json.frames) {
    if (!isObj(f) || typeof f.t !== 'number' || !Array.isArray(f.hands)) return { ok: false, reason: 'bad-frame' };
  }
  if (!isObj(json.capture) || typeof json.capture.durationMs !== 'number') return { ok: false, reason: 'bad-capture' };
  const a = json.audio;
  if (a != null && (!isObj(a) || typeof a.mimeType !== 'string' || !a.mimeType.startsWith('audio/') || typeof a.base64 !== 'string')) {
    return { ok: false, reason: 'bad-audio' };
  }
  return {
    ok: true,
    summary: {
      frames: json.frames.length,
      durationMs: json.capture.durationMs,
      hasAudio: a != null,
      channels: Array.isArray(json.channels) ? json.channels.filter((c) => typeof c === 'string') : [],
    },
  };
}
