# Roadmap item 6: Recording schema v3 + Blender importer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A versioned, compact recording envelope (v3) that every demo's export/import goes through, with old v2 files still loading, export never blocking the UI for more than ~100 ms, and a real Blender importer that turns an exported take into moving Empties.

**Scope:** TDD-002 phases P1 to P3 only. P4 (face landmark stride) and P5 (armature bake, optional) are out of scope — Later per `PLANNING.md`.

**Architecture:** One new pure module (`components/shared/recordingSchema.ts`) owns the v3 envelope shape, rounding, world-mapping metadata, and `migrateV2`. `useRecorder.ts` calls it at the export/import boundary only — **the live `bufferRef` stays `FrameData[]`, unchanged**. This is a deliberate deviation from TDD-002's literal design (which assumes TDD-001 P2's `TrackedFrame` already landed and treats v3 as the in-memory shape too). Item 5 (`TrackedFrame`/`useTracker`) has not landed yet, so making v3 the live buffer would mean re-plumbing all three consumers (`MotionRecorder.tsx` reads `frame.leftHand`, `HandTelemetry.tsx` reads `frame.landmarks`, `FaceDemo.tsx` reads `frame.faceLandmarks`/`blendshapes`) inside this item. Keeping v3 at the boundary is the shortest diff that satisfies every P1-P3 gate, and item 5 can later replace `FrameData` wholesale without touching this module's public shape.

**Tech Stack:** React 18, Vite 6, vitest 5 (`environment: 'node'`, no DOM/Worker), TypeScript, Blender 4.x (`bpy`) for the importer.

**Spec:** `docs/tdd/TDD-002-recording-schema-and-export.md` phases 1-3. Build stamp: `__BUILD_STAMP__` (already defined in `vite.config.ts` from `build-stamp.json`, carries the short SHA — do not add a second `git rev-parse` define per the TDD's open question 2).

## Global Constraints

- Repo: `C:\Projects-local\Tool-PuppeteerLab`, branch `main`, commit directly to `main` (project convention). Do not push; the orchestrator pushes.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Windows. Use Bash tool with forward slashes; `npm` commands as written.
- Gates after every task: `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`. All must pass.
- No em dashes in any prose or comment.
- **Two of the three TDD gates are host-only and cannot be closed in this session:**
  - P1's "<100 ms for a synthetic 30 s hand take" IS vitest-verifiable (`performance.now` exists in Node; no DOM needed for the pure serialize path) — close it for real.
  - P2's "no long task over 100 ms in DevTools Performance" needs a real browser's Performance panel. Mark 🔌 wired after this session: build + smoke passing with the worker chunk present is the closest automatable proxy (per TDD's own risk note). Record as unverified in the same place items 1-4's camera checks are recorded.
  - P3's importer gate says "a real hand take recorded in Motion Recorder opens in Blender". This session has no camera. Verify against a **synthetic** v3 fixture file via the Blender MCP instead, and label the screenshot/doc explicitly as synthetic-file verified, not a real take. A real-take pass is still owed alongside the other camera checks.
- `fps` formula: `frameCount > 1 ? (frameCount - 1) / (durationMs / 1000) : 0`. Do NOT use `frameCount / durationMs * 1000` — n frames span n-1 intervals, and the TDD's own formula in prose is off-by-one.
- World mapping constants are verified against `hooks/useMediaPipe.ts:14-35` (`mapHandToWorld`), not copied from the TDD blindly: `GAME_X_RANGE=5, GAME_Y_RANGE=3.5, Y_OFFSET=0.8`, `worldZ = z * 8`, and note the X mirror (`worldX = (0.5 - x) * GAME_X_RANGE`) in a comment since it affects which physical hand appears on which side in Blender.

---

### Task 1: Envelope + compact serialization + measured fps; `migrateV2`; kinematics on new shape (TDD-002 P1)

**Files:**
- New: `components/shared/recordingSchema.ts`
- New: `components/shared/recordingSchema.test.ts`
- Modify: `hooks/useRecorder.ts` (`exportData`, `loadData` only; `bufferRef` shape unchanged)
- Modify: `types.ts` (add the v3 envelope types alongside, not replacing, `FrameData`/`RecordingSession`)

**Interfaces (`components/shared/recordingSchema.ts`):**
- `buildEnvelope(frames: FrameData[], type: TrackingType, opts: { durationMs: number; video?: {width:number;height:number} }): RecordingV3` — maps `FrameData[]` to the v3 `frames[]` shape (hands as `{side, score, landmarks, world}[]`, `face` from `faceLandmarks`/`blendshapes`), rounds normalized to 4dp / world to 3dp, computes `capture.fps` with the formula above, stamps `source.commit` from `__BUILD_STAMP__`.
- `buildKinematics(frames: FrameData[], type: TrackingType, durationMs: number): RecordingV3Kinematics` — same envelope, frames carry only `t`, per-hand `side`+`world`, `face.blendshapes`.
- `serializeV3(envelope: RecordingV3 | RecordingV3Kinematics): string` — `JSON.stringify(obj)`, no indentation.
- `migrateV2(json: unknown): FrameData[]` — returns data shaped for the EXISTING consumers (`FrameData[]`), not a v3 object. Handles all three v2 field patterns from the TDD: (a) `leftHand`/`rightHand` only (Motion Recorder files), (b) `landmarks` array with side inferred from array order (Hand Telemetry files, TDD note: "v2 stored no handedness"), (c) `faceLandmarks`/`blendshapes` (Face Puppet files). Detect v2 by `json.version === "2.0"` or `"2.0-kinematics"`; if `json.schema === "puppeteer-lab/recording"` treat as v3-in, extract back to `FrameData[]` the same way `buildEnvelope` built it (inverse mapping) so `loadData` has one code path regardless of which version was on disk.
- Also fold in the data-URL-to-blob-URL fix from the TDD's risk list here (`loadData` currently sets `audioElementRef.current.src = json.audioBase64` directly): convert via `fetch(dataUrl).then(r => r.blob())` then `URL.createObjectURL`, reusing the existing unmount cleanup's `startsWith('blob:')` guard.

- [ ] **Step 1: Write the failing tests** in `recordingSchema.test.ts`:
  - `buildEnvelope` + `serializeV3` round-trips a synthetic 2-hand frame (values within rounding tolerance: 4dp normalized, 3dp world).
  - `fps` formula: 60 frames over 1000ms at (say) a synthetic durationMs gives the expected non-off-by-one value; a 1-frame take gives fps 0, not NaN/Infinity.
  - `migrateV2` maps all three v2 field patterns above into valid `FrameData[]`.
  - A **v2 file from the repo's own previous build** (grab a real fixture: run the CURRENT `exportData('full')` shape against a synthetic buffer, or hand-construct one matching `RecordingSession` as it exists today) loads via `migrateV2` and produces frames the existing playback readers can consume (`frame.leftHand`, `frame.landmarks`, `frame.faceLandmarks`/`blendshapes` all present where the source had them).
  - Timing: `performance.now()` bracket around `buildEnvelope` + `serializeV3` for a synthetic 30 s **hand** take (≈1800 frames × 2 hands × 21 landmarks) is under 100 ms. (Do NOT test a face take here — P1 is intentionally synchronous; face takes are P2's problem.)
- [ ] **Step 2: Implement** `recordingSchema.ts` to pass the tests.
- [ ] **Step 3: Wire into `useRecorder.ts`**: `exportData('full')` builds+serializes v3 via the new module instead of the current `JSON.stringify(session, null, 2)`; `exportData('kinematics')` uses `buildKinematics`; `loadData` runs everything through `migrateV2`-or-passthrough so both v2 and v3 files load into the same `FrameData[]` buffer shape. `hasAudio`/`audioBase64` plumbing is unchanged (still lives outside the frames array).
- [ ] **Step 4: Gate.** `npm run typecheck && npm test && npm run build && npm run smoke`, all green. Confirm the new test file is picked up (`vitest.config.ts` includes `**/*.test.ts`).
- [ ] **Step 5: Commit.**

---

### Task 2: Worker serialization + fallback (TDD-002 P2)

**Files:**
- New: `components/shared/serialize.worker.ts`
- Modify: `hooks/useRecorder.ts` (`exportData('full')` and `exportData('kinematics')` dispatch through the worker when available)

**Interfaces:**
- `serialize.worker.ts`: `self.onmessage` receives `{ frames: FrameData[], type: TrackingType, kind: 'full'|'kinematics', durationMs: number, video?: {...} }`, calls the SAME `buildEnvelope`/`buildKinematics`/`serializeV3` from Task 1 (import them directly, do not duplicate logic), posts back `{ blob: Blob }` (or a transferable string it wraps into a Blob on the main thread — either is fine, pick whichever needs less structured-clone bookkeeping and say which in the commit message).
- Main thread: `new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' })`, `postMessage`s the raw `bufferRef.current` (structured clone; `THREE.Vector3` instances clone as plain objects with own `x`/`y`/`z` props, which `buildEnvelope` already reads via `.x`/`.y`/`.z` — confirm this in the implementation step, don't assume it, since a Vector3 also carries prototype methods that will NOT survive the clone).
- Fallback (Workers unavailable, or worker construction throws): chunked stringify on the main thread, yielding via `setTimeout(0)` every 500 frames, same `buildEnvelope`/`serializeV3` calls, just synchronous-in-chunks instead of off-thread.
- `exportData` becomes `async` (or returns a promise the caller can ignore, matching the existing fire-and-forget download pattern) since the worker path is inherently async. Callers (`RecorderControls.tsx` or wherever `exportData` is invoked from a button) need the `onClick` to just call it, not await a UI-blocking result.

- [x] **Step 1: Implement `serialize.worker.ts`** importing `buildEnvelope`/`buildKinematics`/`serializeV3` from Task 1's module.
- [x] **Step 2: Implement the fallback** chunked-stringify path as a plain async function in `recordingSchema.ts` (so it's unit-testable) that `useRecorder.ts` calls when `typeof Worker === 'undefined'` or the worker constructor throws.
- [x] **Step 3: Wire `exportData` in `useRecorder.ts`** to try the worker first, fall back on construction failure, and trigger the same `<a download>` flow once the Blob comes back.
- [x] **Step 4: Gate.** `npm run typecheck && npm test && npm run build && npm run smoke`. Specifically confirm: `npm run build` emits the worker as its own chunk (Vite's `new URL(..., import.meta.url)` pattern) and `npm run smoke` does not choke on the new chunk's filename or content (check `scripts/smoke.mjs`'s assertions before assuming this is silently fine).
  - All four green: typecheck clean, 62/62 tests, build emits `dist/assets/serialize.worker-*.js` (4.11 kB) as its own chunk, smoke passes (14 JS assets, no secret leak, vendored assets + stamp present).
- [x] **Step 5: Record as 🔌 wired, not ✅ verified**, in this plan and in `HANDOFF.md`'s host-verification checklist: the actual "no long task over 100 ms" claim needs DevTools Performance in a real browser tab, which this session cannot run (same camera-preview gap as items 1-4).
  - 🔌 **P2 wired, not host-verified.** Automatable proxy is green (build + smoke with the worker chunk present, per this plan's Global Constraints note). The DevTools Performance "no long task over 100 ms" claim itself is unverified pending a real browser tab; recorded in `HANDOFF.md`'s host-verification checklist alongside items 1-4's camera checks.
- [x] **Step 6: Commit.**

**Design notes (decisions the brief left open):**
- Worker posts back a `Blob` (built from an already-serialized JSON string), not a transferable string: this keeps the "wrap into a Blob" step in exactly one place (the worker and the main-thread fallback both hand `useRecorder.ts` a `Blob` directly), and a `Blob` built from a string structured-clones as cheaply as the string itself.
- The worker request/response shape is extended beyond the brief's literal `{ frames, type, kind, durationMs, video? }` with an optional `audio?: RecordingV3Audio` field, and `SerializeResponse` uses a string-literal `status: 'ok' | 'error'` discriminant, not `ok: true | false`. Both are recorded with reasoning in `recordingSchema.ts`'s comments and in the task report.
- `exportData('full')` still does `parseDataUrl(audioBase64Ref.current)` synchronously on the main thread (unchanged, cheap), then passes the already-parsed `{ mimeType, base64 }` into the worker/fallback request so `envelope.audio` gets attached before the one expensive `serializeV3` call, instead of re-parsing or re-stringifying on the main thread after the fact. `kind: 'kinematics'` never carries audio (matches `RecordingV3Kinematics` having no `audio` field).
- The chunked fallback (`serializeV3Chunked` in `recordingSchema.ts`) chunks the frame-mapping loop (yields via `setTimeout(0)` every 500 frames, reusing the same private `mapFrameHands`/`mapFrameFace`/`measureFps`/`WORLD_META` helpers `buildEnvelope`/`buildKinematics` use), not `serializeV3` itself, since `JSON.stringify` has no yield points. `capture.fps`/`capture.frameCount` are computed once against the whole `frames.length`/`durationMs` after the loop, not per-chunk, so they can't drift from what `buildEnvelope`/`buildKinematics` would report for the same input (covered by a test at the exact 500-frame chunk boundary and again at 1200 frames/two yields).

---

### Task 3: Blender importer + doc with screenshot (TDD-002 P3)

**Files:**
- New: `tools/blender_import_recording.py`
- New: `docs/blender-importer.md` (short doc, coordinate-axis note, screenshot)
- New (test fixture, not committed to `tools/`): a synthetic v3 JSON used only for host verification via the Blender MCP — write it to the scratchpad, not the repo, unless it's useful as a checked-in fixture for a future automated test (call this out as an option, not a requirement).

**Design (from the TDD, do not deviate without a reason recorded here):**
1. Read the JSON, check `schema`/`version`.
2. `scene.render.fps = round(capture.fps)`, `scene.frame_end = round(durationMs / 1000 * fps)`.
3. Per side present: Empty `Hand.R` / `Hand.L`, 21 child Empties `Hand.R.00`..`Hand.R.20` (small spheres for visibility).
4. Per frame: each child's `location` from `world[i]`, keyframed at `round(t / 1000 * fps)`. Axis remap Y-up (app) to Z-up (Blender): `(x, y, z) -> (x, -z, y)`.
5. If `channels` includes `face`: `Face` empty with a custom property per blendshape, keyframed. Landmark empties for the face default OFF (478 empties is heavy).
6. If `audio` present: write `<name>.webm` next to the JSON, add as a Sound strip in the Sequencer at frame 1.
7. Draw an axis triad at the origin (per the TDD's risk note on handedness) so the doc can show which way "toward the camera" points.

- [ ] **Step 1: Write the script** as a single `bpy` module runnable both from Blender's Text Editor and headless (`blender --python tools/blender_import_recording.py -- take.json`). Keep JSON parsing/math (steps that don't need `bpy`) in plain functions so they're at least statically checkable outside Blender, but do not add a Python test harness for this session's scope — the gate is the host check, not a unit-test suite.
- [ ] **Step 2: Build a synthetic v3 fixture** (2 hands, ~2-3 seconds, a simple motion like one hand rising) matching the exact shape `recordingSchema.ts` produces (Task 1) so the importer is tested against the real envelope, not a hand-typed guess.
- [ ] **Step 3: Host-verify via the Blender MCP.** Run the importer against the synthetic fixture (`execute_blender_code`, loading the script's functions or running it as `--python ... -- <path>` equivalent through the MCP's execution tool), confirm: Empties created, keyframes present at the expected frame numbers, `location` at frame N matches `world[N]` after the axis remap, and — per the orientation risk — the hand labeled `right` in the JSON appears in the position/side you'd expect given the mirror in `mapHandToWorld`. Render a viewport screenshot (`render_viewport_to_path` or `get_screenshot_of_window_as_image`), save under `docs/`.
- [ ] **Step 4: Write `docs/blender-importer.md`**: how to run it (Text Editor and CLI forms), the axis-remap note, the mirror/orientation note, the screenshot, and an explicit line that this was verified against a synthetic fixture, not a live Motion Recorder take (camera unavailable this session) — cross-reference the same open item in `HANDOFF.md`.
- [ ] **Step 5: Gate.** `npm run typecheck && npm test && npm run build && npm run smoke` still green (no JS changed by this task, but confirm nothing else regressed). Screenshot committed under `docs/`.
- [ ] **Step 6: Commit.**

---

## Final review

After all three tasks: one whole-diff review (per project convention) checking specifically:
1. `bufferRef` in `useRecorder.ts` is still `FrameData[]` end to end (the documented deviation held).
2. `migrateV2` round-trips all three v2 field patterns AND a v3-in file, without special-casing call sites in the three demo components.
3. The fps formula matches what's written in this plan, not the TDD's prose off-by-one.
4. `HANDOFF.md` and `PLANNING.md` correctly show item 6 as code-complete with P2's long-task claim and P3's real-take claim marked unverified/host-pending, consistent with items 1-4.
