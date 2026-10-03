/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-take hand depth for the orbit view, computed once per frames array and only while orbit is on.
 */
import { useMemo } from 'react';
import { FrameData } from '../types';
import { TakeDepth, computeHandDepth } from '../components/face/handDepth';

const EMPTY: TakeDepth = { handR: [], pivot: null };

export function useTakeDepth(frames: FrameData[], aspect: number, enabled: boolean): TakeDepth {
  return useMemo(() => (enabled && frames.length > 0 ? computeHandDepth(frames, aspect) : EMPTY), [frames, aspect, enabled]);
}
