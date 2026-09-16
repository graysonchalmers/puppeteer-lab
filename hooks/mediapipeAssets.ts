/**
 * One place for MediaPipe asset locations. Default is the vendored copy under
 * public/ (offline). Set VITE_MEDIAPIPE_CDN=1 to fall back to the CDNs.
 */
const CDN = Boolean(import.meta.env.VITE_MEDIAPIPE_CDN);

export const MEDIAPIPE_WASM_PATH = CDN
  ? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm'
  : '/mediapipe/wasm';

export const HAND_MODEL_PATH = CDN
  ? 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
  : '/mediapipe/models/hand_landmarker.task';

export const FACE_MODEL_PATH = CDN
  ? 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
  : '/mediapipe/models/face_landmarker.task';
