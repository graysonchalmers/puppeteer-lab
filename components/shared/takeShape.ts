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
