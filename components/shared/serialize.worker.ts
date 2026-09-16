/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Off-main-thread frames -> v3 envelope -> JSON.stringify (TDD-002 P2).
 * Imports the SAME buildEnvelope/buildKinematics/serializeV3 Task 1 wrote for
 * the main thread; this file only adds the postMessage/onmessage boundary
 * around them, it does not duplicate their logic.
 *
 * Posts back a ready-to-download Blob (not a bare string): the caller in
 * hooks/useRecorder.ts needs a Blob either way (for the `<a download>` flow),
 * and constructing it here means the worker path and the main-thread chunked
 * fallback in recordingSchema.ts both hand useRecorder.ts the same shape.
 * A Blob built from an already-serialized string structured-clones as cheaply
 * as the string itself (same underlying bytes), so this costs nothing extra.
 *
 * No `lib: ["webworker"]` in tsconfig.json (this repo has one shared
 * tsconfig with `lib: ["DOM", ...]` for the whole project, and DOM + webworker
 * conflict if both are referenced). `self.onmessage` / `self.postMessage`
 * are typed loosely enough via the DOM `Window` lib (bare `any` payloads,
 * `postMessage(message, options?)` accepts a single argument) that this
 * still typechecks correctly for a worker's actual runtime shape.
 */
import { buildEnvelope, buildKinematics, serializeV3, SerializeRequest, SerializeResponse } from './recordingSchema';
import { RecordingV3, RecordingV3Kinematics } from '../../types';

self.onmessage = (event: MessageEvent<SerializeRequest>) => {
    const { frames, type, kind, durationMs, video, audio } = event.data;

    try {
        let envelope: RecordingV3 | RecordingV3Kinematics;
        if (kind === 'kinematics') {
            envelope = buildKinematics(frames, type, durationMs);
        } else {
            const full = buildEnvelope(frames, type, { durationMs, video });
            if (audio) full.audio = audio;
            envelope = full;
        }

        const json = serializeV3(envelope);
        const blob = new Blob([json], { type: 'application/json' });
        const response: SerializeResponse = { status: 'ok', blob };
        self.postMessage(response);
    } catch (err) {
        const response: SerializeResponse = { status: 'error', error: err instanceof Error ? err.message : String(err) };
        self.postMessage(response);
    }
};
