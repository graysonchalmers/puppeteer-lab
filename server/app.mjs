// The HTTP surface. One request listener; every failure is an HttpError -> JSON {error}.
import { promisify } from 'node:util';
import { pipeline } from 'node:stream';
import { gunzip as gunzipCb, createGunzip } from 'node:zlib';
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

/**
 * Streams a stored .json.gz: as-is (Content-Encoding: gzip, with its length) when `asGzip`, else inflated on the fly
 * (no Content-Length). Never buffers the take. A stream error after the headers went out destroys the response.
 */
function sendStoredTake(res, opened, headers, asGzip) {
  const common = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers };
  const done = (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('[mocap] take stream failed:', err.code || err.message);
  };
  if (asGzip) {
    res.writeHead(200, { ...common, 'Content-Encoding': 'gzip', 'Content-Length': opened.size });
    pipeline(opened.stream, res, done);
  } else {
    res.writeHead(200, common);
    pipeline(opened.stream, createGunzip(), res, done);
  }
}

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
  let uploadsInFlight = 0;

  async function upload(req, res) {
    if (!config.contactEmail) throw new HttpError(503, 'uploads-disabled');
    // Memory cap: decided (and the slot taken) synchronously, before the body is read or a daily slot is spent.
    if (uploadsInFlight >= config.maxConcurrentUploads) throw new HttpError(503, 'busy', { 'Retry-After': '5' });
    uploadsInFlight++;
    try {
      await receiveTake(req, res);
    } finally {
      uploadsInFlight--;
    }
  }

  async function receiveTake(req, res) {
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
    const opened = await store.openGz(id);
    if (!opened) throw new HttpError(404, 'not-found');
    const headers = { 'X-Expires-At': new Date(expiresAt(meta)).toISOString(), Vary: 'Accept-Encoding' };
    const download = url.searchParams.get('download') === '1';
    if (download) headers['Content-Disposition'] = `attachment; filename="puppet-take-${id}.json"`;
    sendStoredTake(res, opened, headers, !download && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')));
  }

  function requireAdmin(req) {
    if (!config.adminToken) throw new HttpError(404, 'not-found');
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (!m || !timingSafeEqual(digest(m[1]), digest(config.adminToken))) throw new HttpError(401, 'unauthorized');
  }

  return async function handle(req, res) {
    try {
      let url;
      try {
        url = new URL(req.url, 'http://local');
      } catch {
        throw new HttpError(400, 'bad-request'); // e.g. a request target of "//" or "//["
      }
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
        const opened = await store.openGz(m[1]);
        if (!opened) throw new HttpError(404, 'not-found');
        return sendStoredTake(res, opened, { 'Content-Disposition': `attachment; filename="puppet-take-${m[1]}.json"` }, false);
      }
      throw new HttpError(404, 'not-found');
    } catch (e) {
      if (res.headersSent) return void res.destroy(); // a JSON error can no longer be sent
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...e.body }, e.headers);
      console.error('[mocap] unhandled', e);
      send(res, 500, { error: 'internal' });
    }
  };
}
