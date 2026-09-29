/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure camera/tracker support used by useTracker: facing resolution, readable
 * camera errors, and the GPU->CPU landmarker fallback.
 */
export type Facing = 'user' | 'environment';
export type Delegate = 'GPU' | 'CPU';

/** The facing the stream really has. `ideal` constraints can silently return the other camera, so the track's own report wins. */
export function resolveFacing(requested: Facing, reported: string | undefined): Facing {
  if (reported === 'user' || reported === 'environment') return reported;
  return requested;
}

/** One human sentence per getUserMedia failure. */
export function describeCameraError(err: unknown): string {
  const name = (err as { name?: string } | null | undefined)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow camera access for this site (on iPhone: the aA menu > Website Settings > Camera) and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy or unavailable. Close other apps that use it and try again.';
    case 'TypeError':
      // navigator.mediaDevices is undefined on non-https pages.
      return 'This browser blocked camera access here. The camera only works on a secure (https) page.';
    default:
      return 'Could not start the camera.';
  }
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
