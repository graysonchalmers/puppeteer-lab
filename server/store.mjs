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

  /** The stored file as a stream (for responses) plus its size, or null. Opened before any header is sent, so a missing file is still a clean 404. */
  async function openGz(id) {
    if (!ID_RE.test(id)) return null;
    let fh;
    try {
      fh = await fs.open(filePath(id), 'r');
    } catch {
      return null;
    }
    try {
      const { size } = await fh.stat();
      return { size, stream: fh.createReadStream() }; // autoClose: the handle closes when the stream ends or is destroyed
    } catch {
      await fh.close().catch(() => {});
      return null;
    }
  }

  const isLive = (meta) => now() - meta.createdAt < linkTtlMs;

  return { save, getMeta, readGz, openGz, list, usedBytes, isLive };
}
