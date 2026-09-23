/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Builds a synthetic Face Puppet take from MediaPipe's canonical face so the
 * renderer can be screenshot-verified in a browser with no camera (Import ->
 * Play). Output is a v2 "2.0" FACE file (FrameData verbatim), which
 * useRecorder.loadData migrates. Not a substitute for a real take.
 *
 * Run: node tools/make-synthetic-take.mjs [--hands]
 */
import fs from 'node:fs';

const withHands = process.argv.includes('--hands');
const V = fs.readFileSync('tools/data/canonical_face_model.obj', 'utf8').split('\n')
  .filter((l) => l.startsWith('v '))
  .map((l) => l.trim().split(/\s+/).slice(1, 4).map(Number));

const FPS = 20, SECONDS = 3, KX = 0.022, KY = KX * (4 / 3);
// --hands only: inclusive frame indices with no face (a hand over the face)
// while the hands keep moving, so hands-only capture is verifiable camera-less.
const FACE_DROPOUT = [36, 51];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const UPPER_LIPS = [191, 80, 81, 82, 13, 312, 311, 310, 415];
const LOWER_LIPS = [95, 88, 178, 87, 14, 317, 402, 318, 324];
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// Precompute lip Y adjustments: move each pair to midpoint Y at rest
const lipAdjustY = {};
for (let i = 0; i < UPPER_LIPS.length; i++) {
  const u = UPPER_LIPS[i];
  const l = LOWER_LIPS[i];
  const yMid = (V[u][1] + V[l][1]) / 2;
  lipAdjustY[u] = yMid;
  lipAdjustY[l] = yMid;
}

// Open hand in hand units (wrist at origin, y up), 21 MediaPipe hand points.
const HAND = [[0,0],[-0.35,0.25],[-0.6,0.5],[-0.8,0.7],[-0.95,0.9],
  [-0.25,0.9],[-0.3,1.3],[-0.33,1.55],[-0.35,1.75],
  [0,0.95],[0,1.4],[0,1.7],[0,1.9],
  [0.22,0.9],[0.26,1.3],[0.28,1.55],[0.3,1.72],
  [0.4,0.8],[0.5,1.1],[0.56,1.3],[0.6,1.45]];
const hand = (cx, cy, size, tilt) => HAND.map(([x, y], i) => {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { x: r4(cx + (x * c - y * s) * size), y: r4(cy - (x * s + y * c) * size * (4 / 3)), z: r4(-0.02 * (i % 4)) };
});

const frames = [];
for (let f = 0; f < FPS * SECONDS; f++) {
  const t = f / FPS;
  const open = Math.max(0, Math.sin(t * Math.PI * 1.4));  // jaw 0..1
  const yaw = (12 * Math.PI / 180) * Math.sin((t / SECONDS) * Math.PI * 2);
  const pts = V.map(([x, y, z], idx) => {
    // Adjust Y for lip pairs (move to midpoint before jaw displacement)
    const y1 = lipAdjustY[idx] !== undefined ? lipAdjustY[idx] : y;
    // Compute jaw weight from ORIGINAL y (not adjusted)
    const w = Math.max(0, Math.min(1, (-4.2 - y) / 0.8)); // below the mouth line
    // Apply jaw displacement to the adjusted Y
    const y2 = y1 - open * 1.2 * w;
    const x2 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z2 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return { x: r4(0.5 + x2 * KX), y: r4(0.45 - y2 * KY), z: r4(-z2 * KX) };
  });
  const center = (ring) => ({
    x: r4(ring.reduce((s, i) => s + pts[i].x, 0) / ring.length),
    y: r4(ring.reduce((s, i) => s + pts[i].y, 0) / ring.length),
    z: 0,
  });
  for (let i = 468; i < 473; i++) pts[i] = center(LEFT_EYE);
  for (let i = 473; i < 478; i++) pts[i] = center(RIGHT_EYE);

  // First mouth cycle: lips part, jaw stays low (teeth together). Second: jaw opens (teeth apart).
  const jawOpen = t < 1 ? 0.05 : open;
  // Brows up for the first half, down for the second (drives the brow boost).
  const brow = Math.sin((t / SECONDS) * Math.PI * 2);
  const up = r4(Math.max(0, brow)), down = r4(Math.max(0, -brow));
  // Half-closed eyes around 1.2 s, a full blink around 2.5 s (drives Blink Boost).
  const blink = t > 1.1 && t < 1.3 ? 0.5 : t > 2.4 && t < 2.6 ? 1 : 0;
  const frame = {
    timestamp: Math.round(t * 1000), faceLandmarks: pts,
    blendshapes: { jawOpen: r4(jawOpen), browInnerUp: up, browOuterUpLeft: up, browOuterUpRight: up, browDownLeft: down, browDownRight: down, eyeBlinkLeft: blink, eyeBlinkRight: blink },
  };
  if (withHands) {
    const wave = Math.sin(t * Math.PI * 2) * 0.35;
    frame.landmarks = [hand(0.22, 0.78, 0.1, wave), hand(0.78, 0.78, 0.1, -wave)];
    if (f >= FACE_DROPOUT[0] && f <= FACE_DROPOUT[1]) {
      delete frame.faceLandmarks; // omit BOTH face keys, as live capture does
      delete frame.blendshapes;
    }
  }
  frames.push(frame);
}

fs.mkdirSync('tools/fixtures', { recursive: true });
const name = withHands ? 'synthetic-face-hands-take.json' : 'synthetic-face-take.json';
fs.writeFileSync(`tools/fixtures/${name}`, JSON.stringify({ version: '2.0', type: 'FACE', duration: SECONDS, frames }));
console.log(`tools/fixtures/${name}: ${frames.length} frames`);
