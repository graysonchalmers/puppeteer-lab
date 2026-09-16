# TDD-004: Offline-first: vendor MediaPipe, build Tailwind, local audio

| | |
|---|---|
| Status | Proposed (2026-09-06) |
| Serves | The demo itself (every verb; nothing runs if tracking cannot start) |
| Teardown finding | F5 (four runtime CDN dependencies) |
| Effort | S to M (three small independent pieces) |
| Depends on | nothing; independent of TDD-001 through 003 |

## Problem

The built app is static, but starting it needs four networks to answer:

| Dependency | Where | What breaks without it |
|---|---|---|
| Tailwind play CDN (`cdn.tailwindcss.com`) | `index.html:10` | Every screen renders unstyled; the CDN also prints a "not for production" warning and re-JITs classes on each load |
| MediaPipe WASM (`cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm`) | `useMediaPipe.ts:79`, `useFaceTracker.ts:25` | Tracking never initializes; the demo sits at "Starting Camera Tracking..." |
| MediaPipe models (`storage.googleapis.com/mediapipe-models/...`, roughly 8 MB hands + 4 MB face) | `useMediaPipe.ts:86`, `useFaceTracker.ts:32` | Same |
| Tempo Strike song (`commondatastorage.googleapis.com/codeskulptor-demos/...`) | `constants.ts:27` | Start Game fails on `audio.play()` |

Friend-demos happen on other people's wifi, in offices with URL filters, and on captive portals. The North Star says offline by default.

## Goals

1. `npm run build` produces a `dist/` that runs with the network cable unplugged.
2. The smoke test fails if `dist/` references a CDN.
3. `npm run dev` also works offline after the first `npm install`.

## Non-goals

- A service worker or PWA install. Static files served from disk or any static host is enough.
- Replacing MediaPipe. Same package, same version, same models; only where they are loaded from changes.
- Tailwind v4 migration. v3 keeps the play CDN's defaults, so the visual diff is zero.

## Design

### MediaPipe WASM and models

- `scripts/vendor-assets.mjs`, run on `postinstall` and as the first step of `npm run build`:
  - Copies `node_modules/@mediapipe/tasks-vision/wasm/*` (the `vision_wasm_internal.*` and `vision_wasm_nosimd_internal.*` files) to `public/mediapipe/wasm/`. Copying from `node_modules` at build time means the vendored WASM always matches the pinned package version.
  - Downloads the two `.task` models into `public/mediapipe/models/` if missing, from the current URLs, with the version segment pinned (`float16/1`). Prints sizes and a SHA-256 for the log.
- Commit the models. Rationale: public repo, about 12 MB total, well under GitHub's limits, and a fresh clone that works offline is the point. If the repo ever grows past comfort, move them to Git LFS; do not go back to CDN.
- One module owns the paths (`core/tracker/assets.ts` or, today, `hooks/mediapipeAssets.ts`):

  ```ts
  export const MEDIAPIPE_WASM_PATH = import.meta.env.VITE_MEDIAPIPE_CDN
    ? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm'
    : '/mediapipe/wasm';
  export const HAND_MODEL_PATH = ... '/mediapipe/models/hand_landmarker.task';
  export const FACE_MODEL_PATH = ... '/mediapipe/models/face_landmarker.task';
  ```

  The env override keeps a CDN mode for the day the repo is hosted somewhere that objects to 12 MB of static files.
- Vite serves `public/` verbatim in dev and copies it into `dist/` on build, with the right MIME for `.wasm`. `tasks-vision` does not need `SharedArrayBuffer`, so no COOP/COEP headers.

### Tailwind

- Add `tailwindcss@3`, `postcss`, `autoprefixer` as dev dependencies; `tailwind.config.js` with `content: ['./index.html', './**/*.{ts,tsx}']` and `node_modules`/`dist` excluded; `postcss.config.js` with the two plugins.
- `index.css` gets `@tailwind base; @tailwind components; @tailwind utilities;` (it is empty today and already linked from `index.html`).
- Remove the `<script src="https://cdn.tailwindcss.com">` line.
- Every arbitrary-value class in use (`bg-[#090A0C]`, `text-[10px]`, `shadow-[0_0_20px_...]`, `min-h-[32px]`) is supported by v3 JIT unchanged. Expect the built CSS around 20 to 40 KB.

### Tempo Strike audio

The song must be license-clean and local. Three options, in preference order:

1. **Synthesize the beat** with WebAudio at 140 BPM (kick on the beat, hat on the off-beat, a simple bass pattern). No file, no license, always in sync with `SONG_BPM`, and the chart generator already assumes a constant BPM. About 60 lines in `audio/beatTrack.ts`. This is the default.
2. Drop a CC0 140 BPM loop into `public/audio/` (OpenGameArt or freesound, license noted in `public/audio/LICENSE.txt`). Nicer to listen to; do it later if wanted.
3. Keep the codeskulptor URL as a fallback behind the same env flag as the CDN mode. Not the default.

`RhythmGame` awaits `audioRef.current.play()`; with option 1 it awaits `AudioContext.resume()` instead and the song-end condition comes from the chart's last note plus a tail.

### Smoke probe

`scripts/smoke.mjs` gains a fourth check: fail if any file under `dist/` contains `cdn.tailwindcss.com`, `cdn.jsdelivr.net`, or `storage.googleapis.com`, unless `SMOKE_ALLOW_CDN=1` (CDN mode builds).

## Phases and gates

| Phase | Work | Effort | Gate (binary) |
|---|---|---|---|
| 1 | `vendor-assets.mjs`, local WASM and model paths, `assets.ts` with env override | S | With DevTools Network set to Offline after the first page load, every demo initializes tracking. `dist/` contains `mediapipe/wasm` and `mediapipe/models`. |
| 2 | Tailwind v3 via PostCSS; delete the CDN script | S | Screenshot of the hub before and after shows no visual difference; `dist/` has no `cdn.tailwindcss.com`; the console no longer prints the play-CDN warning. |
| 3 | Synthesized beat track; `SONG_URL` removed | S | Tempo Strike starts and ends offline; hits still line up with the beat by ear. |
| 4 | Smoke probe | S | CI green with the probe; flipping one path back to a CDN URL makes CI red. |

## Test plan

Pure: the smoke probe is itself the test. `vendor-assets.mjs` gets a dry-run flag that lists what it would copy.

Host-verified: full offline run of all five demos from `npm run preview` with the network disabled.

## Risks

- **Repo size** grows by about 12 MB. Accepted in ADR-0001; noted in the README.
- **Model URL drift.** Google has moved model paths before. The download step is pinned and the models are committed, so drift only matters when re-vendoring on purpose.
- **Tailwind content globbing** must include `index.html` and every `.tsx`, or classes silently vanish. The before/after screenshot gate catches it.
- **Synthesized audio taste.** A click track is less fun than a song. Option 2 exists for that; it is a drop-in file.

## Open questions

1. Commit the `.task` models, or gitignore them and rely on `postinstall`? Proposal: commit them. A clone that needs a network step to work offline defeats the purpose.
2. Keep CDN mode at all? Proposal: yes, behind one env flag, because it costs one ternary and keeps the door open for a hosted demo on a static host with size limits.
