# Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Face Puppet, one tap saves a take to a small server, returns a 24 h link (copy/share) whose page plays the take back and offers a download, while every saved take is kept forever in a private archive Grayson can pull down.

**Architecture:** A zero-dependency Node 22 HTTP service (`server/`) stores each take as one gzipped file plus a small meta file in a bind-mounted directory; it enforces caps, validates the v3 recording schema, and serves `/api/*`. The existing Vite SPA gains a "Save & get link" component (fetches `/api/config`; hidden when no API answers), a `/t/<id>` viewer route that renders the take with the existing puppet renderer, and a dev/preview proxy for `/api`. Deploy is one Docker container behind Caddy on the existing apps-01 box (Task 7 is a gated checkpoint, never run without Grayson's go-ahead).

**Tech Stack:** Node 22 (`node:http`, `node:zlib`, `node:fs`, `node:crypto`; no npm deps for the server), React 18 + TypeScript + Vite 6 + Vitest 5, Playwright (existing devDependency) for the e2e check, PowerShell 5.1 for the pull script.

**Spec:** `docs/superpowers/specs/2026-09-30-share-links-design.md`

## Global Constraints

- Server: Node 22, **no npm dependencies**, ESM `.mjs` with JSDoc only. Server tests are `server/*.test.mjs` (Task 1 adds them to `vitest.config.ts`).
- **No new npm packages** anywhere (no QR library, no mail SDK in this plan).
- Caps (env-configurable, these are the defaults): `MAX_TAKE_BYTES` = 50 MB (applies to the body and to the decompressed body), `MAX_UPLOADS_PER_IP_DAY` = 30, `LINK_TTL_HOURS` = 24, `QUOTA_MB` = 10240.
- Only `schema: "puppeteer-lab/recording"`, `version: 3` is accepted.
- Take ids: `crypto.randomBytes(16).toString('base64url')` = 22 chars matching `^[A-Za-z0-9_-]{22}$`; anything else is a 404 without touching the filesystem.
- Archive files are **never deleted by the app**. The link stops working after the TTL; the file stays.
- Uploads are refused with 503 `uploads-disabled` while `CONTACT_EMAIL` is unset.
- Client copy must keep the phrase `stay on this device` on the start card (`scripts/phone-check.mjs:281` asserts `/stay on this device/i`).
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Anything handed to Grayson to run is **Windows PowerShell 5.1**: `;` not `&&`, absolute paths. Never print or echo a secret (`ADMIN_TOKEN`, `.env.local` contents, the server IP).
- Do not deploy, edit the server, or register a scheduled task in Tasks 1-6. Task 7 stops for approval.
- Files use the repo's Apache-2.0 header comment where sibling files do (`.ts`/`.tsx`); `.mjs` server files carry a one-line purpose comment.

## Review Focus

Failure modes the spec implies but a straight reading of the tasks would not test. Each has a test in the task named.

1. **Gzip bomb / oversize body** (tiny gzip that inflates past 50 MB, or a `Content-Length` over the cap) must return 413 before the body is held in memory. Task 2.
2. **Link at and after the TTL:** at exactly TTL it is `410 expired` (not 404), the file is still on disk, and the admin endpoint can still fetch it. Task 2.
3. **Path traversal / malformed ids** (`..%2f..%2fetc%2fpasswd`, wrong length, well-formed but missing) return 404 and never reach `fs`. Tasks 1 and 2.
4. **Feature failure paths:** API absent (hide the button), uploads disabled / rate-limited / network down (plain message, Export still works, no crash). Tasks 3 and 4.
5. **Odd takes in the viewer:** no audio, hands-only frames (`face: null`), a take with no `capture.video`, a one-frame take (duration 0) all render without throwing. Task 5.

Also documented, not tested: the client IP comes from `X-Forwarded-For`, trustworthy only because the container port is bound to `127.0.0.1` behind Caddy; the rate limiter is in memory, so a container restart resets counters.

---

### Task 1: Server building blocks (config, validation, rate limiter, store)

**Files:**
- Modify: `vitest.config.ts`
- Create: `server/config.mjs`, `server/config.test.mjs`
- Create: `server/validate.mjs`, `server/validate.test.mjs`
- Create: `server/rateLimit.mjs`, `server/rateLimit.test.mjs`
- Create: `server/store.mjs`, `server/store.test.mjs`

**Interfaces:**
- Produces:
  - `loadConfig(env?: Record<string,string|undefined>) => { port, host, dataDir, maxBytes, maxPerIpPerDay, linkTtlMs, quotaBytes, adminToken, contactEmail, ipSalt }`
  - `validateTake(json: unknown) => { ok: true, summary: { frames: number, durationMs: number, hasAudio: boolean, channels: string[] } } | { ok: false, reason: string }`
  - `createDailyLimiter({ max, windowMs?, now? }) => { take(key: string) => { ok: true } | { ok: false, retryAfterMs: number } }`
  - `ID_RE: RegExp`; `createStore({ dataDir, linkTtlMs, now? }) => { save(jsonBuf: Buffer, summary: object, ipHash: string) => Promise<Meta>, getMeta(id) => Promise<Meta|null>, readGz(id) => Promise<Buffer|null>, list() => Promise<Meta[]>, usedBytes() => Promise<number>, isLive(meta) => boolean }` where `Meta = { id, createdAt, rawBytes, storedBytes, frames, durationMs, hasAudio, channels, ipHash }`.

- [ ] **Step 1: Let vitest see the server tests**

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', 'server/**/*.test.mjs'],
  },
});
```

- [ ] **Step 2: Write the failing tests**

`server/config.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.mjs';

describe('loadConfig', () => {
  it('uses the agreed defaults', () => {
    const c = loadConfig({});
    expect(c.maxBytes).toBe(50 * 1024 * 1024);
    expect(c.maxPerIpPerDay).toBe(30);
    expect(c.linkTtlMs).toBe(24 * 3600_000);
    expect(c.quotaBytes).toBe(10240 * 1024 * 1024);
    expect(c.contactEmail).toBe('');
    expect(c.adminToken).toBe('');
    expect(c.host).toBe('127.0.0.1');
  });

  it('reads overrides', () => {
    const c = loadConfig({ PORT: '9000', MAX_TAKE_BYTES: '1000', MAX_UPLOADS_PER_IP_DAY: '2', LINK_TTL_HOURS: '1', QUOTA_MB: '5', CONTACT_EMAIL: 'a@b.c', ADMIN_TOKEN: 'tok', DATA_DIR: '/d', HOST: '0.0.0.0' });
    expect(c).toMatchObject({ port: 9000, maxBytes: 1000, maxPerIpPerDay: 2, linkTtlMs: 3600_000, quotaBytes: 5 * 1024 * 1024, contactEmail: 'a@b.c', adminToken: 'tok', dataDir: '/d', host: '0.0.0.0' });
  });

  it('falls back to the default for garbage or non-positive numbers', () => {
    const c = loadConfig({ PORT: 'abc', MAX_TAKE_BYTES: '-5', MAX_UPLOADS_PER_IP_DAY: '0' });
    expect(c.port).toBe(8787);
    expect(c.maxBytes).toBe(50 * 1024 * 1024);
    expect(c.maxPerIpPerDay).toBe(30);
  });
});
```

`server/validate.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { validateTake } from './validate.mjs';

const take = (over = {}) => ({
  schema: 'puppeteer-lab/recording',
  version: 3,
  capture: { fps: 30, durationMs: 100, frameCount: 2 },
  channels: ['face'],
  frames: [{ t: 0, hands: [], face: null }, { t: 100, hands: [], face: null }],
  audio: null,
  ...over,
});

describe('validateTake', () => {
  it('accepts a v3 recording and summarises it', () => {
    expect(validateTake(take())).toEqual({ ok: true, summary: { frames: 2, durationMs: 100, hasAudio: false, channels: ['face'] } });
  });

  it('accepts audio and reports it', () => {
    const r = validateTake(take({ audio: { mimeType: 'audio/webm', base64: 'AAAA', offsetMs: 5 } }));
    expect(r.ok && r.summary.hasAudio).toBe(true);
  });

  it.each([
    ['not-an-object', 'nope'],
    ['not-an-object', null],
    ['not-an-object', [1]],
    ['wrong-schema', take({ schema: 'puppeteer-lab/kinematics' })],
    ['wrong-version', take({ version: 2 })],
    ['no-frames', take({ frames: [] })],
    ['no-frames', take({ frames: 'x' })],
    ['bad-frame', take({ frames: [{ t: 0, hands: [], face: null }, { t: 'x', hands: [] }] })],
    ['bad-frame', take({ frames: [{ t: 0, hands: {} }] })],
    ['bad-frame', take({ frames: [null] })],
    ['bad-capture', take({ capture: null })],
    ['bad-capture', take({ capture: { durationMs: 'x' } })],
    ['bad-audio', take({ audio: { mimeType: 'video/mp4', base64: 'AAAA' } })],
    ['bad-audio', take({ audio: { mimeType: 'audio/webm' } })],
    ['bad-audio', take({ audio: 'x' })],
  ])('rejects %s', (reason, input) => {
    expect(validateTake(input)).toEqual({ ok: false, reason });
  });

  it('rejects an absurd frame count', () => {
    const frames = Array.from({ length: 200_001 }, (_, i) => ({ t: i, hands: [], face: null }));
    expect(validateTake(take({ frames }))).toEqual({ ok: false, reason: 'too-many-frames' });
  });
});
```

`server/rateLimit.test.mjs`:

```js
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
```

`server/store.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createStore, ID_RE } from './store.mjs';

let dir, clock, store;
const TTL = 24 * 3600_000;
const summary = { frames: 2, durationMs: 100, hasAudio: false, channels: ['face'] };

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
  clock = { t: 1_700_000_000_000 };
  store = createStore({ dataDir: dir, linkTtlMs: TTL, now: () => clock.t });
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('store', () => {
  it('saves a gzipped file plus meta and reads them back', async () => {
    const meta = await store.save(Buffer.from('{"a":1}'), summary, 'iphash');
    expect(meta.id).toMatch(ID_RE);
    expect(meta).toMatchObject({ createdAt: clock.t, rawBytes: 7, ...summary, ipHash: 'iphash' });
    expect(gunzipSync(await store.readGz(meta.id)).toString()).toBe('{"a":1}');
    expect(await store.getMeta(meta.id)).toEqual(meta);
  });

  it('isLive flips exactly at the TTL', async () => {
    const meta = await store.save(Buffer.from('{}'), summary, 'x');
    clock.t += TTL - 1;
    expect(store.isLive(meta)).toBe(true);
    clock.t += 1;
    expect(store.isLive(meta)).toBe(false);
  });

  it('lists newest first and tracks stored bytes', async () => {
    const a = await store.save(Buffer.from('{"n":1}'), summary, 'x');
    clock.t += 1000;
    const b = await store.save(Buffer.from('{"n":2}'), summary, 'x');
    expect((await store.list()).map((m) => m.id)).toEqual([b.id, a.id]);
    expect(await store.usedBytes()).toBe(a.storedBytes + b.storedBytes);
  });

  it('counts existing files after a restart', async () => {
    const a = await store.save(Buffer.from('{"n":1}'), summary, 'x');
    const again = createStore({ dataDir: dir, linkTtlMs: TTL, now: () => clock.t });
    expect(await again.usedBytes()).toBe(a.storedBytes);
  });

  it('never touches the filesystem for a malformed id', async () => {
    for (const bad of ['../../etc/passwd', 'short', 'a'.repeat(23), '..%2f..%2fx', '']) {
      expect(await store.getMeta(bad)).toBeNull();
      expect(await store.readGz(bad)).toBeNull();
    }
  });

  it('returns null for a well-formed id that does not exist', async () => {
    expect(await store.getMeta('a'.repeat(22))).toBeNull();
    expect(await store.readGz('a'.repeat(22))).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run server`
Expected: FAIL, "Failed to resolve import './config.mjs'" (and the other three modules).

- [ ] **Step 4: Write the implementations**

`server/config.mjs`:

```js
// Environment -> config. Numbers that are missing, garbage or not positive fall back to the default.
const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    dataDir: env.DATA_DIR || './data',
    maxBytes: int(env.MAX_TAKE_BYTES, 50 * 1024 * 1024),
    maxPerIpPerDay: int(env.MAX_UPLOADS_PER_IP_DAY, 30),
    linkTtlMs: int(env.LINK_TTL_HOURS, 24) * 3600_000,
    quotaBytes: int(env.QUOTA_MB, 10240) * 1024 * 1024,
    adminToken: env.ADMIN_TOKEN || '',
    contactEmail: env.CONTACT_EMAIL || '',
    ipSalt: env.IP_SALT || 'puppeteer-lab',
  };
}
```

`server/validate.mjs`:

```js
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
```

`server/rateLimit.mjs`:

```js
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
```

`server/store.mjs`:

```js
// One gzipped file + one meta file per take, flat in <dataDir>/takes. The app never deletes either.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip as gzipCb } from 'node:zlib';

const gzip = promisify(gzipCb);
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function createStore({ dataDir, linkTtlMs, now = Date.now }) {
  const dir = path.join(dataDir, 'takes');
  const filePath = (id) => path.join(dir, `${id}.json.gz`);
  const metaPath = (id) => path.join(dir, `${id}.meta.json`);
  let usedCache = null;

  async function list() {
    await fs.mkdir(dir, { recursive: true });
    const metas = [];
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        metas.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
      } catch {
        /* skip a torn write */
      }
    }
    return metas.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function usedBytes() {
    if (usedCache === null) usedCache = (await list()).reduce((n, m) => n + (m.storedBytes || 0), 0);
    return usedCache;
  }

  async function save(jsonBuf, summary, ipHash) {
    await fs.mkdir(dir, { recursive: true });
    const id = randomBytes(16).toString('base64url');
    const gz = await gzip(jsonBuf);
    const meta = { id, createdAt: now(), rawBytes: jsonBuf.length, storedBytes: gz.length, ...summary, ipHash };
    await fs.writeFile(filePath(id), gz, { flag: 'wx' });
    await fs.writeFile(`${metaPath(id)}.tmp`, JSON.stringify(meta));
    await fs.rename(`${metaPath(id)}.tmp`, metaPath(id));
    if (usedCache !== null) usedCache += gz.length;
    return meta;
  }

  async function getMeta(id) {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await fs.readFile(metaPath(id), 'utf8'));
    } catch {
      return null;
    }
  }

  async function readGz(id) {
    if (!ID_RE.test(id)) return null;
    try {
      return await fs.readFile(filePath(id));
    } catch {
      return null;
    }
  }

  const isLive = (meta) => now() - meta.createdAt < linkTtlMs;

  return { save, getMeta, readGz, list, usedBytes, isLive };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server`
Expected: PASS (config, validate, rateLimit and store test files all green).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts server/config.mjs server/config.test.mjs server/validate.mjs server/validate.test.mjs server/rateLimit.mjs server/rateLimit.test.mjs server/store.mjs server/store.test.mjs
git commit -m "feat(server): config, take validation, rate limiter and file store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: HTTP app and entrypoint

**Files:**
- Create: `server/app.mjs`, `server/app.test.mjs`, `server/index.mjs`
- Modify: `package.json` (script `server`)

**Interfaces:**
- Consumes: `loadConfig`, `validateTake`, `createDailyLimiter`, `createStore`, `ID_RE` (Task 1).
- Produces: `createApp({ config, store, now? }) => (req, res) => Promise<void>` (a `node:http` request listener). HTTP contract:
  - `GET /api/health` -> `200 {ok:true}`
  - `GET /api/config` -> `200 {uploadsEnabled:boolean, contactEmail:string, maxBytes:number, ttlHours:number}`
  - `POST /api/takes` (body: JSON, optionally `Content-Encoding: gzip`) -> `201 {id, url:"/t/<id>", expiresAt:<epoch ms>}`; errors `{error:<code>}`: 400 `bad-json`/`bad-gzip`, 413 `too-large`, 415 `unsupported-media-type`/`unsupported-encoding`, 422 `invalid-take` (+`reason`), 429 `rate-limited` (+`Retry-After`), 503 `uploads-disabled`/`storage-full`.
  - `GET /api/takes/:id` -> `200` JSON with header `X-Expires-At` (ISO); `?download=1` adds `Content-Disposition: attachment`; `404 not-found`; `410 expired`.
  - `GET /api/admin/takes` (`Authorization: Bearer <ADMIN_TOKEN>`) -> `200 {count, storedBytes, takes:Meta[]}`; `404` if no token configured; `401` if wrong.
  - `GET /api/admin/takes/:id/file` (same auth) -> the take as an attachment, expired or not.

- [ ] **Step 1: Write the failing tests**

`server/app.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
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
  const config = { port: 0, host: '127.0.0.1', dataDir: dir, maxBytes: 5000, maxPerIpPerDay: 100, linkTtlMs: TTL, quotaBytes: 1e12, adminToken: 'tok', contactEmail: 'me@example.test', ipSalt: 's', ...cfg };
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

describe('misc', () => {
  it('health, unknown route and wrong method', async () => {
    await boot();
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/takes`)).status).toBe(405);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/app.test.mjs`
Expected: FAIL, "Failed to resolve import './app.mjs'".

- [ ] **Step 3: Implement `server/app.mjs`**

```js
// The HTTP surface. One request listener; every failure is an HttpError -> JSON {error}.
import { promisify } from 'node:util';
import { gunzip as gunzipCb } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createDailyLimiter } from './rateLimit.mjs';
import { validateTake } from './validate.mjs';

const gunzip = promisify(gunzipCb);

class HttpError extends Error {
  constructor(status, code, headers = {}, body = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.body = body;
  }
}

const send = (res, status, body, headers = {}) => {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...headers });
  res.end(data);
};

// Behind Caddy on 127.0.0.1 the first X-Forwarded-For entry is the real client.
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
const digest = (s) => createHash('sha256').update(s).digest();

async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'too-large', { Connection: 'close' });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too-large', { Connection: 'close' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createApp({ config, store, now = Date.now }) {
  const limiter = createDailyLimiter({ max: config.maxPerIpPerDay, now });
  const hashIp = (ip) => createHash('sha256').update(`${config.ipSalt}:${ip}`).digest('hex').slice(0, 16);
  const expiresAt = (meta) => meta.createdAt + config.linkTtlMs;

  async function upload(req, res) {
    if (!config.contactEmail) throw new HttpError(503, 'uploads-disabled');
    const ipHash = hashIp(clientIp(req));
    const gate = limiter.take(ipHash);
    if (!gate.ok) throw new HttpError(429, 'rate-limited', { 'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)) });
    if ((await store.usedBytes()) >= config.quotaBytes) {
      console.error('[mocap] storage quota reached, refusing uploads');
      throw new HttpError(503, 'storage-full');
    }
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'unsupported-media-type');
    const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase();
    if (enc !== 'identity' && enc !== 'gzip') throw new HttpError(415, 'unsupported-encoding');

    let body = await readBody(req, config.maxBytes);
    if (enc === 'gzip') {
      try {
        body = await gunzip(body, { maxOutputLength: config.maxBytes });
      } catch (e) {
        throw e?.code === 'ERR_BUFFER_TOO_LARGE' ? new HttpError(413, 'too-large', { Connection: 'close' }) : new HttpError(400, 'bad-gzip');
      }
    }
    let json;
    try {
      json = JSON.parse(body.toString('utf8'));
    } catch {
      throw new HttpError(400, 'bad-json');
    }
    const v = validateTake(json);
    if (!v.ok) throw new HttpError(422, 'invalid-take', {}, { reason: v.reason });
    const meta = await store.save(body, v.summary, ipHash);
    send(res, 201, { id: meta.id, url: `/t/${meta.id}`, expiresAt: expiresAt(meta) });
  }

  async function getTake(req, res, id, url) {
    const meta = await store.getMeta(id);
    if (!meta) throw new HttpError(404, 'not-found');
    if (!store.isLive(meta)) throw new HttpError(410, 'expired');
    const gz = await store.readGz(id);
    if (!gz) throw new HttpError(404, 'not-found');
    const headers = { 'X-Expires-At': new Date(expiresAt(meta)).toISOString(), Vary: 'Accept-Encoding' };
    const download = url.searchParams.get('download') === '1';
    if (download) headers['Content-Disposition'] = `attachment; filename="puppet-take-${id}.json"`;
    if (!download && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      return send(res, 200, gz, { ...headers, 'Content-Encoding': 'gzip' });
    }
    send(res, 200, await gunzip(gz), headers);
  }

  function requireAdmin(req) {
    if (!config.adminToken) throw new HttpError(404, 'not-found');
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (!m || !timingSafeEqual(digest(m[1]), digest(config.adminToken))) throw new HttpError(401, 'unauthorized');
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      const p = url.pathname;
      const method = req.method;
      let m;

      if (p === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
      if (p === '/api/config' && method === 'GET') {
        return send(res, 200, {
          uploadsEnabled: !!config.contactEmail,
          contactEmail: config.contactEmail,
          maxBytes: config.maxBytes,
          ttlHours: config.linkTtlMs / 3600_000,
        });
      }
      if (p === '/api/takes') {
        if (method === 'POST') return await upload(req, res);
        throw new HttpError(405, 'method-not-allowed');
      }
      if ((m = /^\/api\/takes\/([^/]+)$/.exec(p))) {
        if (method !== 'GET') throw new HttpError(405, 'method-not-allowed');
        return await getTake(req, res, m[1], url);
      }
      if (p === '/api/admin/takes' && method === 'GET') {
        requireAdmin(req);
        const takes = await store.list();
        return send(res, 200, { count: takes.length, storedBytes: await store.usedBytes(), takes });
      }
      if ((m = /^\/api\/admin\/takes\/([^/]+)\/file$/.exec(p)) && method === 'GET') {
        requireAdmin(req);
        const gz = await store.readGz(m[1]);
        if (!gz) throw new HttpError(404, 'not-found');
        return send(res, 200, await gunzip(gz), { 'Content-Disposition': `attachment; filename="puppet-take-${m[1]}.json"` });
      }
      throw new HttpError(404, 'not-found');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...e.body }, e.headers);
      console.error('[mocap] unhandled', e);
      send(res, 500, { error: 'internal' });
    }
  };
}
```

- [ ] **Step 4: Implement `server/index.mjs`**

```js
// Process entry: env -> config -> store -> http server.
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';

const config = loadConfig();
const store = createStore({ dataDir: config.dataDir, linkTtlMs: config.linkTtlMs });
const server = http.createServer(createApp({ config, store }));

server.listen(config.port, config.host, () => {
  console.log(`[mocap] listening on ${config.host}:${config.port}, data in ${config.dataDir}`);
  if (!config.contactEmail) console.warn('[mocap] CONTACT_EMAIL is unset: uploads are refused until it is set');
  if (!config.adminToken) console.warn('[mocap] ADMIN_TOKEN is unset: the admin endpoints are off');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
```

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, add after `"stamp"`: `"server": "node server/index.mjs"` (add the comma to the previous line).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server`
Expected: PASS, all server tests (Task 1's plus the app tests).

Then `npm run typecheck` and `npm test`; both must stay green (245 existing tests + the server ones).

- [ ] **Step 7: Commit**

```bash
git add server/app.mjs server/app.test.mjs server/index.mjs package.json
git commit -m "feat(server): HTTP API for uploading, serving and listing takes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Client API module and route helper

**Files:**
- Create: `components/shared/takeApi.ts`, `components/shared/takeApi.test.ts`
- Modify: `appRoute.ts`, `appRoute.test.ts`

**Interfaces:**
- Produces (`components/shared/takeApi.ts`):
  - `type UploadErrorKind = 'disabled' | 'rate-limited' | 'too-large' | 'storage-full' | 'invalid' | 'network' | 'unknown'`
  - `class UploadError extends Error { kind: UploadErrorKind }` (message is user-ready copy)
  - `interface UploadConfig { uploadsEnabled: boolean; contactEmail: string; maxBytes: number; ttlHours: number }`
  - `fetchUploadConfig(fetchFn?) => Promise<UploadConfig | null>` (null on any failure, including a non-JSON answer)
  - `uploadTake(recording: Blob, fetchFn?) => Promise<{ id: string; url: string; expiresAt: number }>` (throws `UploadError`)
  - `fetchTake(id: string, fetchFn?) => Promise<{status:'ok', json: unknown, expiresAt: number|null} | {status:'expired'} | {status:'not-found'} | {status:'error'}>`
  - `expiresLabel(expiresAt: number, nowMs: number) => string`
- Produces (`appRoute.ts`): `resolveTakeId(pathname: string) => string | null`.

- [ ] **Step 1: Write the failing tests**

`components/shared/takeApi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { fetchTake, fetchUploadConfig, uploadTake, expiresLabel, UploadError } from './takeApi';

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
```

Append to `appRoute.test.ts` (keep the file's existing imports and add `resolveTakeId` to the import from `./appRoute`):

```ts
describe('resolveTakeId', () => {
  const id = 'AbCdEfGhIjKlMnOpQrStUv';
  it('reads a 22-char id from /t/<id>, with or without a trailing slash', () => {
    expect(resolveTakeId(`/t/${id}`)).toBe(id);
    expect(resolveTakeId(`/t/${id}/`)).toBe(id);
  });
  it('ignores everything else', () => {
    for (const p of ['/', '/t', '/t/', '/t/short', `/t/${id}x`, `/x/t/${id}`, `/t/${id}/more`, '/t/../etc']) {
      expect(resolveTakeId(p)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run components/shared/takeApi.test.ts appRoute.test.ts`
Expected: FAIL (module `./takeApi` not found; `resolveTakeId` is not exported).

- [ ] **Step 3: Implement**

Append to `appRoute.ts`:

```ts
/** The take id when the page is a share link (`/t/<22 chars>`), else null. */
export function resolveTakeId(pathname: string): string | null {
  const m = /^\/t\/([A-Za-z0-9_-]{22})\/?$/.exec(pathname);
  return m ? m[1] : null;
}
```

`components/shared/takeApi.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client side of the share-link API (server/app.mjs): upload a take, read the server's config, fetch a shared take.
 * Same-origin `/api/*`; every function takes an optional fetch so tests never touch the network.
 */

export type UploadErrorKind = 'disabled' | 'rate-limited' | 'too-large' | 'storage-full' | 'invalid' | 'network' | 'unknown';

const MESSAGES: Record<UploadErrorKind, string> = {
  disabled: 'Saving a link is not available right now. Use Export to keep your take.',
  'rate-limited': 'You have saved a lot of takes today. Try again tomorrow, or use Export.',
  'too-large': 'This take is too big to upload. Use Export to keep it.',
  'storage-full': 'Saving links is paused for now. Use Export to keep your take.',
  invalid: 'This take could not be uploaded. Use Export to keep it.',
  network: 'Could not reach the server. Check your connection and try again.',
  unknown: 'Could not save this take. Use Export to keep it.',
};

export class UploadError extends Error {
  constructor(public kind: UploadErrorKind) {
    super(MESSAGES[kind]);
    this.name = 'UploadError';
  }
}

function kindForResponse(status: number, code: string | undefined): UploadErrorKind {
  if (code === 'uploads-disabled') return 'disabled';
  if (status === 429) return 'rate-limited';
  if (status === 413) return 'too-large';
  if (code === 'storage-full') return 'storage-full';
  if (status === 400 || status === 415 || status === 422) return 'invalid';
  return 'unknown';
}

export interface UploadConfig {
  uploadsEnabled: boolean;
  contactEmail: string;
  maxBytes: number;
  ttlHours: number;
}

/** null when there is no API (static host, local dev without the server) or it answers anything unexpected. */
export async function fetchUploadConfig(fetchFn: typeof fetch = fetch): Promise<UploadConfig | null> {
  try {
    const r = await fetchFn('/api/config');
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.uploadsEnabled === 'boolean' ? (j as UploadConfig) : null;
  } catch {
    return null;
  }
}

async function gzipBlob(blob: Blob): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  } catch {
    return null;
  }
}

export async function uploadTake(recording: Blob, fetchFn: typeof fetch = fetch): Promise<{ id: string; url: string; expiresAt: number }> {
  const gz = await gzipBlob(recording);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gz) headers['Content-Encoding'] = 'gzip';
  let res: Response;
  try {
    res = await fetchFn('/api/takes', { method: 'POST', headers, body: gz ?? recording });
  } catch {
    throw new UploadError('network');
  }
  if (!res.ok) {
    let code: string | undefined;
    try {
      code = (await res.json()).error;
    } catch {
      /* non-JSON error body */
    }
    throw new UploadError(kindForResponse(res.status, code));
  }
  const j = await res.json();
  return { id: j.id, url: j.url, expiresAt: j.expiresAt };
}

export type TakeFetch =
  | { status: 'ok'; json: unknown; expiresAt: number | null }
  | { status: 'expired' }
  | { status: 'not-found' }
  | { status: 'error' };

export async function fetchTake(id: string, fetchFn: typeof fetch = fetch): Promise<TakeFetch> {
  try {
    const r = await fetchFn(`/api/takes/${encodeURIComponent(id)}`);
    if (r.status === 410) return { status: 'expired' };
    if (r.status === 404) return { status: 'not-found' };
    if (!r.ok) return { status: 'error' };
    const hdr = r.headers.get('X-Expires-At');
    const exp = hdr ? Date.parse(hdr) : NaN;
    return { status: 'ok', json: await r.json(), expiresAt: Number.isFinite(exp) ? exp : null };
  } catch {
    return { status: 'error' };
  }
}

/** "expires in 24 hours" (rounded up), "expires in 1 hour", or "expired". */
export function expiresLabel(expiresAt: number, nowMs: number): string {
  const ms = expiresAt - nowMs;
  if (ms <= 0) return 'expired';
  const h = Math.ceil(ms / 3_600_000);
  return `expires in ${h} hour${h === 1 ? '' : 's'}`;
}
```

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run components/shared/takeApi.test.ts appRoute.test.ts` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/shared/takeApi.ts components/shared/takeApi.test.ts appRoute.ts appRoute.test.ts
git commit -m "feat: client API for share links and the /t/<id> route helper" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: "Save & get link" in Face Puppet

**Files:**
- Create: `components/SaveLink.tsx`
- Modify: `components/RecorderControls.tsx` (new optional `footer` prop), `components/FaceDemo.tsx` (pass the footer), `components/CameraPanels.tsx` (copy), `vite.config.ts` (proxy), `.gitignore` (`data/`)

**Interfaces:**
- Consumes: `fetchUploadConfig`, `uploadTake`, `expiresLabel`, `UploadError`, `UploadConfig` (Task 3); `recorder.buildRecordingBlob('full')` (existing).
- Produces: `<SaveLink getBlob disabled hasAudio takeKey />`, renders nothing unless `/api/config` reports `uploadsEnabled`. Test ids used by Task 6: `save-link-button`, `save-link-url`, `save-link-copy`, `save-link-error`, `save-link-disclosure`.

- [ ] **Step 1: Proxy `/api` in dev and preview; ignore local takes**

`vite.config.ts`: add above `export default`:

```ts
const apiTarget = process.env.MOCAP_API || 'http://127.0.0.1:8787';
const apiProxy = { '/api': { target: apiTarget, changeOrigin: false } };
```

and inside `defineConfig({ ... })` add `proxy: apiProxy,` to the existing `server` block and a new sibling `preview: { proxy: apiProxy },`.

`.gitignore`: append

```
# Takes pulled from the server (scripts/Pull-Takes.ps1)
data/
```

- [ ] **Step 2: Create `components/SaveLink.tsx`**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Save & get link": uploads the current take on an explicit tap and shows a 24 h link (copy / share).
 * Renders nothing when the site has no API (static host, local dev without `npm run server`, or uploads disabled),
 * so the rest of the app is unchanged there.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link2, Copy, Check, Share2, Loader2 } from 'lucide-react';
import { fetchUploadConfig, uploadTake, expiresLabel, UploadConfig, UploadError } from './shared/takeApi';

interface SaveLinkProps {
    /** The take as a v3 recording JSON blob (recorder.buildRecordingBlob('full')). */
    getBlob: () => Promise<Blob>;
    disabled: boolean;
    hasAudio: boolean;
    /** Changes whenever the take changes, so a link is never shown for a different take. */
    takeKey: string;
}

type Phase =
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'done'; url: string; expiresAt: number }
    | { kind: 'error'; message: string };

const SaveLink: React.FC<SaveLinkProps> = ({ getBlob, disabled, hasAudio, takeKey }) => {
    const [cfg, setCfg] = useState<UploadConfig | null>(null);
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const [copied, setCopied] = useState(false);
    const runRef = useRef(0); // ignores an upload that finishes after the take changed

    useEffect(() => {
        let alive = true;
        fetchUploadConfig().then((c) => { if (alive) setCfg(c); });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        runRef.current++;
        setPhase({ kind: 'idle' });
        setCopied(false);
    }, [takeKey]);

    if (!cfg || !cfg.uploadsEnabled) return null;

    const save = async () => {
        const run = ++runRef.current;
        setPhase({ kind: 'uploading' });
        try {
            const r = await uploadTake(await getBlob());
            if (run !== runRef.current) return;
            setPhase({ kind: 'done', url: new URL(r.url, window.location.origin).toString(), expiresAt: r.expiresAt });
        } catch (e) {
            if (run !== runRef.current) return;
            setPhase({ kind: 'error', message: e instanceof UploadError ? e.message : 'Could not save this take. Use Export to keep it.' });
        }
    };

    const copy = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* the URL box is selectable; the user can copy by hand */
        }
    };

    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const btn = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-200 border border-white/10 transition-colors disabled:opacity-30 min-h-[44px] md:min-h-0';

    return (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            {phase.kind !== 'done' && (
                <button
                    data-testid="save-link-button"
                    onClick={save}
                    disabled={disabled || phase.kind === 'uploading'}
                    className={btn}
                    title="Upload this take and get a link that works for 24 hours"
                >
                    {phase.kind === 'uploading' ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                    {phase.kind === 'uploading' ? 'Saving...' : 'Save & get link'}
                </button>
            )}

            {phase.kind === 'done' && (
                <div className="flex flex-col gap-2">
                    <input
                        data-testid="save-link-url"
                        readOnly
                        value={phase.url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full bg-black/40 border border-white/15 rounded px-2 py-1.5 text-[11px] font-mono text-white min-h-[44px] md:min-h-0"
                    />
                    <div className="flex gap-2">
                        <button data-testid="save-link-copy" onClick={() => copy(phase.url)} className={`${btn} flex-1`}>
                            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}
                        </button>
                        {canShare && (
                            <button onClick={() => navigator.share({ title: 'Puppeteer Lab take', url: phase.url }).catch(() => {})} className={`${btn} flex-1`}>
                                <Share2 size={13} /> Share
                            </button>
                        )}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-snug">Link {expiresLabel(phase.expiresAt, Date.now())}.</p>
                </div>
            )}

            {phase.kind === 'error' && (
                <p data-testid="save-link-error" className="text-[10px] text-[#EE3B2B] leading-snug">{phase.message}</p>
            )}

            <p data-testid="save-link-disclosure" className="text-[10px] text-gray-500 leading-snug">
                We keep a copy of every take you save (motion{hasAudio ? ' and your voice' : ''}). The link works for {cfg.ttlHours} hours.
                To have a take removed, email {cfg.contactEmail}.
            </p>
        </div>
    );
};

export default SaveLink;
```

- [ ] **Step 3: Add the `footer` slot to `RecorderControls`**

In `components/RecorderControls.tsx`:
1. In `RecorderControlsProps` add after `showTransport?: boolean;`:
```ts
    /** Extra content at the bottom of the panel (Face Puppet's Save & get link). */
    footer?: React.ReactNode;
```
2. Add `footer` to the destructured props (after `showTransport = true`, add a comma and `footer`).
3. Render it as the last child of the outer container: immediately after the closing `</div>` of the `{/* File Operations */}` block (the `<div className="relative flex gap-2 mt-1">...</div>`), add `{footer}`.

- [ ] **Step 4: Wire it in `FaceDemo`**

`components/FaceDemo.tsx`: add `import SaveLink from './SaveLink';` with the other component imports. In the `recorderProps` object add a final property (after `extraExports`):

```tsx
    footer: (
      <SaveLink
        getBlob={() => recorder.buildRecordingBlob('full')}
        disabled={!recorder.hasData || exportState !== null || recorder.isRecording}
        hasAudio={recorder.hasAudio}
        takeKey={`${recorder.frameCount}:${recorder.durationMs}`}
      />
    ),
```

- [ ] **Step 5: Update the start-card copy**

`components/CameraPanels.tsx` line 52: replace

```tsx
    <p className="text-[10px] text-gray-500 leading-snug">Your video and voice stay on this device.</p>
```

with

```tsx
    <p className="text-[10px] text-gray-500 leading-snug">
      Camera video and sound stay on this device unless you tap Save &amp; get link on a take.
    </p>
```

(`scripts/phone-check.mjs:281` still matches `/stay on this device/i`.)

- [ ] **Step 6: Verify**

Run: `npm run typecheck; npm test`
Expected: clean, all tests pass.

Then a live check (Bash tool, from the worktree): start the API, start Vite, and confirm the button appears only when the API is up.

```bash
PORT=8787 DATA_DIR=./data CONTACT_EMAIL=removal@example.test node server/index.mjs &
npx vite --port 3000 &
```

With the Browser pane tools: open `http://localhost:3000`, load `tools/fixtures/synthetic-face-hands-take.json` via "Load JSON" (regenerate it first if missing: `node tools/make-synthetic-take.mjs --hands`), accept the alert, and confirm "Save & get link" shows, is enabled, and after a click shows a `/t/...` URL and the disclosure line. Stop the API, reload: the button must be gone and the page otherwise unchanged. Kill both background processes and delete `./data` (it is gitignored) afterwards.

- [ ] **Step 7: Commit**

```bash
git add components/SaveLink.tsx components/RecorderControls.tsx components/FaceDemo.tsx components/CameraPanels.tsx vite.config.ts .gitignore
git commit -m "feat: Save & get link in Face Puppet, with disclosure and copy update" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `/t/<id>` viewer page

**Files:**
- Create: `components/shared/takeShape.ts`, `components/shared/takeShape.test.ts`, `components/TakeViewer.tsx`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `fetchTake`, `expiresLabel` (Task 3); `resolveTakeId` (Task 3); `migrateV2`, `toDataUrl` from `components/shared/recordingSchema.ts`; `findFrameIndex` from `hooks/useRecorder.ts`; `drawPuppet`, `disposePuppet` from `components/face/FaceMeshRenderer.ts`; `INITIAL_PUPPET_STATE`, `stepPuppetState` from `components/face/puppetState.ts`.
- Produces: `takeShape(json: unknown) => { frames: FrameData[]; durationMs: number; aspect: number; audioDataUrl: string | null; hasAudio: boolean }`; `<TakeViewer id />` (default export). Test ids used by Task 6: `take-canvas`, `take-play`, `take-download`, `take-expiry`, `take-state`.

- [ ] **Step 1: Write the failing test for `takeShape`**

`components/shared/takeShape.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { takeShape } from './takeShape';

const v3 = (over: Record<string, unknown> = {}) => ({
  schema: 'puppeteer-lab/recording',
  version: 3,
  capture: { fps: 30, durationMs: 200, frameCount: 3, video: { width: 1280, height: 720 } },
  channels: ['face'],
  frames: [
    { t: 0, hands: [], face: { landmarks: [[0.5, 0.5, 0]], blendshapes: { jawOpen: 0.2 } } },
    { t: 100, hands: [], face: null },
    { t: 200, hands: [], face: null },
  ],
  audio: null,
  ...over,
});

describe('takeShape', () => {
  it('reads frames, duration and the camera aspect', () => {
    const s = takeShape(v3());
    expect(s.frames).toHaveLength(3);
    expect(s.durationMs).toBe(200);
    expect(s.aspect).toBeCloseTo(1280 / 720);
    expect(s.hasAudio).toBe(false);
    expect(s.audioDataUrl).toBeNull();
  });

  it('builds a data URL for the audio', () => {
    const s = takeShape(v3({ audio: { mimeType: 'audio/webm;codecs=opus', base64: 'QUJD', offsetMs: 12 } }));
    expect(s.hasAudio).toBe(true);
    expect(s.audioDataUrl).toBe('data:audio/webm;codecs=opus;base64,QUJD');
  });

  it('falls back to 4:3 when the take has no camera size', () => {
    expect(takeShape(v3({ capture: { durationMs: 200 } })).aspect).toBeCloseTo(4 / 3);
  });

  it('handles hands-only frames (face null) and a one-frame take', () => {
    const s = takeShape(v3({ capture: { durationMs: 0 }, frames: [{ t: 0, hands: [], face: null }] }));
    expect(s.frames).toHaveLength(1);
    expect(s.durationMs).toBe(0);
  });

  it('returns no frames for junk instead of throwing', () => {
    expect(takeShape(null).frames).toEqual([]);
    expect(takeShape({ schema: 'x' }).frames).toEqual([]);
    expect(takeShape(v3({ frames: 'nope' })).frames).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run components/shared/takeShape.test.ts`
Expected: FAIL, cannot resolve `./takeShape`.

- [ ] **Step 3: Implement `components/shared/takeShape.ts`**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Everything the share-link viewer needs from a downloaded v3 recording, computed without touching the DOM.
 */
import { FrameData } from '../../types';
import { migrateV2, toDataUrl } from './recordingSchema';

export interface TakeShape {
  frames: FrameData[];
  durationMs: number;
  aspect: number;
  hasAudio: boolean;
  audioDataUrl: string | null;
}

const EMPTY: TakeShape = { frames: [], durationMs: 0, aspect: 4 / 3, hasAudio: false, audioDataUrl: null };

export function takeShape(json: unknown): TakeShape {
  try {
    const frames = migrateV2(json);
    if (frames.length === 0) return EMPTY;
    const j = json as any;
    const vid = j?.capture?.video;
    const aspect = vid && vid.width > 0 && vid.height > 0 ? vid.width / vid.height : 4 / 3;
    const a = j?.audio;
    const audioDataUrl = a && typeof a.mimeType === 'string' && typeof a.base64 === 'string' ? toDataUrl(a.mimeType, a.base64) : null;
    return { frames, durationMs: frames[frames.length - 1].timestamp, aspect, hasAudio: audioDataUrl !== null, audioDataUrl };
  } catch {
    return EMPTY;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run components/shared/takeShape.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create `components/TakeViewer.tsx`**

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The page behind a share link (/t/<id>): plays the take back with the Face Puppet renderer, offers the JSON
 * as a download and shows when the link expires. No camera, no MediaPipe.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { fetchTake, expiresLabel } from './shared/takeApi';
import { takeShape, TakeShape } from './shared/takeShape';
import { findFrameIndex } from '../hooks/useRecorder';
import { drawPuppet, disposePuppet } from './face/FaceMeshRenderer';
import { INITIAL_PUPPET_STATE, stepPuppetState } from './face/puppetState';

type Loaded = TakeShape & { audioUrl: string | null; expiresAt: number | null };
type View = { kind: 'loading' } | { kind: 'expired' } | { kind: 'not-found' } | { kind: 'error' } | { kind: 'ready'; take: Loaded };

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full h-full flex flex-col bg-[#090A0C] text-[#EDEDED]">
    <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 font-mono text-xs">
      <a href="/" className="font-bold tracking-wider text-white">PUPPETEER LAB</a>
      <span className="text-gray-400">Shared take</span>
    </header>
    {children}
  </div>
);

const Message: React.FC<{ title: string; body: string; retry?: boolean }> = ({ title, body, retry }) => (
  <div data-testid="take-state" className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center font-mono">
    <p className="text-white text-sm font-bold">{title}</p>
    <p className="text-gray-400 text-xs max-w-sm leading-relaxed">{body}</p>
    <div className="flex gap-2 pt-2">
      {retry && <button onClick={() => window.location.reload()} className="min-h-[44px] px-5 rounded-lg bg-white/10 text-white text-xs">Try again</button>}
      <a href="/" className="min-h-[44px] px-5 rounded-lg bg-[#EE3B2B] text-white text-xs font-bold inline-flex items-center">Make your own</a>
    </div>
  </div>
);

const Player: React.FC<{ id: string; take: Loaded }> = ({ id, take }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const startRef = useRef(0); // performance.now() at take time 0 while playing
  const pausedAtRef = useRef(0);
  const stateRef = useRef(INITIAL_PUPPET_STATE);
  const [playing, setPlaying] = useState(false);
  const [clockMs, setClockMs] = useState(0);
  const [nowWall, setNowWall] = useState(() => Date.now());

  const timeMs = () =>
    Math.max(0, Math.min(take.durationMs, playingRef.current ? performance.now() - startRef.current : pausedAtRef.current));

  useEffect(() => {
    if (!take.audioUrl) return;
    const a = new Audio(take.audioUrl);
    audioRef.current = a;
    return () => {
      a.pause();
      audioRef.current = null;
      URL.revokeObjectURL(take.audioUrl!);
    };
  }, [take.audioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const parent = canvas.parentElement;
      if (parent && (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight)) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      let t = timeMs();
      if (playingRef.current && take.durationMs > 0 && performance.now() - startRef.current > take.durationMs) {
        startRef.current = performance.now();
        t = 0;
        const a = audioRef.current;
        if (a) { a.currentTime = 0; a.play().catch(() => {}); }
      }
      const frame = take.frames[findFrameIndex(take.frames, t)];
      stateRef.current = stepPuppetState(stateRef.current, frame.faceLandmarks, frame.blendshapes || {}, take.aspect, 0.5);
      drawPuppet(ctx, { face: frame.faceLandmarks ?? null, hands: frame.landmarks ?? [], state: stateRef.current }, canvas.width, canvas.height, {
        showGazeRays: false, showMocapDots: false, videoAspect: take.aspect,
        browBoost: 0.5, jawBoost: 0.75, blinkBoost: 0.5, creaseAngle: 35, meshDetail: 'low',
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); disposePuppet(canvas); };
  }, [take]);

  useEffect(() => {
    const id = setInterval(() => { setClockMs(timeMs()); setNowWall(Date.now()); }, 100);
    return () => clearInterval(id);
  }, [take]);

  const toggle = () => {
    if (playingRef.current) {
      pausedAtRef.current = timeMs();
      playingRef.current = false;
      setPlaying(false);
      audioRef.current?.pause();
      return;
    }
    const from = pausedAtRef.current >= take.durationMs ? 0 : pausedAtRef.current;
    startRef.current = performance.now() - from;
    playingRef.current = true;
    setPlaying(true);
    const a = audioRef.current;
    if (a) {
      try { a.currentTime = from / 1000; } catch { /* metadata not loaded yet */ }
      a.play().catch(() => {});
    }
  };

  const seek = (ms: number) => {
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    pausedAtRef.current = ms;
    setClockMs(ms);
    try { if (audioRef.current) audioRef.current.currentTime = ms / 1000; } catch { /* not loaded yet */ }
  };

  return (
    <>
      <div className="flex-1 min-h-0 relative bg-[#090A0C] overflow-hidden">
        <canvas data-testid="take-canvas" ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="px-4 pt-3 pb-14 md:pb-4 border-t border-white/10 flex flex-col gap-3 font-mono text-[11px] text-gray-300">
        <div className="flex items-center gap-3">
          <button
            data-testid="take-play"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="w-11 h-11 shrink-0 rounded-full bg-white text-black flex items-center justify-center"
          >
            {playing ? <Pause fill="currentColor" size={16} /> : <Play fill="currentColor" size={16} className="ml-0.5" />}
          </button>
          <input
            type="range" min={0} max={Math.max(1, take.durationMs)} step={16} value={clockMs}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="flex-1 h-1.5 accent-[#EE3B2B]" aria-label="Scrub"
          />
          <span className="tabular-nums shrink-0">{fmt(clockMs)} / {fmt(take.durationMs)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            data-testid="take-download"
            href={`/api/takes/${id}?download=1`}
            download
            className="min-h-[44px] md:min-h-0 px-4 rounded-lg bg-white/10 hover:bg-white/15 text-white inline-flex items-center gap-1.5"
          >
            <Download size={13} /> Download JSON
          </a>
          <a href="/" className="min-h-[44px] md:min-h-0 inline-flex items-center text-[#EE3B2B] font-bold">Make your own</a>
          {take.expiresAt !== null && <span data-testid="take-expiry" className="text-gray-500">Link {expiresLabel(take.expiresAt, nowWall)}</span>}
          {take.hasAudio && <span className="text-gray-500">Tap play for sound</span>}
        </div>
      </div>
    </>
  );
};

const TakeViewer: React.FC<{ id: string }> = ({ id }) => {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetchTake(id);
      if (!alive) return;
      if (r.status !== 'ok') return setView({ kind: r.status });
      const shape = takeShape(r.json);
      if (shape.frames.length === 0) return setView({ kind: 'error' });
      let audioUrl: string | null = null;
      if (shape.audioDataUrl) {
        try {
          audioUrl = URL.createObjectURL(await (await fetch(shape.audioDataUrl)).blob());
        } catch {
          /* play it silently */
        }
      }
      if (!alive) {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        return;
      }
      setView({ kind: 'ready', take: { ...shape, audioUrl, expiresAt: r.expiresAt } });
    })();
    return () => { alive = false; };
  }, [id]);

  return (
    <Shell>
      {view.kind === 'loading' && <div className="flex-1 flex items-center justify-center text-gray-400 text-xs font-mono animate-pulse">Loading take...</div>}
      {view.kind === 'expired' && <Message title="This link has expired" body="Links to a saved take work for 24 hours. Record a new one and save it again." />}
      {view.kind === 'not-found' && <Message title="We can't find that take" body="The link may be mistyped or cut off. Check that you copied all of it." />}
      {view.kind === 'error' && <Message title="Could not load this take" body="Something went wrong loading it. Check your connection and try again." retry />}
      {view.kind === 'ready' && <Player id={id} take={view.take} />}
    </Shell>
  );
};

export default TakeViewer;
```

- [ ] **Step 6: Route to it from `App.tsx`**

Replace `App.tsx` body as follows. Keep the imports and lazy demos; add `useMemo` to the React import, add `resolveTakeId` to the `./appRoute` import, add `const TakeViewer = lazy(() => import('./components/TakeViewer'));` under the other lazy imports, rename the existing `const App: React.FC = () => {` component to `const Lab: React.FC = () => {` (its body is unchanged), and add after it:

```tsx
const App: React.FC = () => {
  const takeId = useMemo(() => resolveTakeId(window.location.pathname), []);
  if (!takeId) return <Lab />;
  return (
    <div className="w-full h-[100dvh] bg-[#090A0C] overflow-hidden text-[#EDEDED] font-sans">
      <Suspense fallback={<DemoFallback />}>
        <TakeViewer id={takeId} />
      </Suspense>
    </div>
  );
};

export default App;
```

(remove the old `export default App;` that followed the original component so there is exactly one.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck; npm test; npm run build`
Expected: clean, all tests pass, build succeeds (TakeViewer emitted as its own chunk).

Live check as in Task 4 Step 6 (API + Vite running): upload the synthetic take through the UI, open the returned `/t/<id>` URL in the Browser pane. Expect: the puppet drawn on the stage, Play animates it, the scrubber moves, "Download JSON" links to `/api/takes/<id>?download=1`, "Link expires in 24 hours" is shown. Also open `/t/aaaaaaaaaaaaaaaaaaaaaa` (expect the "can't find that take" state). Stop the processes and delete `./data` afterwards.

- [ ] **Step 8: Commit**

```bash
git add components/shared/takeShape.ts components/shared/takeShape.test.ts components/TakeViewer.tsx App.tsx
git commit -m "feat: /t/<id> viewer page with playback, download and expiry" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Container files, pull script, e2e check, docs

**Files:**
- Create: `server/Dockerfile`, `server/compose.yaml`, `server/.dockerignore`, `scripts/Pull-Takes.ps1`, `scripts/share-check.mjs`, `docs/SHARE_LINKS.md`
- Modify: `package.json` (script `share-check`), `docs/PHONE_PORT.md` (one paragraph)

**Interfaces:**
- Consumes: everything above; test ids from Tasks 4 and 5.
- Produces: `npm run share-check` (builds, then runs `scripts/share-check.mjs`), a self-contained `server/` directory that Task 7 ships.

- [ ] **Step 1: Container files**

`server/Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
```

`server/.dockerignore`:

```
*.test.mjs
Dockerfile
compose.yaml
.env*
data
```

`server/compose.yaml`:

```yaml
services:
  mocap-api:
    build: .
    restart: unless-stopped
    ports:
      # Loopback only: Caddy on the same box is the only client, and the rate limiter trusts X-Forwarded-For because of that.
      - "127.0.0.1:3016:8787"
    env_file:
      - .env.local
    environment:
      - HOST=0.0.0.0
      - DATA_DIR=/data
    volumes:
      - /home/grayson/mocap-data:/data
```

(`3016` is the next free port after MFBS's `3015` as of 2026-09-27; Task 7 verifies it with `docker ps` before use.)

Verify the image builds if Docker is available locally: `docker build -t mocap-api-test server` (skip and say so if Docker is not installed; do not install it).

- [ ] **Step 2: The pull script**

`scripts/Pull-Takes.ps1` (Windows PowerShell 5.1 compatible: no `&&`, no `??`):

```powershell
<#
Pulls every take the server has that is not already on this machine.
Takes land as <id>.json (the recording) + <id>.meta.json (server metadata) in -Dest.
The admin token comes from the MOCAP_ADMIN_TOKEN environment variable (or -Token); never paste it into a command.
#>
param(
  [string]$Base = 'https://mocap.graysonchalmers.com',
  [string]$Dest = 'C:\Projects-local\Tool-PuppeteerLab\data\takes',
  [string]$Token = $env:MOCAP_ADMIN_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'Set the MOCAP_ADMIN_TOKEN environment variable (or pass -Token) first.' }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$headers = @{ Authorization = "Bearer $Token" }
$list = Invoke-RestMethod -Uri "$Base/api/admin/takes" -Headers $headers

$new = 0
foreach ($t in $list.takes) {
  $json = Join-Path $Dest "$($t.id).json"
  if (Test-Path $json) { continue }
  $part = "$json.part"
  Invoke-WebRequest -Uri "$Base/api/admin/takes/$($t.id)/file" -Headers $headers -OutFile $part
  Move-Item -Force $part $json
  ($t | ConvertTo-Json -Depth 5) | Set-Content -Encoding UTF8 (Join-Path $Dest "$($t.id).meta.json")
  $new++
}
Write-Host "Pulled $new new take(s); $($list.count) on the server, $($list.storedBytes) bytes stored."
```

- [ ] **Step 3: The e2e check**

`scripts/share-check.mjs`:

```js
/**
 * Share-link gate: runs the REAL server (temp data dir) and `vite preview` of dist/ with /api proxied to it, then
 * drives real browsers through the whole flow:
 *   - Face Puppet: Save & get link is disabled until a take is loaded, then uploads and shows a /t/<id> link + disclosure;
 *   - the link page plays the take, shows the expiry, links a JSON download; an unknown id shows "can't find";
 *   - the admin endpoint lists the take (and refuses a missing token); scripts/Pull-Takes.ps1 pulls it;
 *   - the viewer fits an iPhone-sized WebKit window (no sideways scroll, Play reachable).
 * Screenshots go to $PROOF_DIR or .proof/<date>-share-links/ (gitignored). Needs network (Tailwind CDN).
 * Ports: $SHARE_CHECK_API_PORT (8791) and $SHARE_CHECK_PORT (4174); a busy port is refused.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const API_PORT = Number(process.env.SHARE_CHECK_API_PORT ?? 8791);
const WEB_PORT = Number(process.env.SHARE_CHECK_PORT ?? 4174);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const TOKEN = 'share-check-token';
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-share-links`;
const FIXTURE = 'tools/fixtures/synthetic-face-hands-take.json';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const children = [];
const dataDir = mkdtempSync(path.join(tmpdir(), 'share-check-'));
const pulledDir = path.join(dataDir, 'pulled');

async function waitFor(url, label) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start`);
}

async function start() {
  for (const url of [`${API}/api/health`, WEB]) {
    if (await fetch(url).then(() => true, () => false)) throw new Error(`${url} is already serving; refusing to test a server this script did not start`);
  }
  if (!existsSync(FIXTURE)) spawnSync(process.execPath, ['tools/make-synthetic-take.mjs', '--hands'], { stdio: 'inherit' });
  children.push(spawn(process.execPath, ['server/index.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, CONTACT_EMAIL: 'removal@example.test', ADMIN_TOKEN: TOKEN },
  }));
  children.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(WEB_PORT), '--strictPort'], {
    stdio: 'ignore',
    env: { ...process.env, MOCAP_API: API },
  }));
  await waitFor(`${API}/api/health`, 'API');
  await waitFor(WEB, 'vite preview');
}

async function main() {
  await start();
  let link = '';

  // 1. Face Puppet on desktop Chromium: load a take, save it, get the link.
  const chrome = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const page = await (await chrome.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(WEB);
    const save = page.getByTestId('save-link-button');
    await save.waitFor({ timeout: 15000 });
    check('Save & get link shows when the API is up', true);
    check('it is disabled before there is a take', await save.isDisabled());
    await page.setInputFiles('input[type=file]', FIXTURE);
    await page.waitForFunction(() => !document.querySelector('[data-testid=save-link-button]').disabled, null, { timeout: 15000 });
    check('it enables once a take is loaded', true);
    check('the disclosure names the contact address', /removal@example\.test/.test(await page.getByTestId('save-link-disclosure').innerText()));
    await save.click();
    const urlBox = page.getByTestId('save-link-url');
    await urlBox.waitFor({ timeout: 15000 });
    link = await urlBox.inputValue();
    check('a /t/<id> link comes back', /\/t\/[A-Za-z0-9_-]{22}$/.test(link), link);
    await page.screenshot({ path: path.join(OUT, '01-face-puppet-save-link.png') });

    // 2. The link page.
    const viewer = await (await chrome.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    viewer.on('pageerror', (e) => errors.push(String(e)));
    await viewer.goto(link);
    await viewer.getByTestId('take-canvas').waitFor({ timeout: 15000 });
    check('the link page shows the stage', true);
    check('it shows when the link expires', /expires in 2[34] hours/.test(await viewer.getByTestId('take-expiry').innerText()));
    const href = await viewer.getByTestId('take-download').getAttribute('href');
    check('it links a JSON download', /\/api\/takes\/[A-Za-z0-9_-]{22}\?download=1$/.test(href ?? ''), href ?? '');
    const dl = await viewer.request.get(new URL(href, WEB).toString());
    check('the download is the recording', (await dl.json()).schema === 'puppeteer-lab/recording');
    const stage = viewer.getByTestId('take-canvas');
    const before = await stage.screenshot();
    await viewer.getByTestId('take-play').click();
    await viewer.waitForTimeout(700);
    const after = await stage.screenshot();
    check('Play animates the puppet', !before.equals(after));
    await viewer.screenshot({ path: path.join(OUT, '02-viewer-desktop.png') });
    check('no page errors on the viewer', errors.length === 0, errors.join(' | '));

    const missing = await (await chrome.newContext()).newPage();
    await missing.goto(`${WEB}/t/${'a'.repeat(22)}`);
    check('an unknown id says it cannot find the take', /can't find that take/i.test(await missing.getByTestId('take-state').innerText()));
  } finally {
    await chrome.close();
  }

  // 3. Admin listing and the pull script.
  const noAuth = await fetch(`${API}/api/admin/takes`);
  check('the admin list refuses a missing token', noAuth.status === 401);
  const list = await (await fetch(`${API}/api/admin/takes`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  check('the admin list has the saved take', list.count === 1 && list.takes[0].frames > 0);
  const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const pull = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/Pull-Takes.ps1', '-Base', API, '-Dest', pulledDir, '-Token', TOKEN], { encoding: 'utf8' });
  if (pull.error) check('Pull-Takes.ps1 ran', false, `${ps} not available: ${pull.error.message}`);
  else {
    const files = existsSync(pulledDir) ? readdirSync(pulledDir) : [];
    check('Pull-Takes.ps1 pulled the recording and its meta', pull.status === 0 && files.some((f) => f.endsWith('.meta.json')) && files.some((f) => f.endsWith('.json') && !f.endsWith('.meta.json')), pull.stderr.trim().split('\n')[0]);
  }

  // 4. iPhone-sized WebKit: the viewer fits (layout only; WebKit has no camera here).
  const wk = await webkit.launch();
  try {
    const page = await (await wk.newContext({ ...devices['iPhone 13'] })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(link);
    await page.getByTestId('take-play').waitFor({ timeout: 20000 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check('iPhone: the viewer has no sideways scroll', fits);
    const box = await page.getByTestId('take-play').boundingBox();
    const vp = page.viewportSize();
    check('iPhone: Play is inside the window', !!box && box.y + box.height <= vp.height && box.x >= 0);
    await page.screenshot({ path: path.join(OUT, '03-viewer-iphone-webkit.png') });
    check('iPhone: no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await wk.close();
  }
}

try {
  await main();
} catch (e) {
  check('share-check completed', false, String(e.stack ?? e).split('\n').slice(0, 3).join(' '));
} finally {
  for (const c of children) c.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
```

Add to `package.json` `scripts`: `"share-check": "npm run build && node scripts/share-check.mjs"`.

Run: `npm run share-check`
Expected: every check PASS. Two checks may need a look rather than a blind fix: "Play animates the puppet" (if the synthetic take is static for the first 700 ms, sample after a longer wait or seek to the middle with the scrubber first) and the WebKit viewer (if WebKit has no WebGL the stage falls back to the 2D placeholder, which is fine; the layout checks are what matter). Fix the script or the code with a root cause, not by loosening an assertion that caught a real problem.

- [ ] **Step 4: Docs**

`docs/SHARE_LINKS.md`:

```markdown
# Share links (server storage)

Face Puppet's **Save & get link** uploads a take to a small API and returns `/t/<id>`, a page that plays the take back and offers the JSON for **24 hours**. Every saved take is kept in a private archive and never deleted by the app. Decisions and rationale: `docs/superpowers/specs/2026-09-30-share-links-design.md`.

## Pieces
| Piece | Where |
|---|---|
| API (Node 22, no npm deps) | `server/` (`app.mjs` routes, `store.mjs` files, `validate.mjs`, `rateLimit.mjs`, `config.mjs`) |
| Client | `components/SaveLink.tsx`, `components/TakeViewer.tsx`, `components/shared/takeApi.ts`, `takeShape.ts`, `appRoute.ts` (`resolveTakeId`) |
| Container | `server/Dockerfile`, `server/compose.yaml` (loopback port 3016, bind mount `/home/grayson/mocap-data`) |
| Pull to this PC | `scripts/Pull-Takes.ps1` -> `data/takes/` (gitignored) |
| Gate | `npm run share-check` (real server + vite preview + Chromium + WebKit) |

## API
`GET /api/health`, `GET /api/config`, `POST /api/takes` (JSON, optional `Content-Encoding: gzip`), `GET /api/takes/:id` (`?download=1`), `GET /api/admin/takes`, `GET /api/admin/takes/:id/file` (bearer `ADMIN_TOKEN`). Error codes are in `server/app.mjs`.

## Environment (`server/.env.local` on the box, never committed, never echoed)
`CONTACT_EMAIL` (**required**: uploads are refused while it is empty; shown in the disclosure), `ADMIN_TOKEN` (enables the admin endpoints), `IP_SALT`, and optional overrides `MAX_TAKE_BYTES` (50 MB), `MAX_UPLOADS_PER_IP_DAY` (30), `LINK_TTL_HOURS` (24), `QUOTA_MB` (10240), `PORT`, `DATA_DIR`.

## Data layout
`<DATA_DIR>/takes/<id>.json.gz` (the recording) and `<id>.meta.json` (`createdAt, rawBytes, storedBytes, frames, durationMs, hasAudio, channels, ipHash`). The IP is stored only as a salted hash.

## Things to remember
- The take contains face/hand motion and optionally the user's voice. The disclosure beside the button says so; keep it in step with what is stored.
- The client IP is read from `X-Forwarded-For`, trusted only because the container port is bound to `127.0.0.1` behind Caddy. The rate limiter is in memory (a restart resets it).
- To remove a take on request: delete `<id>.json.gz` and `<id>.meta.json` from the data dir on the box, and from `data/takes/` here if it was pulled.
- Not built yet: email the link (phase 2, Resend, link only), self-serve delete, the other four demos, audio-offset sync in the viewer.
```

`docs/PHONE_PORT.md`: append a final section:

```markdown
## Save & get link (2026-09-30)

On a phone, Face Puppet's Controls drawer has **Save & get link**: it uploads the take and returns a 24 h link, so nothing has to be saved on the phone (this replaces the need for item 3 for most people). See `docs/SHARE_LINKS.md`. The button is hidden when the site has no API. Untested on a real phone: the Copy button (clipboard permission on iOS) and the share sheet.
```

- [ ] **Step 5: Full gate**

Run each and expect success: `npm run typecheck`, `npm test`, `npm run smoke`, `npm run phone-check` (the start-card copy changed; 97/97 must still hold), `npm run share-check`.

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/compose.yaml server/.dockerignore scripts/Pull-Takes.ps1 scripts/share-check.mjs docs/SHARE_LINKS.md docs/PHONE_PORT.md package.json
git commit -m "feat: container files, pull script, share-check gate and docs for share links" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Proof for Grayson**

Send `01-face-puppet-save-link.png`, `02-viewer-desktop.png` and `03-viewer-iphone-webkit.png` from the proof dir with `SendUserFile` (after the gates above, as the last step). Say plainly that nothing has run on a real phone and that the WebKit shot is layout only.

---

### Task 7: Deploy to apps-01 (CHECKPOINT: controller only, needs Grayson's explicit go-ahead)

Not for a subagent. Stop after Task 6 and report to Grayson: what is built, the gate results, the proof shots, and that going live needs (a) his OK to touch apps-01 (outward-facing, changes the live site), (b) a decision on `CONTACT_EMAIL`, (c) him pasting the secrets. Then, only on a yes:

- [ ] **Step 1: Read before writing.** Read `_agent-commons/reference/apps-01-deploy-runbook.md`, `_agent-commons/state/apps-01-server.md` (mocap entries) and the go-live skill. Over ssh, read the current `mocap.graysonchalmers.com` block in `/etc/caddy/Caddyfile` and run `sudo docker ps` to confirm port 3016 is free (pick the next free one otherwise and edit `server/compose.yaml`).
- [ ] **Step 2: Prepare the box.** `mkdir -p /home/grayson/mocap-data /home/grayson/apps/mocap-api` (as `grayson`, uid 1000, so the container's `node` user can write). Have Grayson create `/home/grayson/apps/mocap-api/.env.local` himself with `CONTACT_EMAIL=...`, `ADMIN_TOKEN=...`, `IP_SALT=...` (he generates the token straight to the clipboard, e.g. `$b = New-Object byte[] 24; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); [Convert]::ToBase64String($b) | Set-Clipboard`, and pastes it into the file; also into his User env var `MOCAP_ADMIN_TOKEN` for the pull script). Never print these.
- [ ] **Step 3: Ship the container** by the runbook's tar-over-ssh pattern from the `server/` directory (exclude `*.test.mjs`, `.env*`, `data`), then `sudo docker compose up -d --build` in `/home/grayson/apps/mocap-api`; confirm `curl http://127.0.0.1:3016/api/health` on the box.
- [ ] **Step 4: Caddy.** Keep the existing directives (headers, `encode`) and restructure the mocap block to:

```
mocap.graysonchalmers.com {
	encode gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:3016
	}
	handle /t/* {
		root * /var/www/mocap
		rewrite * /index.html
		file_server
	}
	handle {
		root * /var/www/mocap
		file_server
	}
}
```

`sudo caddy validate --config /etc/caddy/Caddyfile` first, then `sudo systemctl reload caddy`.
- [ ] **Step 5: Redeploy the static site** by the existing path (build, secret gate, badge injection, scp, `chown`/`chmod`), keeping the `.bak` of `index.html`.
- [ ] **Step 6: Verify live.** `curl -s https://mocap.graysonchalmers.com/api/config` shows `uploadsEnabled:true`; run the Face Puppet flow in the Browser pane against the live site with the synthetic take; open the returned link; confirm the badge strip and the Controls button are still clear of each other on a phone-size window; check `sudo docker logs` is clean.
- [ ] **Step 7: Pull test.** Run `scripts/Pull-Takes.ps1` once (Grayson's PowerShell 5.1, token from his env var). Offer, do not create, a nightly scheduled task for it.
- [ ] **Step 8: Record.** Write the `_agent-commons/log/` entry and update `state/apps-01-server.md` (new container, port, data dir, Caddy structure), update `HANDOFF.md`, and save a project memory (`share-links.md`: what exists, where the data lives, that `CONTACT_EMAIL` gates uploads, the consent rule). Then clean up worktrees per the project rule.

---

## Later (not in this plan)

Phase 2 email: Resend account + verified sender on graysonchalmers.com (DNS), a `RESEND_API_KEY` in `.env.local`, `POST /api/takes/:id/email` (fixed template, link only, per-IP and per-address limits, no address stored beyond an `emailed` flag), and a small field in `SaveLink`. Plan it after v1 is live and the real-phone run has happened.
