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
