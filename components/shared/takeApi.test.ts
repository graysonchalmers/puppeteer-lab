import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { fetchTake, fetchUploadConfig, uploadTake, expiresLabel, UploadError, oversizeMessage } from './takeApi';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('uploadTake', () => {
  it('posts the take (gzipped when the browser can) and returns the link', async () => {
    let seen: { headers: Record<string, string>; body: Blob } | null = null;
    const fetchFn = (async (_u: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: init.body as Blob };
      return json(201, { id: 'a'.repeat(22), url: `/t/${'a'.repeat(22)}`, expiresAt: 42 });
    }) as unknown as typeof fetch;
    const original = '{"schema":"x"}';
    const r = await uploadTake(new Blob([original]), fetchFn);
    expect(r).toEqual({ id: 'a'.repeat(22), url: `/t/${'a'.repeat(22)}`, expiresAt: 42 });
    expect(seen!.headers['Content-Type']).toBe('application/json');
    const raw = Buffer.from(await seen!.body.arrayBuffer());
    expect(seen!.headers['Content-Encoding']).toBe('gzip');
    expect(gunzipSync(raw).toString()).toBe(original);
  });

  it.each([
    [503, 'uploads-disabled', 'disabled'],
    [429, 'rate-limited', 'rate-limited'],
    [413, 'too-large', 'too-large'],
    [503, 'storage-full', 'storage-full'],
    [503, 'busy', 'busy'],
    [422, 'invalid-take', 'invalid'],
    [500, 'internal', 'unknown'],
  ])('maps %s %s to %s', async (status, code, kind) => {
    const fetchFn = (async () => json(status, { error: code })) as unknown as typeof fetch;
    const err = await uploadTake(new Blob(['{}']), fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.kind).toBe(kind);
    expect(err.message.length).toBeGreaterThan(10);
  });

  it('turns a thrown fetch into a network error and tolerates a non-JSON error body', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect((await uploadTake(new Blob(['{}']), down).catch((e) => e)).kind).toBe('network');
    const html = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
    expect((await uploadTake(new Blob(['{}']), html).catch((e) => e)).kind).toBe('unknown');
  });
});

describe('busy', () => {
  it('tells the user to retry in a few seconds', async () => {
    const fetchFn = (async () => json(503, { error: 'busy' }, { 'Retry-After': '5' })) as unknown as typeof fetch;
    const err = await uploadTake(new Blob(['{}']), fetchFn).catch((e) => e);
    expect(err.message).toBe('The server is busy. Try again in a few seconds.');
  });
});

describe('oversizeMessage', () => {
  const MB = 1024 * 1024;
  it('is null at or under the cap and names the rounded limit over it', () => {
    expect(oversizeMessage(50 * MB, 50 * MB)).toBeNull();
    expect(oversizeMessage(10, 50 * MB)).toBeNull();
    expect(oversizeMessage(50 * MB + 1, 50 * MB)).toBe('This take is too long to upload (limit about 50 MB). Use Export to keep it.');
    expect(oversizeMessage(2 * MB, 1.4 * MB)).toBe('This take is too long to upload (limit about 1 MB). Use Export to keep it.');
  });
});

describe('fetchUploadConfig', () => {
  it('returns the config, or null when the API is absent or answers something else', async () => {
    const cfg = { uploadsEnabled: true, contactEmail: 'a@b.c', maxBytes: 5, ttlHours: 24 };
    expect(await fetchUploadConfig((async () => json(200, cfg)) as unknown as typeof fetch)).toEqual(cfg);
    expect(await fetchUploadConfig((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchUploadConfig((async () => json(404, {})) as unknown as typeof fetch)).toBeNull();
    expect(await fetchUploadConfig((async () => { throw new Error('x'); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchUploadConfig((async () => json(200, { nope: 1 })) as unknown as typeof fetch)).toBeNull();
  });
});

describe('fetchTake', () => {
  it('returns the take and its expiry', async () => {
    const iso = '2026-10-01T12:00:00.000Z';
    const r = await fetchTake('a'.repeat(22), (async () => json(200, { schema: 'x' }, { 'X-Expires-At': iso })) as unknown as typeof fetch);
    expect(r).toEqual({ status: 'ok', json: { schema: 'x' }, expiresAt: Date.parse(iso) });
  });

  it('distinguishes expired, missing and broken', async () => {
    const f = (s: number) => (async () => json(s, {})) as unknown as typeof fetch;
    expect(await fetchTake('x', f(410))).toEqual({ status: 'expired' });
    expect(await fetchTake('x', f(404))).toEqual({ status: 'not-found' });
    expect(await fetchTake('x', f(500))).toEqual({ status: 'error' });
    expect(await fetchTake('x', (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toEqual({ status: 'error' });
  });
});

describe('expiresLabel', () => {
  const H = 3_600_000;
  it('rounds up to whole hours and handles the singular and the past', () => {
    expect(expiresLabel(1000 + 24 * H, 1000)).toBe('expires in 24 hours');
    expect(expiresLabel(1000 + 90 * 60_000, 1000)).toBe('expires in 2 hours');
    expect(expiresLabel(1000 + 10 * 60_000, 1000)).toBe('expires in 1 hour');
    expect(expiresLabel(1000, 1000)).toBe('expired');
  });
});
