/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for the Face Puppet exports: which video type MediaRecorder
 * should use (MP4 first so clips play on phones), file extensions, the take
 * timestamp, and the pack zip (media stored, JSON deflated).
 */
import { zipSync, Zippable } from 'fflate';

export const VIDEO_MIME_CANDIDATES: readonly string[] = [
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

export function pickVideoMime(isSupported: (mime: string) => boolean): string | null {
  return VIDEO_MIME_CANDIDATES.find((m) => isSupported(m)) ?? null;
}

export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith('video/mp4')) return 'mp4';
  if (m.startsWith('video/webm') || m.startsWith('audio/webm')) return 'webm';
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('audio/ogg')) return 'ogg';
  return 'bin';
}

export function takeStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface PackInput {
  video: { blob: Blob; mimeType: string };
  recordingJson: Blob;
  audio: { blob: Blob; mimeType: string } | null;
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

export async function buildPackZip(input: PackInput): Promise<Uint8Array> {
  const files: Zippable = {
    [`puppet.${extensionForMime(input.video.mimeType)}`]: [await bytes(input.video.blob), { level: 0 }],
    'recording.json': [await bytes(input.recordingJson), { level: 6 }],
  };
  if (input.audio) {
    files[`audio.${extensionForMime(input.audio.mimeType)}`] = [await bytes(input.audio.blob), { level: 0 }];
  }
  return zipSync(files);
}
