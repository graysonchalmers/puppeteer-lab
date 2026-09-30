/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure camera/tracker support used by useTracker: facing resolution, readable
 * camera errors, and the GPU->CPU landmarker fallback.
 */
import { buildCameraIssue, classifyCameraError, issueSentence } from './cameraAccess';

export type Facing = 'user' | 'environment';
export type Delegate = 'GPU' | 'CPU';

/** The facing the stream really has. `ideal` constraints can silently return the other camera, so the track's own report wins. */
export function resolveFacing(requested: Facing, reported: string | undefined): Facing {
  if (reported === 'user' || reported === 'environment') return reported;
  return requested;
}

/** One human sentence per getUserMedia failure (title + message; steps live on the structured CameraIssue). */
export function describeCameraError(err: unknown): string {
  return issueSentence(buildCameraIssue(classifyCameraError(err)));
}

/** Try the GPU delegate, then the CPU one. If both fail the CPU error is what the caller sees. */
export async function createWithDelegateFallback<T>(
  create: (delegate: Delegate) => Promise<T>,
  onFallback?: (gpuError: unknown) => void
): Promise<{ value: T; delegate: Delegate }> {
  try {
    return { value: await create('GPU'), delegate: 'GPU' };
  } catch (gpuError) {
    onFallback?.(gpuError);
    return { value: await create('CPU'), delegate: 'CPU' };
  }
}
