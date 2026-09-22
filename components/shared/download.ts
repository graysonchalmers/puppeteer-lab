/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** File extension for a recorded media MIME type (codec suffixes ignored). */
export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith('video/mp4')) return 'mp4';
  if (m.startsWith('video/webm') || m.startsWith('audio/webm')) return 'webm';
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('audio/ogg')) return 'ogg';
  return 'bin';
}

/** Save a Blob through a temporary <a download>. The object URL is revoked a
 * moment later, not synchronously: some browsers start the download after
 * click() returns, and an already-revoked URL fails it. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
