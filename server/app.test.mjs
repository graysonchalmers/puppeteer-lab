import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';

const TTL = 24 * 3600_000;
const take = (over = {}) => ({
  schema: 'puppeteer-lab/recording',
  version: 3,
  capture: { fps: 30, durationMs: 100, frameCount: 2 },
  channels: ['face'],
  frames: [{ t: 0, hands: [], face: null }, { t: 100, hands: [], face: null }],
  audio: null,
  ...over,
});

let dir, server, base, clock;
async function boot(cfg = {}) {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  clock = { t: 1_700_000_000_000 };
  const now = () => clock.t;
  const config = { port: 0, host: '127.0.0.1', dataDir: dir, maxBytes: 5000, maxPerIpPerDay: 100, linkTtlMs: TTL, quotaBytes: 1e12, adminToken: 'tok', contactEmail: 'me@example.test', ipSalt: 's', maxConcurrentUploads: 2, ...cfg };
  const store = createStore({ dataDir: dir, linkTtlMs: TTL, now });
  server = http.createServer(createApp({ config, store, now }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (body, headers = {}) =>
  fetch(`${base}/api/takes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
// Raw http (not fetch): fetch normalizes paths and transparently inflates gzip, which would hide what the server sent.
const raw = (p, headers = {}) =>
  new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('aborted')));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
const admin = (p, token = 'tok') => fetch(`${base}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('upload', () => {
  it('stores a take and serves the same JSON back', async () => {
    await boot();
    const r = await post(take());
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(j.url).toBe(`/t/${j.id}`);
    expect(j.expiresAt).toBe(clock.t + TTL);
    const got = await fetch(`${base}/api/takes/${j.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('x-expires-at')).toBe(new Date(clock.t + TTL).toISOString());
    expect(await got.json()).toEqual(take());
  });

  it('accepts a gzip-encoded body', async () => {
    await boot();
    const r = await post(gzipSync(Buffer.from(JSON.stringify(take()))), { 'Content-Encoding': 'gzip' });
    expect(r.status).toBe(201);
  });

  it('rejects a gzip bomb that inflates past the cap (413)', async () => {
    await boot({ maxBytes: 1000 });
    const bomb = gzipSync(Buffer.alloc(200_000, 97));
    expect(bomb.length).toBeLessThan(1000);
    const r = await post(bomb, { 'Content-Encoding': 'gzip' });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toBe('too-large');
  });

  it('rejects a body over the cap by Content-Length (413)', async () => {
    await boot({ maxBytes: 1000 });
    const r = await post(JSON.stringify(take({ pad: 'x'.repeat(2000) })));
    expect(r.status).toBe(413);
  });

  it('rejects bad input with the right codes', async () => {
    await boot();
    expect((await post('{nope')).status).toBe(400);
    expect((await post(Buffer.from('not gzip'), { 'Content-Encoding': 'gzip' })).status).toBe(400);
    expect((await post('{}', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post('{}', { 'Content-Encoding': 'br' })).status).toBe(415);
    const bad = await post(take({ schema: 'puppeteer-lab/kinematics' }));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: 'invalid-take', reason: 'wrong-schema' });
  });

  it('refuses uploads while no contact address is configured', async () => {
    await boot({ contactEmail: '' });
    const r = await post(take());
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe('uploads-disabled');
    const cfg = await (await fetch(`${base}/api/config`)).json();
    expect(cfg.uploadsEnabled).toBe(false);
  });

  it('rate-limits per client IP and resets after the window', async () => {
    await boot({ maxPerIpPerDay: 1 });
    const ip = (a) => ({ 'X-Forwarded-For': a });
    expect((await post(take(), ip('1.1.1.1'))).status).toBe(201);
    const limited = await post(take(), ip('1.1.1.1'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await post(take(), ip('2.2.2.2'))).status).toBe(201);
    clock.t += TTL;
    expect((await post(take(), ip('1.1.1.1'))).status).toBe(201);
  });

  it('stops accepting once the storage quota is reached', async () => {
    await boot({ quotaBytes: 10 });
    expect((await post(take())).status).toBe(201);
    const r = await post(take());
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe('storage-full');
  });
});

describe('links', () => {
  it('is live one ms before the TTL and 410 at the TTL, but the file stays and admin can fetch it', async () => {
    await boot();
    const { id } = await (await post(take())).json();
    clock.t += TTL - 1;
    expect((await fetch(`${base}/api/takes/${id}`)).status).toBe(200);
    clock.t += 1;
    const gone = await fetch(`${base}/api/takes/${id}`);
    expect(gone.status).toBe(410);
    expect((await gone.json()).error).toBe('expired');
    await fs.access(path.join(dir, 'takes', `${id}.json.gz`));
    const file = await admin(`/api/admin/takes/${id}/file`);
    expect(file.status).toBe(200);
    expect(await file.json()).toEqual(take());
  });

  it('404s malformed and unknown ids', async () => {
    await boot();
    for (const bad of ['..%2f..%2fetc%2fpasswd', 'short', 'a'.repeat(23), 'a'.repeat(22)]) {
      const r = await fetch(`${base}/api/takes/${bad}`);
      expect(r.status).toBe(404);
    }
  });

  it('download=1 sends an attachment with plain JSON', async () => {
    await boot();
    const { id } = await (await post(take())).json();
    const r = await fetch(`${base}/api/takes/${id}?download=1`);
    expect(r.headers.get('content-disposition')).toBe(`attachment; filename="puppet-take-${id}.json"`);
    expect(await r.json()).toEqual(take());
  });
});

describe('admin', () => {
  it('is invisible without a configured token', async () => {
    await boot({ adminToken: '' });
    expect((await admin('/api/admin/takes')).status).toBe(404);
  });

  it('rejects a wrong or missing token', async () => {
    await boot();
    expect((await admin('/api/admin/takes', 'wrong')).status).toBe(401);
    expect((await admin('/api/admin/takes', null)).status).toBe(401);
  });

  it('lists takes with a hashed IP, audio flag and byte totals', async () => {
    await boot();
    await post(take({ audio: { mimeType: 'audio/webm', base64: 'AAAA' } }), { 'X-Forwarded-For': '9.9.9.9' });
    const text = await (await admin('/api/admin/takes')).text();
    expect(text).not.toContain('9.9.9.9');
    const j = JSON.parse(text);
    expect(j.count).toBe(1);
    expect(j.storedBytes).toBeGreaterThan(0);
    expect(j.takes[0]).toMatchObject({ hasAudio: true, frames: 2, durationMs: 100 });
  });
});

describe('concurrency', () => {
  it('answers 503 busy (Retry-After 5) past the in-flight cap without spending a daily slot, then accepts again', async () => {
    await boot({ maxConcurrentUploads: 2, maxPerIpPerDay: 3 });
    let seen = 0;
    server.on('request', () => { seen++; }); // registered after the app's listener, so the app has taken its slot by now
    const body = Buffer.from(JSON.stringify(take()));
    const held = [0, 1].map(() => {
      const req = http.request(`${base}/api/takes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } });
      const done = new Promise((resolve, reject) => {
        req.on('response', (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
      });
      req.write(body.subarray(0, 10)); // headers + part of the body: the upload is in flight
      return { req, done };
    });
    for (let i = 0; i < 200 && seen < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(seen).toBe(2);
    const busy = await post(take());
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('5');
    expect((await busy.json()).error).toBe('busy');
    for (const h of held) h.req.end(body.subarray(10));
    expect(await Promise.all(held.map((h) => h.done))).toEqual([201, 201]);
    expect((await post(take())).status).toBe(201); // slots released; the busy answer did not use the third daily slot
  });

  it('releases the slot when an upload fails', async () => {
    await boot({ maxConcurrentUploads: 1 });
    expect((await post('{nope')).status).toBe(400);
    expect((await post(take({ schema: 'x' }))).status).toBe(422);
    expect((await post(take())).status).toBe(201);
  });
});

describe('streamed take files', () => {
  it('sends the stored gzip as-is to a client that accepts gzip', async () => {
    await boot();
    const { id } = await (await post(take())).json();
    const r = await raw(`/api/takes/${id}`, { 'Accept-Encoding': 'gzip, deflate' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['vary']).toBe('Accept-Encoding');
    expect(r.headers['x-expires-at']).toBe(new Date(clock.t + TTL).toISOString());
    expect(Number(r.headers['content-length'])).toBe(r.body.length);
    expect(JSON.parse(gunzipSync(r.body).toString())).toEqual(take());
  });

  it('inflates for a client without gzip, and for download=1 even if it accepts gzip', async () => {
    await boot();
    const { id } = await (await post(take())).json();
    const plain = await raw(`/api/takes/${id}`);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(plain.body.toString())).toEqual(take());
    const dl = await raw(`/api/takes/${id}?download=1`, { 'Accept-Encoding': 'gzip' });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-encoding']).toBeUndefined();
    expect(dl.headers['content-length']).toBeUndefined();
    expect(dl.headers['content-type']).toBe('application/json');
    expect(dl.headers['cache-control']).toBe('no-store');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="puppet-take-${id}.json"`);
    expect(JSON.parse(dl.body.toString())).toEqual(take());
  });

  it('streams the admin file as plain JSON', async () => {
    await boot();
    const { id } = await (await post(take())).json();
    const r = await raw(`/api/admin/takes/${id}/file`, { Authorization: 'Bearer tok', 'Accept-Encoding': 'gzip' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.headers['content-disposition']).toBe(`attachment; filename="puppet-take-${id}.json"`);
    expect(JSON.parse(r.body.toString())).toEqual(take());
    expect((await raw(`/api/admin/takes/${'a'.repeat(22)}/file`, { Authorization: 'Bearer tok' })).status).toBe(404);
  });

  it('a corrupt file ends that response but the server keeps serving', async () => {
    await boot();
    const { id } = await (await post(take())).json();
    await fs.writeFile(path.join(dir, 'takes', `${id}.json.gz`), Buffer.alloc(4096, 7));
    const r = await raw(`/api/takes/${id}?download=1`).then((x) => x, () => null);
    expect(r === null || r.status !== 200 || r.body.length === 0).toBe(true);
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
  });
});

describe('misc', () => {
  it('answers 400 bad-request for a target the URL parser rejects', async () => {
    await boot();
    for (const p of ['//', '//[']) {
      const r = await raw(p);
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body.toString()).error).toBe('bad-request');
    }
  });

  it('health, unknown route and wrong method', async () => {
    await boot();
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/takes`)).status).toBe(405);
  });
});
