/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client side of the share-link API (server/app.mjs): upload a take, read the server's config, fetch a shared take.
 * Same-origin `/api/*`; every function takes an optional fetch so tests never touch the network.
 */

export type UploadErrorKind = 'disabled' | 'rate-limited' | 'too-large' | 'storage-full' | 'busy' | 'invalid' | 'network' | 'unknown';

const MESSAGES: Record<UploadErrorKind, string> = {
  disabled: 'Saving a link is not available right now. Use Export to keep your take.',
  'rate-limited': 'You have saved a lot of takes today. Try again tomorrow, or use Export.',
  'too-large': 'This take is too big to upload. Use Export to keep it.',
  'storage-full': 'Saving links is paused for now. Use Export to keep your take.',
  busy: 'The server is busy. Try again in a few seconds.',
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
  if (code === 'busy') return 'busy';
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

/**
 * Checked before uploading: the server caps the DECOMPRESSED take at `maxBytes`, and the blob is the uncompressed JSON,
 * so its size is exact. Null when it fits.
 */
export function oversizeMessage(size: number, maxBytes: number): string | null {
  if (size <= maxBytes) return null;
  return `This take is too long to upload (limit about ${Math.round(maxBytes / (1024 * 1024))} MB). Use Export to keep it.`;
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
