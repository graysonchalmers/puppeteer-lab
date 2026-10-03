# Take Cleanup and Orbit Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive playback cleanup layer (zero-phase smoothing plus short-gap fill) and an orbit camera with size-based hand depth to Face Puppet playback and the `/t/<id>` share viewer.

**Architecture:** Phase 1 is pure, node-testable modules (`series`, `handTracks`, `cleanTake`) behind a memoizing React hook and a small options bar. Phase 2 adds a pure depth/placement module (`handDepth`), a pure orbit-state module, and a second (perspective) camera in `PuppetScene` selected only when a view is passed; the default ortho render path is untouched. Raw frames are never mutated; export and upload keep using raw frames.

**Tech Stack:** TypeScript, React 18, three 0.167, vitest 5 (`environment: 'node'`, tests are `*.test.ts` colocated, no jsdom), Playwright 1.63 for browser gates.

**Spec:** `docs/superpowers/specs/2026-10-02-take-cleanup-and-orbit-design.md` (committed `0428e73`). Executors read both.

## Global Constraints

- Cleanup is **off by default**; the choice is remembered per viewer in `localStorage` (every access wrapped in try/catch). Default strength **0.5**.
- Gap cap **300 ms** (`DEFAULT_MAX_GAP_MS`). Longer gaps stay absent. No extrapolation: leading and trailing absence is never filled.
- `strength = 0` skips the smoothing pass; any `strength > 0` uses `faceSmoothingToMinCutoff(strength)` with `FACE_ONE_EURO_DEFAULTS.beta` from `components/shared/oneEuro.ts`.
- Raw frames are never mutated. Export (`buildRecordingBlob`, video, pack) and share upload keep using the raw frames.
- No schema change. No new npm dependency (custom orbit input, no OrbitControls).
- Depth constants (verbatim from the spec): face landmarks 234 to 454 are about **14.5 cm**; hand landmarks 0 to 9 are about **9.5 cm**; `r = 0.655 * faceSize / handSize` (implemented as `9.5 / 14.5`), clamped to **[0.25, 1.3]**; fallback with no face is **0.7**; assumed horizontal FOV **63 degrees**, `f = (drawW / 2) / tan(31.5 deg)`.
- Placement: `(cx + r*(x - cx), cy + r*(y - cy), f*(1 - r) + r*z)` in scene units. `r = 1` is the identity; the default (ortho) view must stay pixel-identical to today.
- Orbit limits: yaw plus or minus **75 degrees**, pitch plus or minus **40 degrees**, zoom multiplier **0.5 to 2**. `touch-action: none` only while orbit is on.
- Every new `.ts`/`.tsx`/`.mjs` file starts with the repo's license header (`@license` / `SPDX-License-Identifier: Apache-2.0` block comment).
- Tests colocate as `*.test.ts` next to the module. React hooks/components cannot be unit-tested here (node environment): keep logic in pure modules and cover UI with the Playwright gates.
- Commits go straight to `main` (this repo's workflow), not pushed. Each commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run commands from `C:\Projects-local\Tool-PuppeteerLab`. Before running any browser gate, run the stale-only reaper if the machine is low on RAM: `. "C:\Projects-local\_agent-commons\tools\Stop-NodeHogs.ps1"; Invoke-NodeHogReaper -Force`.

## Spec clarifications decided while planning (flag these at review)

1. **Memoization lives in the hook** (`useMemo` keyed on frames identity, a version string, enabled and strength), not in a `WeakMap` inside `cleanTake`. The recorder's buffer array is mutated in place while recording, so an identity-keyed cache inside the pure function would go stale.
2. **Orbit front pose = the capture camera**, not a fixed 35 degree FOV: perspective camera at distance `f` from the face plane with `fovY = 2*atan((stageH/2)/f)`. The spec's invariant (hands reproject to their captured position) only holds for that pose, and it supersedes the approximate 35 degree figure.
3. **Orbit browser gate lives in a new `scripts/orbit-check.mjs`** (Chromium desktop, plus a WebKit iPhone drag section), not inside `phone-check.mjs`. `phone-check` needs a live camera flow and is RAM-flaky; the viewer with a mocked `/api/takes/<id>` is deterministic.
4. **Length cap:** a take whose resampled grid would exceed `MAX_GRID_SLOTS = 6000` samples (100 s at 60 fps) is returned unchanged with `report.skipped = true`, and the UI says "Take too long to clean up". The spec only flagged memory as a risk; this bounds it.
5. **A total dropout longer than 300 ms** becomes an empty frame (no face, no hands) under cleanup, instead of the raw take's freeze on the last frame. The raw view (switch off) still shows the freeze.

## Review Focus

Inputs and conditions the spec implies but does not enumerate, most likely first, each pinned by a test in the named task:

1. Degenerate takes (0, 1 or 2 frames, duplicate timestamps, `dt = 0`): `cleanTake` returns the input frames, no NaN, no throw. (Task 3)
2. Hands-only and face-only takes, and frames with no `landmarks`/`faceLandmarks`/`blendshapes` keys at all: no throw, output has only the channels the input had. (Task 3)
3. A take longer than the grid cap: returned unchanged, `report.skipped`, label says so. (Tasks 3, 4)
4. Cleanup toggled during playback or scrubbed to the end: the cleaned grid spans the same first-to-last time, so frame lookup stays valid and the clock does not jump. (Task 3)
5. Orbit with a degenerate hand (all 21 landmarks collapsed) or a zero-width face: every `r` is finite and inside `[0.25, 1.3]` or the 0.7 fallback, never NaN or Infinity in the scene. (Task 7)

---

# Phase 1: cleanup layer

### Task 1: Numeric channel primitives (`series.ts`)

**Files:**
- Create: `components/shared/series.ts`
- Test: `components/shared/series.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `interface Channel { data: Float64Array; present: Uint8Array; n: number; dim: number }`
  - `makeChannel(n: number, dim: number): Channel`
  - `interface GapStats { filled: number; left: number; filledSamples: number }`
  - `medianDt(timestamps: number[]): number` (median of positive intervals, `0` when there is none)
  - `fillGaps(ch: Channel, dtMs: number, maxGapMs: number, opts?: { linear?: boolean; clamp01?: boolean }): GapStats` (mutates `ch`)
  - `interface SmoothParams { minCutoff: number; beta: number }`
  - `smoothZeroPhase(ch: Channel, dtMs: number, p: SmoothParams, opts?: { breakBetween?: (prev: number, next: number) => boolean; clamp01?: boolean }): void` (mutates `ch`)

- [ ] **Step 1: Write the failing test**

Create `components/shared/series.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { makeChannel, fillGaps, smoothZeroPhase, medianDt, Channel } from './series';

const DT = 20;

const chan = (values: (number | null)[], dim = 1): Channel => {
  const ch = makeChannel(values.length, dim);
  values.forEach((v, i) => {
    if (v !== null) {
      ch.present[i] = 1;
      ch.data[i * dim] = v;
    }
  });
  return ch;
};

const closeAll = (actual: ArrayLike<number>, expected: number[], digits = 9) =>
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits));

describe('medianDt', () => {
  it('is the median positive interval', () => expect(medianDt([0, 20, 40, 100, 120])).toBe(20));
  it('is 0 when there is no positive interval', () => {
    expect(medianDt([5])).toBe(0);
    expect(medianDt([5, 5, 5])).toBe(0);
    expect(medianDt([])).toBe(0);
  });
});

describe('fillGaps', () => {
  it('reconstructs a straight line exactly across a short gap', () => {
    const ch = chan([0, 1, 2, null, null, null, 6, 7, 8]);
    const s = fillGaps(ch, DT, 300);
    closeAll(ch.data, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(ch.present)).toEqual(Array(9).fill(1));
    expect(s).toEqual({ filled: 1, left: 0, filledSamples: 3 });
  });

  it('bridges a curved gap near a sine peak within 3 percent', () => {
    const n = 50;
    const truth = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / 50));
    const ch = chan(truth.map((v, i) => (i >= 10 && i <= 14 ? null : v)));
    fillGaps(ch, DT, 300);
    for (let i = 10; i <= 14; i++) expect(Math.abs(ch.data[i] - truth[i])).toBeLessThan(0.03);
  });

  it('leaves a gap longer than maxGapMs absent and counts it', () => {
    const values: (number | null)[] = [0, 1, ...Array(20).fill(null), 22, 23];
    const ch = chan(values);
    const s = fillGaps(ch, DT, 300); // span 21 samples = 420 ms
    expect(s).toEqual({ filled: 0, left: 1, filledSamples: 0 });
    expect(ch.present[5]).toBe(0);
  });

  it('never fills leading or trailing absence', () => {
    const ch = chan([null, null, 3, 4, null, null]);
    const s = fillGaps(ch, DT, 300);
    expect(Array.from(ch.present)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(s).toEqual({ filled: 0, left: 0, filledSamples: 0 });
  });

  it('clamps to 0..1 when asked', () => {
    // neighbour slopes make the cubic overshoot to 1.75 at the middle of the gap
    const ch = chan([0, 1, null, null, 1, 0]);
    fillGaps(ch, DT, 300, { clamp01: true });
    for (let i = 0; i < 6; i++) expect(ch.data[i]).toBeLessThanOrEqual(1);
  });

  it('linear mode ignores neighbour slopes', () => {
    const ch = chan([0, 1, null, null, 1, 0]);
    fillGaps(ch, DT, 300, { linear: true });
    closeAll(ch.data, [0, 1, 1, 1, 1, 0]);
  });

  it('fills every dimension of a multi-dim channel', () => {
    const ch = makeChannel(5, 2);
    [0, 1, 4].forEach((i) => {
      ch.present[i] = 1;
      ch.data[i * 2] = i;
      ch.data[i * 2 + 1] = 10 + i;
    });
    fillGaps(ch, DT, 300, { linear: true });
    expect(ch.data[2 * 2]).toBeCloseTo(2);
    expect(ch.data[2 * 2 + 1]).toBeCloseTo(12);
  });
});

describe('smoothZeroPhase', () => {
  const sine = (n: number, period: number) => Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / period));
  const argmax = (a: ArrayLike<number>, lo: number, hi: number) => {
    let best = lo;
    for (let i = lo; i < hi; i++) if (a[i] > a[best]) best = i;
    return best;
  };
  const P = { minCutoff: 3, beta: 0 };

  it('keeps the peak in place while a causal pass of the same filter lags', () => {
    const x = sine(250, 40); // peaks at 10 + 40k
    const ch = chan(x);
    smoothZeroPhase(ch, DT, P);
    expect(argmax(ch.data, 110, 150)).toBe(130);

    const r = 2 * Math.PI * P.minCutoff * (DT / 1000);
    const a = r / (r + 1);
    const causal = [x[0]];
    for (let i = 1; i < x.length; i++) causal.push(causal[i - 1] + a * (x[i] - causal[i - 1]));
    expect(argmax(causal, 110, 150)).toBeGreaterThan(130);
  });

  it('reduces noise on a slow signal', () => {
    let s = 12345;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s / 2147483648) * 2 - 1;
    };
    const truth = sine(400, 200);
    const noisy = truth.map((v) => v + 0.1 * rnd());
    const ch = chan(noisy);
    smoothZeroPhase(ch, DT, P);
    const rms = (xs: ArrayLike<number>) => Math.sqrt(Array.from(xs).reduce((a, b) => a + b * b, 0) / xs.length);
    const errBefore = rms(noisy.map((v, i) => v - truth[i]));
    const errAfter = rms(Array.from(ch.data).map((v, i) => v - truth[i]));
    expect(errAfter).toBeLessThan(0.7 * errBefore);
  });

  it('does not bleed across an absent run', () => {
    const ch = chan([...Array(20).fill(5), ...Array(5).fill(null), ...Array(20).fill(1)]);
    smoothZeroPhase(ch, DT, { minCutoff: 2, beta: 0 });
    for (let i = 25; i < 45; i++) expect(ch.data[i]).toBeCloseTo(1, 9);
    for (let i = 0; i < 20; i++) expect(ch.data[i]).toBeCloseTo(5, 9);
  });

  it('breakBetween splits a segment so a step is not smeared', () => {
    const ch = chan([...Array(10).fill(0), ...Array(10).fill(1)]);
    smoothZeroPhase(ch, DT, { minCutoff: 2, beta: 0 }, { breakBetween: (_a, b) => b === 10 });
    expect(ch.data[9]).toBeCloseTo(0, 9);
    expect(ch.data[10]).toBeCloseTo(1, 9);
  });

  it('smoothing without a break does smear the same step (so the break test discriminates)', () => {
    const ch = chan([...Array(10).fill(0), ...Array(10).fill(1)]);
    smoothZeroPhase(ch, DT, { minCutoff: 2, beta: 0 });
    expect(ch.data[9]).toBeGreaterThan(0.05);
  });

  it('clamps to 0..1 when asked', () => {
    const ch = chan([0, 0, 1, 1, 0, 0, 1, 1, 0, 0]);
    smoothZeroPhase(ch, DT, { minCutoff: 50, beta: 0 }, { clamp01: true });
    for (let i = 0; i < 10; i++) {
      expect(ch.data[i]).toBeGreaterThanOrEqual(0);
      expect(ch.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('leaves single-sample segments alone', () => {
    const ch = chan([null, 7, null]);
    smoothZeroPhase(ch, DT, P);
    expect(ch.data[1]).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/shared/series.test.ts`
Expected: FAIL (cannot resolve `./series`).

- [ ] **Step 3: Write the implementation**

Create `components/shared/series.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Numeric primitives behind the take cleanup layer. A Channel is n samples x dim values with a presence mask;
 * gap fill and zero-phase smoothing both work in place and never touch absent samples except to fill a short,
 * bounded gap between two present ones.
 */

export interface Channel {
  /** n samples x dim values, row-major. */
  data: Float64Array;
  /** 1 where the sample exists (recorded or filled). */
  present: Uint8Array;
  n: number;
  dim: number;
}

export function makeChannel(n: number, dim: number): Channel {
  return { data: new Float64Array(n * dim), present: new Uint8Array(n), n, dim };
}

export interface GapStats {
  filled: number;
  left: number;
  filledSamples: number;
}

/** Median of the positive intervals between timestamps; 0 when there are none. */
export function medianDt(timestamps: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const x = timestamps[i] - timestamps[i - 1];
    if (x > 0) d.push(x);
  }
  if (d.length === 0) return 0;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/**
 * Fills gaps in place. A gap is a run of absent samples with a present sample on both sides; it is filled only when
 * the time between those two samples is at most `maxGapMs`. Landmarks use cubic Hermite with one-sided neighbour
 * slopes (secant when a neighbour is absent); `linear` interpolates straight. Leading and trailing absence is
 * never filled (no extrapolation).
 */
export function fillGaps(
  ch: Channel,
  dtMs: number,
  maxGapMs: number,
  opts: { linear?: boolean; clamp01?: boolean } = {},
): GapStats {
  const { data, present, n, dim } = ch;
  const stats: GapStats = { filled: 0, left: 0, filledSamples: 0 };
  let i = 0;
  while (i < n) {
    if (present[i]) {
      i++;
      continue;
    }
    const i0 = i - 1;
    let i1 = i;
    while (i1 < n && !present[i1]) i1++;
    i = i1;
    if (i0 < 0 || i1 >= n) continue; // leading or trailing: never filled
    const span = i1 - i0;
    if (span * dtMs > maxGapMs) {
      stats.left++;
      continue;
    }
    const hasPrev = i0 >= 1 && present[i0 - 1] === 1;
    const hasNext = i1 + 1 < n && present[i1 + 1] === 1;
    for (let d = 0; d < dim; d++) {
      const v0 = data[i0 * dim + d];
      const v1 = data[i1 * dim + d];
      const secant = (v1 - v0) / span;
      const m0 = !opts.linear && hasPrev ? v0 - data[(i0 - 1) * dim + d] : secant;
      const m1 = !opts.linear && hasNext ? data[(i1 + 1) * dim + d] - v1 : secant;
      for (let k = 1; k < span; k++) {
        const s = k / span;
        let v: number;
        if (opts.linear) {
          v = v0 + (v1 - v0) * s;
        } else {
          const s2 = s * s;
          const s3 = s2 * s;
          v =
            (2 * s3 - 3 * s2 + 1) * v0 +
            (s3 - 2 * s2 + s) * span * m0 +
            (-2 * s3 + 3 * s2) * v1 +
            (s3 - s2) * span * m1;
        }
        data[(i0 + k) * dim + d] = opts.clamp01 ? Math.min(1, Math.max(0, v)) : v;
      }
    }
    for (let k = 1; k < span; k++) present[i0 + k] = 1;
    stats.filled++;
    stats.filledSamples += span - 1;
  }
  return stats;
}

export interface SmoothParams {
  minCutoff: number; // Hz at rest
  beta: number; // speed coefficient, as in the One Euro filter
}

/**
 * Zero-phase smoothing in place: per contiguous present segment (optionally split where `breakBetween(prev, next)`
 * is true), a forward then a backward exponential pass whose per-sample alpha comes from a speed-adaptive cutoff
 * (`minCutoff + beta * |v|`, v a central difference over +-2 samples). Segments never bleed into each other.
 */
export function smoothZeroPhase(
  ch: Channel,
  dtMs: number,
  p: SmoothParams,
  opts: { breakBetween?: (prev: number, next: number) => boolean; clamp01?: boolean } = {},
): void {
  const { data, present, n, dim } = ch;
  const dt = dtMs / 1000;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const a = new Float64Array(n);
  const out = (v: number) => (opts.clamp01 ? Math.min(1, Math.max(0, v)) : v);
  let s = 0;
  while (s < n) {
    if (!present[s]) {
      s++;
      continue;
    }
    let e = s + 1;
    while (e < n && present[e] && !(opts.breakBetween && opts.breakBetween(e - 1, e))) e++;
    const len = e - s;
    if (len >= 2) {
      for (let d = 0; d < dim; d++) {
        for (let j = 0; j < len; j++) x[j] = data[(s + j) * dim + d];
        for (let j = 0; j < len; j++) {
          const lo = Math.max(0, j - 2);
          const hi = Math.min(len - 1, j + 2);
          const v = (x[hi] - x[lo]) / ((hi - lo) * dt);
          const r = 2 * Math.PI * (p.minCutoff + p.beta * Math.abs(v)) * dt;
          a[j] = r / (r + 1);
        }
        y[0] = x[0];
        for (let j = 1; j < len; j++) y[j] = y[j - 1] + a[j] * (x[j] - y[j - 1]);
        let z = y[len - 1];
        data[(s + len - 1) * dim + d] = out(z);
        for (let j = len - 2; j >= 0; j--) {
          z = z + a[j] * (y[j] - z);
          data[(s + j) * dim + d] = out(z);
        }
      }
    }
    s = e;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/shared/series.test.ts`
Expected: PASS (all tests). If the sine-gap test misses 0.03, report the actual max error rather than loosening silently.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add components/shared/series.ts components/shared/series.test.ts
git commit -m "feat(cleanup): channel primitives (gap fill, zero-phase smoothing)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hand tracking (`handTracks.ts`)

**Files:**
- Create: `components/shared/handTracks.ts`
- Test: `components/shared/handTracks.test.ts`

**Interfaces:**
- Consumes: `FrameData` from `types.ts` (`landmarks?: any[]`, an array of 21-point hands).
- Produces: `trackHands(frames: FrameData[]): number[][]`. For frame `f`, element `[f][k]` is the slot (`0` or `1`) of `frames[f].landmarks[k]`, or `-1` when that entry is not a valid 21-point hand. The result's inner length is `min(2, landmarks.length)`. Two valid hands always map to `[0, 1]` (capture order: right then left). A lone hand takes the slot whose last wrist position is nearer (slot 0 if no history).

- [ ] **Step 1: Write the failing test**

Create `components/shared/handTracks.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FrameData } from '../../types';
import { trackHands } from './handTracks';

const hand = (wristX: number) =>
  Array.from({ length: 21 }, (_, i) => ({ x: i === 0 ? wristX : wristX + 0.01, y: 0.5, z: 0 }));
const f = (t: number, ...wrists: number[]): FrameData => ({ timestamp: t, landmarks: wrists.map(hand) });

describe('trackHands', () => {
  it('maps two hands to slots 0 and 1 in capture order', () => {
    expect(trackHands([f(0, 0.8, 0.2), f(20, 0.2, 0.8)])).toEqual([[0, 1], [0, 1]]);
  });

  it('puts a lone hand with no history in slot 0', () => {
    expect(trackHands([f(0, 0.4)])).toEqual([[0]]);
  });

  it('gives a lone hand the slot whose last wrist is nearer', () => {
    const frames = [f(0, 0.8, 0.2), f(20, 0.21), f(40, 0.79), f(60, 0.25)];
    expect(trackHands(frames)).toEqual([[0, 1], [1], [0], [1]]);
  });

  it('keeps a lone hand in its slot while it moves slowly', () => {
    const frames = [f(0, 0.8, 0.2), f(20, 0.2), f(40, 0.22), f(60, 0.25), f(80, 0.3)];
    expect(trackHands(frames).slice(1)).toEqual([[1], [1], [1], [1]]);
  });

  it('returns an empty list for frames without hands', () => {
    expect(trackHands([{ timestamp: 0 }, { timestamp: 20, landmarks: [] }])).toEqual([[], []]);
  });

  it('marks an invalid hand -1 and still tracks the valid one', () => {
    const frame: FrameData = { timestamp: 0, landmarks: [[{ x: 0, y: 0, z: 0 }], hand(0.3)] };
    expect(trackHands([frame])).toEqual([[-1, 0]]);
  });

  it('ignores a third hand', () => {
    expect(trackHands([f(0, 0.8, 0.2, 0.5)])[0]).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/shared/handTracks.test.ts`
Expected: FAIL (cannot resolve `./handTracks`).

- [ ] **Step 3: Write the implementation**

Create `components/shared/handTracks.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Re-establishes hand identity in a saved take. Takes carry no handedness: hands are stored right-first, but a
 * lone hand is always index 0 whichever hand it is. Two hands in one frame are therefore trusted as [slot 0,
 * slot 1] (the capture order); a lone hand joins the slot whose last wrist position is nearer.
 */
import { FrameData } from '../../types';

type Pt = { x: number; y: number };

const isHand = (h: any): boolean => Array.isArray(h) && h.length >= 21;
const wrist = (h: any[]): Pt => ({ x: h[0].x, y: h[0].y });
const dist = (a: Pt | null, b: Pt) => (a ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

export function trackHands(frames: FrameData[]): number[][] {
  const last: (Pt | null)[] = [null, null];
  return frames.map((fr) => {
    const hs = (fr.landmarks ?? []).slice(0, 2);
    const ok = hs.map(isHand);
    if (hs.length === 2 && ok[0] && ok[1]) {
      last[0] = wrist(hs[0]);
      last[1] = wrist(hs[1]);
      return [0, 1];
    }
    return hs.map((h, i) => {
      if (!ok[i]) return -1;
      const w = wrist(h);
      const slot = dist(last[1], w) < dist(last[0], w) ? 1 : 0;
      last[slot] = w;
      return slot;
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/shared/handTracks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add components/shared/handTracks.ts components/shared/handTracks.test.ts
git commit -m "feat(cleanup): hand identity tracking for saved takes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `cleanTake` orchestration

**Files:**
- Create: `components/shared/cleanTake.ts`
- Test: `components/shared/cleanTake.test.ts`

**Interfaces:**
- Consumes: `FrameData` (`types.ts`); `trackHands` (Task 2); `makeChannel`, `fillGaps`, `smoothZeroPhase`, `medianDt`, `Channel`, `GapStats` (Task 1); `FACE_ONE_EURO_DEFAULTS`, `faceSmoothingToMinCutoff` (`components/shared/oneEuro.ts`).
- Produces:
  - `DEFAULT_MAX_GAP_MS = 300`, `MAX_GRID_SLOTS = 6000`
  - `interface CleanOptions { strength: number; maxGapMs?: number }`
  - `interface CleanReport { gapsFilled: number; gapsLeft: number; filledMs: number; skipped?: boolean }`
  - `interface CleanResult { frames: FrameData[]; report: CleanReport }`
  - `cleanTake(frames: FrameData[], opts: CleanOptions): CleanResult`
  - Behaviour: input never mutated; degenerate input (fewer than 2 frames, `dt <= 0`, grid under 2 slots) returns the same `frames` array with a zero report; a grid over `MAX_GRID_SLOTS` returns the same array with `report.skipped = true`; output frames sit on a uniform grid from the first timestamp at the median interval; channels absent at a slot have no key; hands are emitted present-only, slot 0 first; `leftHand`/`rightHand` pass through from the nearest source frame.

- [ ] **Step 1: Write the failing test**

Create `components/shared/cleanTake.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FrameData } from '../../types';
import { cleanTake, MAX_GRID_SLOTS, DEFAULT_MAX_GAP_MS } from './cleanTake';

const DT = 20;
const face = (x: number) => [
  { x, y: 0.5, z: 0 },
  { x: x + 0.1, y: 0.5, z: 0 },
  { x, y: 0.6, z: 0 },
];
const hand = (wx: number) => Array.from({ length: 21 }, (_, i) => ({ x: wx + i * 0.001, y: 0.5, z: 0 }));
const take = (n: number, make: (i: number) => Partial<FrameData>): FrameData[] =>
  Array.from({ length: n }, (_, i) => ({ timestamp: i * DT, ...make(i) }));
const faceX = (i: number) => 0.2 + 0.001 * i;

describe('cleanTake: gap fill', () => {
  it('fills a 200 ms face dropout and reports it', () => {
    const src = take(60, (i) => ({ landmarks: [hand(0.8)], ...(i >= 20 && i <= 29 ? {} : { faceLandmarks: face(faceX(i)) }) }));
    const { frames, report } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(60);
    for (let i = 20; i <= 29; i++) expect(frames[i].faceLandmarks![0].x).toBeCloseTo(faceX(i), 6);
    expect(report.gapsFilled).toBe(1);
    expect(report.gapsLeft).toBe(0);
    expect(report.filledMs).toBeCloseTo(10 * DT, 6);
  });

  it('fills frames that are missing from the array entirely', () => {
    const full = take(60, (i) => ({ faceLandmarks: face(faceX(i)) }));
    const src = full.filter((_, i) => i < 20 || i > 29);
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(60);
    for (let i = 20; i <= 29; i++) expect(frames[i].faceLandmarks![0].x).toBeCloseTo(faceX(i), 6);
  });

  it('leaves a 400 ms dropout absent and counts it', () => {
    const src = take(60, (i) => ({ landmarks: [hand(0.8)], ...(i >= 20 && i <= 39 ? {} : { faceLandmarks: face(faceX(i)) }) }));
    const { frames, report } = cleanTake(src, { strength: 0 });
    for (let i = 20; i <= 39; i++) expect(frames[i].faceLandmarks).toBeUndefined();
    expect(report.gapsFilled).toBe(0);
    expect(report.gapsLeft).toBe(1);
  });

  it('uses a 300 ms default cap', () => expect(DEFAULT_MAX_GAP_MS).toBe(300));
});

describe('cleanTake: pass-through and safety', () => {
  it('strength 0 on a gap-free take returns the same values and timestamps', () => {
    const src = take(30, (i) => ({ faceLandmarks: face(faceX(i)), landmarks: [hand(0.7), hand(0.2)], blendshapes: { jawOpen: i / 30 } }));
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames).toHaveLength(30);
    frames.forEach((f, i) => {
      expect(f.timestamp).toBe(src[i].timestamp);
      expect(f.faceLandmarks).toEqual(src[i].faceLandmarks);
      expect(f.landmarks).toEqual(src[i].landmarks);
      expect(f.blendshapes).toEqual(src[i].blendshapes);
    });
  });

  it('does not mutate its input', () => {
    const src = take(40, (i) => ({ faceLandmarks: face(faceX(i)), landmarks: [hand(0.7)] }));
    const before = JSON.stringify(src);
    cleanTake(src, { strength: 0.8 });
    expect(JSON.stringify(src)).toBe(before);
  });

  it('returns degenerate takes unchanged with a zero report and no NaN', () => {
    const zero = { gapsFilled: 0, gapsLeft: 0, filledMs: 0 };
    const empty: FrameData[] = [];
    expect(cleanTake(empty, { strength: 0.5 })).toEqual({ frames: empty, report: zero });
    const one = [{ timestamp: 0, faceLandmarks: face(0.5) }];
    expect(cleanTake(one, { strength: 0.5 }).frames).toBe(one);
    const same = [{ timestamp: 100 }, { timestamp: 100 }, { timestamp: 100 }];
    expect(cleanTake(same, { strength: 0.5 }).frames).toBe(same);
  });

  it('skips a take over the grid cap', () => {
    const src = take(MAX_GRID_SLOTS + 100, () => ({ landmarks: [hand(0.5)] }));
    const r = cleanTake(src, { strength: 0.5 });
    expect(r.frames).toBe(src);
    expect(r.report.skipped).toBe(true);
  });

  it('grid spans the first to the last timestamp', () => {
    const src = take(40, (i) => ({ faceLandmarks: face(faceX(i)) })).map((f) => ({ ...f, timestamp: f.timestamp + 1000 }));
    const { frames } = cleanTake(src, { strength: 0.5 });
    expect(frames[0].timestamp).toBe(1000);
    const lastRaw = src[src.length - 1].timestamp;
    const lastOut = frames[frames.length - 1].timestamp;
    expect(lastOut).toBeLessThanOrEqual(lastRaw);
    expect(lastOut).toBeGreaterThan(lastRaw - DT);
  });

  it('handles hands-only, face-only and key-less frames', () => {
    const handsOnly = cleanTake(take(30, () => ({ landmarks: [hand(0.5)] })), { strength: 0.5 }).frames;
    expect(handsOnly.every((f) => f.faceLandmarks === undefined && f.blendshapes === undefined && f.landmarks!.length === 1)).toBe(true);
    const faceOnly = cleanTake(take(30, (i) => ({ faceLandmarks: face(faceX(i)) })), { strength: 0.5 }).frames;
    expect(faceOnly.every((f) => f.landmarks === undefined && f.faceLandmarks!.length === 3)).toBe(true);
    const bare = cleanTake(take(30, () => ({})), { strength: 0.5 }).frames;
    expect(bare).toHaveLength(30);
    expect(bare.every((f) => Object.keys(f).join() === 'timestamp')).toBe(true);
  });
});

describe('cleanTake: blendshapes', () => {
  it('stay inside 0..1 after fill and smoothing, and keep their keys', () => {
    const src = take(60, (i) => (i >= 25 && i <= 30 ? {} : { blendshapes: { jawOpen: i % 2 === 0 ? 1 : 0, eyeBlinkLeft: i % 3 === 0 ? 1 : 0 } }));
    const { frames } = cleanTake(src, { strength: 0.8 });
    for (const f of frames) {
      if (!f.blendshapes) continue;
      expect(Object.keys(f.blendshapes).sort()).toEqual(['eyeBlinkLeft', 'jawOpen']);
      for (const v of Object.values(f.blendshapes)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(frames[27].blendshapes).toBeDefined();
  });
});

describe('cleanTake: hands', () => {
  it('keeps hand identity and capture order across a one-hand dropout', () => {
    // right hand at 0.8 always; left hand at 0.2 drops out for frames 10..14 (100 ms)
    const src = take(30, (i) => ({ landmarks: i >= 10 && i <= 14 ? [hand(0.8)] : [hand(0.8), hand(0.2)] }));
    const { frames, report } = cleanTake(src, { strength: 0 });
    for (let i = 10; i <= 14; i++) {
      expect(frames[i].landmarks).toHaveLength(2);
      expect(frames[i].landmarks![0][0].x).toBeCloseTo(0.8, 6);
      expect(frames[i].landmarks![1][0].x).toBeCloseTo(0.2, 6);
    }
    expect(report.gapsFilled).toBe(1);
  });

  it('does not smear a hand that jumps across the frame', () => {
    const src = take(20, (i) => ({ landmarks: [hand(i < 10 ? 0.1 : 0.9)] }));
    const { frames } = cleanTake(src, { strength: 0.5 });
    expect(frames[9].landmarks![0][0].x).toBeCloseTo(0.1, 6);
    expect(frames[10].landmarks![0][0].x).toBeCloseTo(0.9, 6);
  });

  it('passes legacy leftHand/rightHand through from the source frame', () => {
    const lh = { x: 1, y: 2, z: 3 };
    const src = take(10, (i) => (i === 4 ? { leftHand: lh as any, landmarks: [hand(0.5)] } : { landmarks: [hand(0.5)] }));
    const { frames } = cleanTake(src, { strength: 0 });
    expect(frames[4].leftHand).toBe(lh);
  });
});

describe('cleanTake: smoothing', () => {
  it('reduces jitter on a stationary face when strength is high', () => {
    let s = 7;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s / 2147483648) * 2 - 1;
    };
    // amplitude 0.0005: the speed-adaptive cutoff (beta 40) opens up for larger jitter by design, so a bigger
    // amplitude would be treated as motion and barely smoothed
    const src = take(120, () => ({ faceLandmarks: face(0.5 + 0.0005 * rnd()) }));
    const spread = (fs: FrameData[]) => {
      const xs = fs.map((f) => f.faceLandmarks![0].x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const out = cleanTake(src, { strength: 0.9 }).frames;
    expect(spread(out)).toBeLessThan(0.5 * spread(src));
  });
});

describe('cleanTake: size', () => {
  it('cleans 1200 frames of a 478-point face in a few seconds', () => {
    const big = Array.from({ length: 478 }, (_, k) => ({ x: (k % 50) / 50, y: Math.floor(k / 50) / 10, z: 0 }));
    const src = take(1200, (i) => ({ faceLandmarks: big.map((p) => ({ x: p.x + 0.001 * Math.sin(i / 10), y: p.y, z: p.z })), landmarks: [hand(0.5)] }));
    const t0 = performance.now();
    const r = cleanTake(src, { strength: 0.5 });
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(r.frames).toHaveLength(1200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/shared/cleanTake.test.ts`
Expected: FAIL (cannot resolve `./cleanTake`).

- [ ] **Step 3: Write the implementation**

Create `components/shared/cleanTake.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline cleanup of a recorded take: resample onto a uniform grid, fill short dropouts, then smooth with a
 * zero-phase pass. Pure and non-destructive: the input frames are never touched. Spec:
 * docs/superpowers/specs/2026-10-02-take-cleanup-and-orbit-design.md.
 */
import { FrameData } from '../../types';
import { FACE_ONE_EURO_DEFAULTS, faceSmoothingToMinCutoff } from './oneEuro';
import { trackHands } from './handTracks';
import { Channel, GapStats, fillGaps, makeChannel, medianDt, smoothZeroPhase } from './series';

export const DEFAULT_MAX_GAP_MS = 300;
/** 100 s at 60 fps. At 6000 slots a 478-point face is a ~69 MB channel plus ~2.9M output point objects (roughly 100-150 MB
 * together, beside the raw take). Beyond this the cleaned copy is too heavy for a phone tab: the take is returned unchanged. */
export const MAX_GRID_SLOTS = 6000;

const HAND_POINTS = 21;
/** A wrist moving this far (normalized units) in one sample is a re-detection, not motion: never smooth across it. */
const HAND_JUMP = 0.2;

export interface CleanOptions {
  strength: number; // 0 = no smoothing pass, 0..1 otherwise
  maxGapMs?: number;
}

export interface CleanReport {
  gapsFilled: number;
  gapsLeft: number;
  filledMs: number;
  skipped?: boolean;
}

export interface CleanResult {
  frames: FrameData[];
  report: CleanReport;
}

const passThrough = (frames: FrameData[], skipped = false): CleanResult => ({
  frames,
  report: { gapsFilled: 0, gapsLeft: 0, filledMs: 0, ...(skipped ? { skipped: true } : {}) },
});

type Pt = { x: number; y: number; z?: number };

const writePoints = (dst: Float64Array, off: number, pts: Pt[], count: number) => {
  for (let i = 0; i < count; i++) {
    dst[off + i * 3] = pts[i].x;
    dst[off + i * 3 + 1] = pts[i].y;
    dst[off + i * 3 + 2] = pts[i].z ?? 0;
  }
};

const readPoints = (src: Float64Array, off: number, count: number): Pt[] => {
  const out: Pt[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = { x: src[off + i * 3], y: src[off + i * 3 + 1], z: src[off + i * 3 + 2] };
  return out;
};

export function cleanTake(frames: FrameData[], opts: CleanOptions): CleanResult {
  if (frames.length < 2) return passThrough(frames);
  const t0 = frames[0].timestamp;
  const dt = medianDt(frames.map((f) => f.timestamp));
  if (!(dt > 0)) return passThrough(frames);
  const K = Math.floor((frames[frames.length - 1].timestamp - t0) / dt + 1e-6) + 1;
  if (K > MAX_GRID_SLOTS) return passThrough(frames, true);
  if (K < 2) return passThrough(frames);

  // grid slot -> source frame (later frames win a shared slot)
  const src = new Int32Array(K).fill(-1);
  frames.forEach((f, j) => {
    src[Math.min(K - 1, Math.max(0, Math.round((f.timestamp - t0) / dt)))] = j;
  });

  const faceLen = frames.reduce((n, f) => n || (Array.isArray(f.faceLandmarks) ? f.faceLandmarks.length : 0), 0);
  const keySet = new Set<string>();
  for (const f of frames) if (f.blendshapes) for (const k of Object.keys(f.blendshapes)) keySet.add(k);
  const keys = [...keySet].sort();

  const slots = trackHands(frames);
  const face = faceLen > 0 ? makeChannel(K, faceLen * 3) : null;
  const blend = keys.length > 0 ? makeChannel(K, keys.length) : null;
  const hands = [makeChannel(K, HAND_POINTS * 3), makeChannel(K, HAND_POINTS * 3)];

  for (let g = 0; g < K; g++) {
    const j = src[g];
    if (j < 0) continue;
    const f = frames[j];
    if (face && Array.isArray(f.faceLandmarks) && f.faceLandmarks.length === faceLen) {
      face.present[g] = 1;
      writePoints(face.data, g * face.dim, f.faceLandmarks, faceLen);
    }
    if (blend && f.blendshapes) {
      blend.present[g] = 1;
      keys.forEach((k, d) => {
        blend.data[g * blend.dim + d] = f.blendshapes![k] ?? 0;
      });
    }
    (f.landmarks ?? []).slice(0, 2).forEach((h, i) => {
      const s = slots[j][i];
      if (s < 0) return;
      hands[s].present[g] = 1;
      writePoints(hands[s].data, g * hands[s].dim, h, HAND_POINTS);
    });
  }

  const maxGap = opts.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const stats: GapStats[] = [];
  if (face) stats.push(fillGaps(face, dt, maxGap));
  for (const h of hands) stats.push(fillGaps(h, dt, maxGap));
  if (blend) fillGaps(blend, dt, maxGap, { linear: true, clamp01: true });

  if (opts.strength > 0) {
    const p = { minCutoff: faceSmoothingToMinCutoff(opts.strength), beta: FACE_ONE_EURO_DEFAULTS.beta };
    const jump = (ch: Channel) => (a: number, b: number) =>
      Math.hypot(ch.data[b * ch.dim] - ch.data[a * ch.dim], ch.data[b * ch.dim + 1] - ch.data[a * ch.dim + 1]) > HAND_JUMP;
    if (face) smoothZeroPhase(face, dt, p);
    for (const h of hands) smoothZeroPhase(h, dt, p, { breakBetween: jump(h) });
    if (blend) smoothZeroPhase(blend, dt, p, { clamp01: true });
  }

  const out: FrameData[] = new Array(K);
  for (let g = 0; g < K; g++) {
    const fr: FrameData = { timestamp: t0 + g * dt };
    if (face && face.present[g]) fr.faceLandmarks = readPoints(face.data, g * face.dim, faceLen);
    if (blend && blend.present[g]) {
      const rec: Record<string, number> = {};
      keys.forEach((k, d) => {
        rec[k] = blend.data[g * blend.dim + d];
      });
      fr.blendshapes = rec;
    }
    const hs = hands.filter((h) => h.present[g]).map((h) => readPoints(h.data, g * h.dim, HAND_POINTS));
    if (hs.length > 0) fr.landmarks = hs;
    const j = src[g];
    if (j >= 0) {
      if (frames[j].leftHand !== undefined) fr.leftHand = frames[j].leftHand;
      if (frames[j].rightHand !== undefined) fr.rightHand = frames[j].rightHand;
    }
    out[g] = fr;
  }

  return {
    frames: out,
    report: {
      gapsFilled: stats.reduce((s, x) => s + x.filled, 0),
      gapsLeft: stats.reduce((s, x) => s + x.left, 0),
      filledMs: stats.reduce((s, x) => s + x.filledSamples, 0) * dt,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/shared/cleanTake.test.ts`
Expected: PASS. Common failure: `toEqual` between `{x,y,z}` objects: the output points always carry `z` (a number), so the source points in the test must too (they do).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add components/shared/cleanTake.ts components/shared/cleanTake.test.ts
git commit -m "feat(cleanup): cleanTake (resample, gap fill, zero-phase smoothing)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prefs, report label and the memoizing hook

**Files:**
- Create: `components/shared/cleanupPrefs.ts`
- Test: `components/shared/cleanupPrefs.test.ts`
- Create: `hooks/useCleanedFrames.ts`

**Interfaces:**
- Consumes: `CleanReport`, `cleanTake` (Task 3); `FrameData`.
- Produces:
  - `interface CleanupPrefs { enabled: boolean; strength: number }`, `DEFAULT_CLEANUP_PREFS` (`{ enabled: false, strength: 0.5 }`), `CLEANUP_STORAGE_KEY = 'puppeteerlab.cleanup'`
  - `parseCleanupPrefs(raw: string | null): CleanupPrefs`, `serializeCleanupPrefs(p: CleanupPrefs): string`
  - `reportLabel(r: CleanReport | null): string`
  - `useCleanupPrefs(): readonly [CleanupPrefs, (patch: Partial<CleanupPrefs>) => void]`
  - `useCleanedFrames(raw: FrameData[], version: string, enabled: boolean, strength: number): { frames: FrameData[]; report: CleanReport | null }` (returns `raw` and `null` when disabled or fewer than 2 frames; strength debounced 150 ms)

- [ ] **Step 1: Write the failing test**

Create `components/shared/cleanupPrefs.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CLEANUP_PREFS, parseCleanupPrefs, serializeCleanupPrefs, reportLabel } from './cleanupPrefs';

describe('parseCleanupPrefs', () => {
  it('defaults to off at strength 0.5', () => {
    expect(DEFAULT_CLEANUP_PREFS).toEqual({ enabled: false, strength: 0.5 });
    expect(parseCleanupPrefs(null)).toEqual(DEFAULT_CLEANUP_PREFS);
  });
  it('survives garbage', () => {
    expect(parseCleanupPrefs('not json')).toEqual(DEFAULT_CLEANUP_PREFS);
    expect(parseCleanupPrefs('42')).toEqual(DEFAULT_CLEANUP_PREFS);
    expect(parseCleanupPrefs('{"enabled":"yes","strength":"high"}')).toEqual(DEFAULT_CLEANUP_PREFS);
  });
  it('clamps strength to 0..1', () => {
    expect(parseCleanupPrefs('{"enabled":true,"strength":7}')).toEqual({ enabled: true, strength: 1 });
    expect(parseCleanupPrefs('{"enabled":true,"strength":-3}')).toEqual({ enabled: true, strength: 0 });
  });
  it('round-trips', () => {
    const p = { enabled: true, strength: 0.25 };
    expect(parseCleanupPrefs(serializeCleanupPrefs(p))).toEqual(p);
  });
});

describe('reportLabel', () => {
  it('is empty without a report', () => expect(reportLabel(null)).toBe(''));
  it('says so when the take is too long', () =>
    expect(reportLabel({ gapsFilled: 0, gapsLeft: 0, filledMs: 0, skipped: true })).toBe('Take too long to clean up'));
  it('says so when there is nothing to fill', () =>
    expect(reportLabel({ gapsFilled: 0, gapsLeft: 0, filledMs: 0 })).toBe('No gaps to fill'));
  it('pluralises and rounds seconds to one decimal', () => {
    expect(reportLabel({ gapsFilled: 1, gapsLeft: 0, filledMs: 200 })).toBe('Filled 1 gap (0.2 s)');
    expect(reportLabel({ gapsFilled: 3, gapsLeft: 0, filledMs: 400 })).toBe('Filled 3 gaps (0.4 s)');
  });
  it('mentions gaps that were too long to fill', () => {
    expect(reportLabel({ gapsFilled: 1, gapsLeft: 2, filledMs: 200 })).toBe('Filled 1 gap (0.2 s) · 2 too long to fill');
    expect(reportLabel({ gapsFilled: 0, gapsLeft: 1, filledMs: 0 })).toBe('1 too long to fill');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/shared/cleanupPrefs.test.ts`
Expected: FAIL (cannot resolve `./cleanupPrefs`).

- [ ] **Step 3: Write the implementation**

Create `components/shared/cleanupPrefs.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The remembered "Clean up" choice and the badge text. Pure; storage access lives in the hook.
 */
import { CleanReport } from './cleanTake';

export interface CleanupPrefs {
  enabled: boolean;
  strength: number;
}

export const DEFAULT_CLEANUP_PREFS: CleanupPrefs = { enabled: false, strength: 0.5 };
export const CLEANUP_STORAGE_KEY = 'puppeteerlab.cleanup';

export function parseCleanupPrefs(raw: string | null): CleanupPrefs {
  if (!raw) return { ...DEFAULT_CLEANUP_PREFS };
  try {
    const j = JSON.parse(raw);
    const strength =
      typeof j?.strength === 'number' && Number.isFinite(j.strength)
        ? Math.min(1, Math.max(0, j.strength))
        : DEFAULT_CLEANUP_PREFS.strength;
    return { enabled: j?.enabled === true, strength };
  } catch {
    return { ...DEFAULT_CLEANUP_PREFS };
  }
}

export const serializeCleanupPrefs = (p: CleanupPrefs): string => JSON.stringify({ enabled: p.enabled, strength: p.strength });

export function reportLabel(r: CleanReport | null): string {
  if (!r) return '';
  if (r.skipped) return 'Take too long to clean up';
  if (r.gapsFilled === 0 && r.gapsLeft === 0) return 'No gaps to fill';
  const parts: string[] = [];
  if (r.gapsFilled > 0) parts.push(`Filled ${r.gapsFilled} gap${r.gapsFilled === 1 ? '' : 's'} (${(r.filledMs / 1000).toFixed(1)} s)`);
  if (r.gapsLeft > 0) parts.push(`${r.gapsLeft} too long to fill`);
  return parts.join(' · ');
}
```

Create `hooks/useCleanedFrames.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cleaned copy of a take for playback (spec: take cleanup layer). Memoized here, not inside cleanTake: the
 * recorder's buffer is mutated in place while recording, so `version` (frame count and duration) joins the array
 * identity in the key. The raw frames come back untouched whenever the switch is off.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FrameData } from '../types';
import { CleanReport, cleanTake } from '../components/shared/cleanTake';
import {
  CLEANUP_STORAGE_KEY,
  CleanupPrefs,
  DEFAULT_CLEANUP_PREFS,
  parseCleanupPrefs,
  serializeCleanupPrefs,
} from '../components/shared/cleanupPrefs';

export function useCleanupPrefs() {
  const [prefs, setPrefs] = useState<CleanupPrefs>(() => {
    try {
      return parseCleanupPrefs(localStorage.getItem(CLEANUP_STORAGE_KEY));
    } catch {
      return { ...DEFAULT_CLEANUP_PREFS };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLEANUP_STORAGE_KEY, serializeCleanupPrefs(prefs));
    } catch {
      /* private window or blocked storage: the choice just is not remembered */
    }
  }, [prefs]);
  const update = useCallback((patch: Partial<CleanupPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return [prefs, update] as const;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useCleanedFrames(
  raw: FrameData[],
  version: string,
  enabled: boolean,
  strength: number,
): { frames: FrameData[]; report: CleanReport | null } {
  const settled = useDebounced(strength, 150);
  return useMemo(() => {
    if (!enabled || raw.length < 2) return { frames: raw, report: null };
    return cleanTake(raw, { strength: settled });
  }, [raw, version, enabled, settled]);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run components/shared/cleanupPrefs.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/shared/cleanupPrefs.ts components/shared/cleanupPrefs.test.ts hooks/useCleanedFrames.ts
git commit -m "feat(cleanup): remembered prefs, report label, useCleanedFrames hook" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Options bar and wiring into the share viewer and Face Puppet

**Files:**
- Create: `components/PlaybackOptions.tsx`
- Modify: `components/TakeViewer.tsx` (the `Player` component, lines ~45-171)
- Modify: `components/FaceDemo.tsx` (imports; after `const recorder = useRecorder(...)` at ~92; the playback read at ~185-192; `recorderProps.footer` at ~405)

**Interfaces:**
- Consumes: `useCleanedFrames`, `useCleanupPrefs` (Task 4); `reportLabel` (Task 4); `CleanReport` (Task 3); `findFrameIndex` from `hooks/useRecorder`.
- Produces: `PlaybackOptions` default export with props `{ cleanup: { enabled: boolean; strength: number; report: CleanReport | null; onEnabled(v: boolean): void; onStrength(v: number): void }; disabled?: boolean; className?: string }`. Test ids: `cleanup-toggle` (a `role="switch"` button, `aria-checked`), `cleanup-strength` (range), `cleanup-badge`. Task 10 extends this component with an optional `orbit` prop.

There is no unit test for this task (node environment, no DOM); the Playwright gate in Task 6 covers it. Do this task carefully against the real files.

- [ ] **Step 1: Create the options bar**

Create `components/PlaybackOptions.tsx`:

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Playback options under the stage: the Clean up switch with its strength slider and gap badge.
 */
import React from 'react';
import { CleanReport } from './shared/cleanTake';
import { reportLabel } from './shared/cleanupPrefs';

export interface PlaybackOptionsProps {
  cleanup: {
    enabled: boolean;
    strength: number;
    report: CleanReport | null;
    onEnabled(v: boolean): void;
    onStrength(v: number): void;
  };
  disabled?: boolean;
  className?: string;
}

const PlaybackOptions: React.FC<PlaybackOptionsProps> = ({ cleanup, disabled, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] text-gray-300 ${className}`}>
    <button
      data-testid="cleanup-toggle"
      role="switch"
      aria-checked={cleanup.enabled}
      disabled={disabled}
      onClick={() => cleanup.onEnabled(!cleanup.enabled)}
      className={`min-h-[44px] md:min-h-0 px-3 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        cleanup.enabled ? 'bg-white/15 text-white font-semibold' : 'bg-white/10 text-gray-300 hover:text-white'
      }`}
    >
      CLEAN UP {cleanup.enabled ? 'ON' : 'OFF'}
    </button>
    {cleanup.enabled && (
      <>
        <input
          data-testid="cleanup-strength"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={cleanup.strength}
          aria-label="Cleanup strength"
          onChange={(e) => cleanup.onStrength(parseFloat(e.target.value))}
          className="w-24 accent-[#EE3B2B]"
        />
        <span data-testid="cleanup-badge" className="text-gray-400">
          {reportLabel(cleanup.report)}
        </span>
      </>
    )}
  </div>
);

export default PlaybackOptions;
```

- [ ] **Step 2: Wire `TakeViewer.tsx`**

Add imports at the top (next to the existing ones):

```tsx
import PlaybackOptions from './PlaybackOptions';
import { useCleanedFrames, useCleanupPrefs } from '../hooks/useCleanedFrames';
```

In `Player`, after `const stateRef = useRef(INITIAL_PUPPET_STATE);` add:

```tsx
  const [prefs, setPrefs] = useCleanupPrefs();
  const cleaned = useCleanedFrames(take.frames, '', prefs.enabled, prefs.strength);
  const framesRef = useRef(take.frames);
  framesRef.current = cleaned.frames; // read by the draw loop, which does not re-run when the switch flips
```

In the draw loop replace

```tsx
      const frame = take.frames[findFrameIndex(take.frames, t)];
```

with

```tsx
      const frames = framesRef.current;
      const frame = frames[findFrameIndex(frames, t)];
```

In the second controls row (`<div className="flex flex-wrap items-center gap-x-4 gap-y-2">`), add as its first child:

```tsx
          <PlaybackOptions
            cleanup={{
              enabled: prefs.enabled,
              strength: prefs.strength,
              report: cleaned.report,
              onEnabled: (enabled) => setPrefs({ enabled }),
              onStrength: (strength) => setPrefs({ strength }),
            }}
          />
```

- [ ] **Step 3: Wire `FaceDemo.tsx`**

Add imports next to the existing ones (`FrameData` and `findFrameIndex` may already be imported; do not duplicate):

```tsx
import PlaybackOptions from './PlaybackOptions';
import { useCleanedFrames, useCleanupPrefs } from '../hooks/useCleanedFrames';
import { findFrameIndex } from '../hooks/useRecorder'; // keep alongside the existing `useRecorder` import
```

Right after `const recorder = useRecorder('FACE', audioStreamRef);` add:

```tsx
  // Cleanup is a playback layer: it never touches the buffer, the exports or the upload (all raw).
  const [cleanupPrefs, setCleanupPrefs] = useCleanupPrefs();
  const cleaned = useCleanedFrames(
    recorder.getFrames(),
    `${recorder.frameCount}:${recorder.durationMs}`,
    cleanupPrefs.enabled && recorder.hasData && !recorder.isRecording,
    cleanupPrefs.strength,
  );
  const playFramesRef = useRef<FrameData[]>([]);
  playFramesRef.current = cleaned.frames; // read by the render loop, whose effect does not re-run on a toggle
```

In the render loop replace the playback branch

```tsx
              else if (recorder.isPlaying) {
                  const frame = recorder.getPlaybackFrame();
                  if (frame) {
```

with

```tsx
              else if (recorder.isPlaying) {
                  const rawFrame = recorder.getPlaybackFrame(); // also advances the loop and the clock
                  const pf = playFramesRef.current;
                  const frame = pf.length > 0 ? pf[findFrameIndex(pf, recorder.getPlaybackTimeMs())] : rawFrame;
                  if (frame) {
```

(the body of the `if (frame) { ... }` stays as is).

Replace `footer: ( <SaveLink ... /> ),` in `recorderProps` with:

```tsx
    footer: (
      <>
        <PlaybackOptions
          cleanup={{
            enabled: cleanupPrefs.enabled,
            strength: cleanupPrefs.strength,
            report: cleaned.report,
            onEnabled: (enabled) => setCleanupPrefs({ enabled }),
            onStrength: (strength) => setCleanupPrefs({ strength }),
          }}
          disabled={!recorder.hasData || exportState !== null || recorder.isRecording}
        />
        <SaveLink
          state={saveLink}
          disabled={!recorder.hasData || exportState !== null || recorder.isRecording}
          hasAudio={recorder.hasAudio}
        />
      </>
    ),
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: all tests pass (the previous count plus the new ones).
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/PlaybackOptions.tsx components/TakeViewer.tsx components/FaceDemo.tsx
git commit -m "feat(cleanup): Clean up switch in Face Puppet playback and the share viewer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser gate, shared viewer harness and Phase 1 proof

**Files:**
- Create: `scripts/lib/viewer-harness.mjs`
- Create: `scripts/cleanup-check.mjs`
- Modify: `package.json` (scripts: add `"cleanup-check": "npm run build && node scripts/cleanup-check.mjs"`)

**Interfaces:**
- Consumes: the viewer test ids from Task 5 (`take-canvas`, `take-play`, `cleanup-toggle`, `cleanup-badge`, scrub input `aria-label="Scrub"`), `tools/make-synthetic-take.mjs --hands` fixture (20 fps, 60 frames, its own 16-frame face dropout at frames 36..51).
- Produces: `scripts/lib/viewer-harness.mjs` exporting `FIXTURE`, `TAKE_ID`, `ensureFixture()`, `makeCheck()`, `startPreview(port)`, `openViewer(page, base, take)`, `seek(page, ms)`, `snap(page, name)`, `diff(page, a, b)`. Task 11 reuses it.

- [ ] **Step 1: Write the harness**

Create `scripts/lib/viewer-harness.mjs`:

```js
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pieces of the viewer browser gates (cleanup-check, orbit-check): serve dist/ with vite preview on a port
 * this script owns, mock GET /api/takes/<id> with a parsed recording, drive the scrubber, and compare stage frames.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const FIXTURE = 'tools/fixtures/synthetic-face-hands-take.json';
export const TAKE_ID = 'a'.repeat(22);

export function ensureFixture() {
  if (!existsSync(FIXTURE)) spawnSync(process.execPath, ['tools/make-synthetic-take.mjs', '--hands'], { stdio: 'inherit' });
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

export function makeCheck() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  };
  const finish = () => {
    const bad = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - bad}/${results.length} checks passed`);
    return bad === 0 ? 0 : 1;
  };
  return { check, finish };
}

/** Never test a server we did not start: refuse a busy port, fail fast if our child exits. */
export async function startPreview(port) {
  const base = `http://localhost:${port}`;
  if (await fetch(base).then(() => true, () => false)) {
    throw new Error(`port ${port} is already serving something; refusing to test a server this script did not start`);
  }
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = `vite preview exited (code ${code}, signal ${signal})`;
  });
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error(`${exited}; is dist/ built?`);
    try {
      if ((await fetch(base)).ok) return { base, stop: () => child.kill() };
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('vite preview did not start (is dist/ built?)');
}

/** Serve `take` (a parsed recording) as the shared take, then open the viewer paused at t=0. */
export async function openViewer(page, base, take) {
  await page.route('**/api/takes/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'X-Expires-At': new Date(Date.now() + 20 * 3600e3).toISOString() },
      body: JSON.stringify(take),
    }),
  );
  await page.goto(`${base}/t/${TAKE_ID}`);
  await page.getByTestId('take-canvas').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
}

/** The scrubber is a range input with step 16; set it the way React sees a user change, then let the stage settle. */
export async function seek(page, ms) {
  await page.evaluate((v) => {
    const el = document.querySelector('input[aria-label=Scrub]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, ms);
  await page.waitForTimeout(450);
}

/** Copy the stage canvas pixels into window.__snaps[name]. */
export async function snap(page, name) {
  await page.evaluate((n) => {
    const c = document.querySelector('[data-testid=take-canvas]');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    (window.__snaps ??= {})[n] = new Uint8ClampedArray(d);
  }, name);
}

/** Fraction of pixels whose largest channel difference exceeds 24. */
export async function diff(page, a, b) {
  return page.evaluate(([x, y]) => {
    const A = window.__snaps[x];
    const B = window.__snaps[y];
    if (A.length !== B.length) return 1;
    let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 24) n++;
    }
    return n / (A.length / 4);
  }, [a, b]);
}
```

- [ ] **Step 2: Write the cleanup gate**

Create `scripts/cleanup-check.mjs`:

```js
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cleanup gate: builds nothing itself (npm run cleanup-check builds first). Serves dist/ with vite preview, mocks a
 * shared take that has a short face dropout (frames 20..23 of the 20 fps fixture = 200 ms) plus the fixture's own
 * 800 ms dropout, and asserts in Chromium that the Clean up switch is off by default, fills only the short gap,
 * reports it, and is remembered across a reload. Screenshots go to $PROOF_DIR or .proof/<date>-take-cleanup/.
 * The port is $CLEANUP_CHECK_PORT (default 4175); a busy port is refused. Run it LAST (after the unit gates).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureFixture, makeCheck, startPreview, openViewer, seek, snap, diff } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.CLEANUP_CHECK_PORT ?? 4175);
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-take-cleanup`;
mkdirSync(OUT, { recursive: true });
const { check, finish } = makeCheck();

const take = ensureFixture();
for (let f = 20; f <= 23; f++) {
  delete take.frames[f].faceLandmarks;
  delete take.frames[f].blendshapes;
}

const server = await startPreview(PORT);
const browser = await chromium.launch();
let code = 1;
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openViewer(page, server.base, take);

  check('cleanup is off by default', (await page.getByTestId('cleanup-toggle').getAttribute('aria-checked')) === 'false');

  await seek(page, 1056); // inside the 200 ms gap (1000..1150 ms)
  await snap(page, 'raw-short');
  await page.screenshot({ path: path.join(OUT, '01-raw-inside-short-gap.png') });

  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(900);
  const badge = await page.getByTestId('cleanup-badge').innerText();
  check('the badge reports the filled gap', /filled 1 gap/i.test(badge), badge);
  check('...and the gap that is too long to fill', /1 too long to fill/i.test(badge), badge);

  await seek(page, 1056);
  await snap(page, 'clean-short');
  await page.screenshot({ path: path.join(OUT, '02-cleaned-inside-short-gap.png') });
  const dShort = await diff(page, 'raw-short', 'clean-short');
  check('inside the short gap the cleaned puppet has a face the raw one lacks', dShort > 0.01, `${(dShort * 100).toFixed(2)}% of pixels differ`);

  await seek(page, 2208); // inside the fixture's own 800 ms dropout (1800..2550 ms)
  await snap(page, 'clean-long');
  await page.screenshot({ path: path.join(OUT, '03-cleaned-inside-long-gap.png') });
  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(500);
  await seek(page, 2208);
  await snap(page, 'raw-long');
  const dLong = await diff(page, 'raw-long', 'clean-long');
  check('inside the long gap neither version invents a face', dLong < dShort / 3, `${(dLong * 100).toFixed(2)}% vs ${(dShort * 100).toFixed(2)}%`);

  await page.getByTestId('cleanup-toggle').click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByTestId('take-canvas').waitFor({ timeout: 15000 });
  check('the choice is remembered across a reload', (await page.getByTestId('cleanup-toggle').getAttribute('aria-checked')) === 'true');
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error(e);
} finally {
  code = finish();
  await browser.close();
  server.stop();
}
process.exit(code);
```

Add to `package.json` scripts: `"cleanup-check": "npm run build && node scripts/cleanup-check.mjs"`.

- [ ] **Step 3: Run the full unit gate**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: all tests pass.
Run: `npm run smoke`
Expected: OK.

- [ ] **Step 4: Run the browser gate (last, writes the proof)**

Run: `npm run cleanup-check`
Expected: every line `PASS`, final line `N/N checks passed`. If a threshold (the `0.01` face-pixel fraction, the `/ 3` ratio) fails for a real-looking reason, print the values, inspect `01-`/`02-` screenshots, and adjust the number with a comment recording the measured values. Never weaken a check without recording why. If a check fails because of behaviour (for example the badge never appears), fix the code.

- [ ] **Step 5: Commit, then put the proof in front of Grayson**

```bash
git add scripts/lib/viewer-harness.mjs scripts/cleanup-check.mjs package.json
git commit -m "test(cleanup): viewer browser gate for the Clean up switch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Then `SendUserFile` the three screenshots from `.proof/<date>-take-cleanup/` (`01-raw-inside-short-gap.png`, `02-cleaned-inside-short-gap.png`, `03-cleaned-inside-long-gap.png`) with a one-line caption: raw freeze/hole versus cleaned fill, and the long gap staying empty.

**Phase 1 gate (all must hold before Phase 2 starts):** `npm run typecheck` clean; `npm test` green including `series`, `handTracks`, `cleanTake`, `cleanupPrefs`; `npm run smoke` OK; `npm run cleanup-check` all PASS; default (switch off) playback unchanged.

---

# Phase 2: orbit camera

### Task 7: Hand depth and placement (`handDepth.ts`) plus the `handRig` split

**Files:**
- Create: `components/face/handDepth.ts`
- Test: `components/face/handDepth.test.ts`
- Modify: `components/face/handRig.ts` (split into `handRigFromScenePoints` + wrapper)
- Test: `components/face/handRigScene.test.ts`

**Interfaces:**
- Consumes: `trackHands` (Task 2); `makeChannel`, `fillGaps`, `smoothZeroPhase`, `medianDt` (Task 1); `V3` from `components/face/projection.ts`; `FrameData`.
- Produces:
  - `DEFAULT_R = 0.7`, `R_MIN = 0.25`, `R_MAX = 1.3`, `SIZE_RATIO = 9.5 / 14.5`, `HFOV_DEG = 63`
  - `focalPx(drawW: number): number`
  - `placeHandPoints(P: V3[], r: number, cx: number, cy: number, f: number): V3[]`
  - `interface TakeDepth { handR: number[][]; pivot: { x: number; y: number; z: number } | null }` where `handR[frameIndex][k]` is `r` for `frames[frameIndex].landmarks[k]` (same length as the tracked hand list, `DEFAULT_R` for an invalid entry)
  - `computeHandDepth(frames: FrameData[], aspect: number): TakeDepth`
  - In `handRig.ts`: `handRigFromScenePoints(P: V3[])` returning exactly what `handRig` returns today; `handRig(lm, p)` becomes a wrapper (`handRigFromScenePoints(lm.map(l => toScene(l, p)))`).

- [ ] **Step 1: Write the failing tests**

Create `components/face/handDepth.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FrameData } from '../../types';
import { DEFAULT_R, R_MAX, R_MIN, SIZE_RATIO, computeHandDepth, focalPx, placeHandPoints } from './handDepth';
import { V3 } from './projection';

const face = (width: number) => {
  const a = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  a[234] = { x: 0.5 - width / 2, y: 0.5, z: 0 };
  a[454] = { x: 0.5 + width / 2, y: 0.5, z: 0 };
  a[1] = { x: 0.5, y: 0.45, z: -0.02 };
  return a;
};
const hand = (size: number) => {
  const a = Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.7, z: 0 }));
  a[9] = { x: 0.8, y: 0.7 - size, z: 0 };
  return a;
};
const fr = (t: number, faceW: number | null, ...handSizes: number[]): FrameData => ({
  timestamp: t,
  ...(faceW === null ? {} : { faceLandmarks: face(faceW) }),
  landmarks: handSizes.map(hand),
});
const run = (n: number, make: (i: number) => FrameData) => Array.from({ length: n }, (_, i) => make(i));

describe('constants', () => {
  it('derives the focal length from a 63 degree horizontal FOV', () => expect(focalPx(1000)).toBeCloseTo(815.9, 0));
  it('uses the 9.5 cm / 14.5 cm size ratio', () => expect(SIZE_RATIO).toBeCloseTo(0.6552, 4));
});

describe('placeHandPoints', () => {
  const pts: V3[] = [[100, -50, 12], [300, -200, -30], [640, -480, 0]];
  const cx = 320;
  const cy = -240;
  const f = 800;

  it('r = 1 is the identity', () => {
    placeHandPoints(pts, 1, cx, cy, f).forEach((q, i) => q.forEach((v, d) => expect(v).toBeCloseTo(pts[i][d], 9)));
  });

  it('reprojects through the capture-pose camera to the original image position, for any r and z', () => {
    const project = (q: V3) => [cx + ((q[0] - cx) * f) / (f - q[2]), cy + ((q[1] - cy) * f) / (f - q[2])];
    for (const r of [0.3, 0.7, 1, 1.3]) {
      const placed = placeHandPoints(pts, r, cx, cy, f);
      placed.forEach((q, i) => {
        const [px, py] = project(q);
        const [ox, oy] = project(pts[i]);
        expect(px).toBeCloseTo(ox, 6);
        expect(py).toBeCloseTo(oy, 6);
      });
    }
  });

  it('a closer hand (r < 1) moves toward the camera', () => {
    expect(placeHandPoints([[cx, cy, 0]], 0.5, cx, cy, f)[0][2]).toBeCloseTo(400, 6);
  });
});

describe('computeHandDepth', () => {
  it('follows r = 0.655 * faceSize / handSize', () => {
    const d = computeHandDepth(run(20, (i) => fr(i * 20, 0.15, 0.15)), 1);
    expect(d.handR[10][0]).toBeCloseTo(9.5 / 14.5, 4);
  });

  it('applies the aspect to horizontal lengths', () => {
    const d = computeHandDepth(run(20, (i) => fr(i * 20, 0.15, 0.2)), 4 / 3); // face 0.2, hand 0.2
    expect(d.handR[10][0]).toBeCloseTo(9.5 / 14.5, 4);
  });

  it('clamps to [0.25, 1.3]', () => {
    expect(computeHandDepth(run(20, (i) => fr(i * 20, 0.3, 0.1)), 1).handR[10][0]).toBe(R_MAX);
    expect(computeHandDepth(run(20, (i) => fr(i * 20, 0.02, 0.3)), 1).handR[10][0]).toBe(R_MIN);
  });

  it('falls back to 0.7 when the take has no face', () => {
    const d = computeHandDepth(run(20, (i) => fr(i * 20, null, 0.15)), 1);
    expect(d.handR[5][0]).toBe(DEFAULT_R);
    expect(d.pivot).toBeNull();
  });

  it('holds the face size through a dropout (hand over the face)', () => {
    const d = computeHandDepth(run(30, (i) => fr(i * 20, i >= 10 && i <= 19 ? null : 0.15, 0.15)), 1);
    for (let i = 8; i <= 21; i++) expect(d.handR[i][0]).toBeCloseTo(9.5 / 14.5, 4);
  });

  it('keeps handR aligned with each frame\'s hand list', () => {
    const frames = [fr(0, 0.15), fr(20, 0.15, 0.15), fr(40, 0.15, 0.15, 0.2)];
    const d = computeHandDepth(frames, 1);
    expect(d.handR.map((r) => r.length)).toEqual([0, 1, 2]);
  });

  it('never returns NaN or Infinity for a collapsed hand or a zero-width face (review focus 5)', () => {
    const collapsed = run(20, (i) => fr(i * 20, 0.15, 0));
    const zeroFace = run(20, (i) => fr(i * 20, 1e-12, 0.15));
    for (const frames of [collapsed, zeroFace]) {
      for (const row of computeHandDepth(frames, 1).handR) {
        for (const r of row) {
          expect(Number.isFinite(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(R_MIN);
          expect(r).toBeLessThanOrEqual(R_MAX);
        }
      }
    }
  });

  it('pivot is the median nose tip', () => {
    const d = computeHandDepth(run(21, (i) => fr(i * 20, 0.15, 0.15)), 1);
    expect(d.pivot!.x).toBeCloseTo(0.5, 6);
    expect(d.pivot!.y).toBeCloseTo(0.45, 6);
    expect(d.pivot!.z).toBeCloseTo(-0.02, 6);
  });

  it('handles an empty take', () => expect(computeHandDepth([], 1)).toEqual({ handR: [], pivot: null }));
});
```

Create `components/face/handRigScene.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { handRig, handRigFromScenePoints } from './handRig';
import { fitProjection, toScene } from './projection';

describe('handRigFromScenePoints', () => {
  it('handRig is the same rig over toScene points', () => {
    const p = fitProjection(1000, 1000, 1);
    const lm = Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.4 + (i % 5) * 0.02, z: -0.01 * i }));
    expect(handRigFromScenePoints(lm.map((l) => toScene(l, p)))).toEqual(handRig(lm, p));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/face/handDepth.test.ts components/face/handRigScene.test.ts`
Expected: FAIL (cannot resolve `./handDepth`, no export `handRigFromScenePoints`).

- [ ] **Step 3: Split `handRig`**

In `components/face/handRig.ts` change the head of the function:

```ts
export function handRig(lm: Landmark[], p: Projection) {
  const P = lm.map((l) => toScene(l, p));
  const size = len(sub(P[9], P[0]));
```

into:

```ts
/** Capsule rig from points already in scene units (the orbit view places hands in depth before calling this). */
export function handRigFromScenePoints(P: V3[]) {
  const size = len(sub(P[9], P[0]));
```

leave the rest of the body untouched, and append after the function's closing brace:

```ts
export function handRig(lm: Landmark[], p: Projection) {
  return handRigFromScenePoints(lm.map((l) => toScene(l, p)));
}
```

- [ ] **Step 4: Write `handDepth.ts`**

Create `components/face/handDepth.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Face/hand depth for the orbit view. Face and hand landmarks come from separate models, so their z has no common
 * origin. In a pinhole camera depth is inversely proportional to apparent size and the focal length cancels in the
 * ratio, so r = Zhand / Zface = (9.5 / handSize) / (14.5 / faceSize). Sizes are 3D lengths (rotation-invariant) of
 * face 234..454 and hand 0..9 in height-units, smoothed per take; the result is a plausible 3D view, not metric
 * (roughly +-20-30 percent).
 */
import { FrameData } from '../../types';
import { trackHands } from '../shared/handTracks';
import { Channel, fillGaps, makeChannel, medianDt, smoothZeroPhase } from '../shared/series';
import { V3 } from './projection';

export const DEFAULT_R = 0.7;
export const R_MIN = 0.25;
export const R_MAX = 1.3;
export const SIZE_RATIO = 9.5 / 14.5;
export const HFOV_DEG = 63;

const FACE_A = 234;
const FACE_B = 454;
const NOSE = 1;
const MIN_SIZE = 1e-6;
const SIZE_SMOOTH = { minCutoff: 0.5, beta: 0 };

/** Focal length in stage pixels for the assumed horizontal FOV. */
export const focalPx = (drawW: number): number => drawW / 2 / Math.tan(((HFOV_DEG / 2) * Math.PI) / 180);

/** Scene points of one hand -> placed at depth ratio r, about the image center (cx, cy), for focal length f. */
export function placeHandPoints(P: V3[], r: number, cx: number, cy: number, f: number): V3[] {
  return P.map(([x, y, z]) => [cx + r * (x - cx), cy + r * (y - cy), f * (1 - r) + r * z] as V3);
}

export interface TakeDepth {
  /** handR[frameIndex][k] is r for frames[frameIndex].landmarks[k]. */
  handR: number[][];
  /** Median nose tip over the take in normalized landmark space, or null when no frame has a face. */
  pivot: { x: number; y: number; z: number } | null;
}

type Pt = { x: number; y: number; z?: number };
const dist3 = (a: Pt, b: Pt, aspect: number) =>
  Math.hypot((a.x - b.x) * aspect, a.y - b.y, ((a.z ?? 0) - (b.z ?? 0)) * aspect);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

function holdEnds(ch: Channel): void {
  const first = ch.present.indexOf(1);
  if (first < 0) return;
  let last = ch.n - 1;
  while (!ch.present[last]) last--;
  for (let i = 0; i < first; i++) { ch.data[i] = ch.data[first]; ch.present[i] = 1; }
  for (let i = last + 1; i < ch.n; i++) { ch.data[i] = ch.data[last]; ch.present[i] = 1; }
}

export function computeHandDepth(frames: FrameData[], aspect: number): TakeDepth {
  const n = frames.length;
  if (n === 0) return { handR: [], pivot: null };
  const dtMs = medianDt(frames.map((f) => f.timestamp)) || 1000 / 60;
  const slots = trackHands(frames);

  const faceSize = makeChannel(n, 1);
  const handSize = [makeChannel(n, 1), makeChannel(n, 1)];
  const nose: Pt[] = [];
  frames.forEach((f, i) => {
    const fl = f.faceLandmarks;
    if (Array.isArray(fl) && fl.length > FACE_B) {
      const s = dist3(fl[FACE_A], fl[FACE_B], aspect);
      if (s > MIN_SIZE) { faceSize.present[i] = 1; faceSize.data[i] = s; }
      nose.push(fl[NOSE]);
    }
    (f.landmarks ?? []).slice(0, 2).forEach((h, k) => {
      const slot = slots[i][k];
      if (slot < 0) return;
      const s = dist3(h[0], h[9], aspect);
      if (s > MIN_SIZE) { handSize[slot].present[i] = 1; handSize[slot].data[i] = s; }
    });
  });

  const haveFace = faceSize.present.indexOf(1) >= 0;
  if (haveFace) {
    fillGaps(faceSize, dtMs, Infinity, { linear: true });
    holdEnds(faceSize);
    smoothZeroPhase(faceSize, dtMs, SIZE_SMOOTH);
  }
  handSize.forEach((ch) => smoothZeroPhase(ch, dtMs, SIZE_SMOOTH));

  const handR = frames.map((_, i) =>
    slots[i].map((slot) => {
      if (slot < 0 || !haveFace || !handSize[slot].present[i]) return DEFAULT_R;
      const r = (SIZE_RATIO * faceSize.data[i]) / handSize[slot].data[i];
      return Number.isFinite(r) ? Math.min(R_MAX, Math.max(R_MIN, r)) : DEFAULT_R;
    }),
  );

  const pivot = nose.length
    ? { x: median(nose.map((p) => p.x)), y: median(nose.map((p) => p.y)), z: median(nose.map((p) => p.z ?? 0)) }
    : null;
  return { handR, pivot };
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run components/face/handDepth.test.ts components/face/handRigScene.test.ts components/face/handRig.test.ts`
Expected: PASS (existing `handRig` tests unchanged).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/face/handDepth.ts components/face/handDepth.test.ts components/face/handRig.ts components/face/handRigScene.test.ts
git commit -m "feat(orbit): size-based hand depth and placement; split handRig over scene points" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Orbit state (`orbitState.ts`)

**Files:**
- Create: `components/face/orbitState.ts`
- Test: `components/face/orbitState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface OrbitView { yaw: number; pitch: number; zoom: number }` (radians, radians, distance multiplier); `FRONT_VIEW` (`{ yaw: 0, pitch: 0, zoom: 1 }`); `YAW_LIMIT`, `PITCH_LIMIT` (radians), `ZOOM_MIN = 0.5`, `ZOOM_MAX = 2`; `clampView(v)`; `dragView(v, dxPx, dyPx, sizePx)` (a drag of the full `sizePx` is 180 degrees; drag right decreases yaw, drag down increases pitch); `zoomView(v, factor)`; `wheelFactor(deltaY)` (negative deltaY gives a factor below 1); `pinchFactor(prevDist, nextDist)` (fingers apart gives a factor below 1); `isFrontView(v)`.

- [ ] **Step 1: Write the failing test**

Create `components/face/orbitState.test.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { FRONT_VIEW, PITCH_LIMIT, YAW_LIMIT, ZOOM_MAX, ZOOM_MIN, clampView, dragView, isFrontView, pinchFactor, wheelFactor, zoomView } from './orbitState';

const deg = (d: number) => (d * Math.PI) / 180;

describe('limits', () => {
  it('are 75 degrees yaw, 40 degrees pitch, zoom 0.5 to 2', () => {
    expect(YAW_LIMIT).toBeCloseTo(deg(75), 9);
    expect(PITCH_LIMIT).toBeCloseTo(deg(40), 9);
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.5, 2]);
  });
});

describe('dragView', () => {
  it('a full-size drag is 180 degrees before clamping', () => {
    const v = dragView(FRONT_VIEW, 0, 100, 1000); // 10% of the size = 18 degrees
    expect(v.pitch).toBeCloseTo(deg(18), 6);
  });
  it('dragging right turns the camera toward negative yaw', () => {
    expect(dragView(FRONT_VIEW, 100, 0, 1000).yaw).toBeLessThan(0);
    expect(dragView(FRONT_VIEW, -100, 0, 1000).yaw).toBeGreaterThan(0);
  });
  it('clamps yaw and pitch however far the drag goes', () => {
    const v = dragView(FRONT_VIEW, -100000, 100000, 500);
    expect(v.yaw).toBeCloseTo(YAW_LIMIT, 9);
    expect(v.pitch).toBeCloseTo(PITCH_LIMIT, 9);
    const w = dragView(FRONT_VIEW, 100000, -100000, 500);
    expect(w.yaw).toBeCloseTo(-YAW_LIMIT, 9);
    expect(w.pitch).toBeCloseTo(-PITCH_LIMIT, 9);
  });
  it('tolerates a zero-size element', () => {
    expect(Number.isFinite(dragView(FRONT_VIEW, 10, 10, 0).yaw)).toBe(true);
  });
  it('keeps zoom', () => expect(dragView({ ...FRONT_VIEW, zoom: 1.5 }, 10, 10, 500).zoom).toBe(1.5));
});

describe('zoom', () => {
  it('multiplies and clamps to 0.5..2', () => {
    expect(zoomView(FRONT_VIEW, 1.5).zoom).toBe(1.5);
    expect(zoomView(FRONT_VIEW, 100).zoom).toBe(ZOOM_MAX);
    expect(zoomView(FRONT_VIEW, 0.001).zoom).toBe(ZOOM_MIN);
  });
  it('wheel up (negative deltaY) zooms in, down zooms out, and a huge delta stays finite', () => {
    expect(wheelFactor(-100)).toBeLessThan(1);
    expect(wheelFactor(100)).toBeGreaterThan(1);
    expect(Number.isFinite(wheelFactor(1e9))).toBe(true);
  });
  it('fingers apart zooms in', () => {
    expect(pinchFactor(100, 200)).toBeLessThan(1);
    expect(pinchFactor(200, 100)).toBeGreaterThan(1);
    expect(pinchFactor(0, 100)).toBe(1);
  });
});

describe('reset', () => {
  it('FRONT_VIEW is recognised and a moved view is not', () => {
    expect(isFrontView(FRONT_VIEW)).toBe(true);
    expect(isFrontView(dragView(FRONT_VIEW, 50, 0, 500))).toBe(false);
    expect(clampView({ yaw: 9, pitch: -9, zoom: 9 })).toEqual({ yaw: YAW_LIMIT, pitch: -PITCH_LIMIT, zoom: ZOOM_MAX });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/face/orbitState.test.ts`
Expected: FAIL (cannot resolve `./orbitState`).

- [ ] **Step 3: Write the implementation**

Create `components/face/orbitState.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orbit camera state for take playback: pure functions over { yaw, pitch, zoom }. Only the front surface of the
 * head was captured, so the range is limited (no look-behind). The pointer wiring lives in hooks/useOrbitInput.ts.
 */
export interface OrbitView {
  yaw: number; // radians; the camera moves toward +x for positive yaw
  pitch: number; // radians; positive lifts the camera
  zoom: number; // distance multiplier from the front pose
}

export const FRONT_VIEW: OrbitView = { yaw: 0, pitch: 0, zoom: 1 };
export const YAW_LIMIT = (75 * Math.PI) / 180;
export const PITCH_LIMIT = (40 * Math.PI) / 180;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampView(v: OrbitView): OrbitView {
  return { yaw: clamp(v.yaw, -YAW_LIMIT, YAW_LIMIT), pitch: clamp(v.pitch, -PITCH_LIMIT, PITCH_LIMIT), zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX) };
}

/** A drag across the whole element is 180 degrees. Drag right turns the camera toward -yaw; drag down raises it. */
export function dragView(v: OrbitView, dxPx: number, dyPx: number, sizePx: number): OrbitView {
  const k = Math.PI / Math.max(1, sizePx);
  return clampView({ ...v, yaw: v.yaw - dxPx * k, pitch: v.pitch + dyPx * k });
}

export function zoomView(v: OrbitView, factor: number): OrbitView {
  return clampView({ ...v, zoom: v.zoom * factor });
}

export const wheelFactor = (deltaY: number): number => Math.exp(clamp(deltaY, -500, 500) * 0.002);

export const pinchFactor = (prevDist: number, nextDist: number): number => (prevDist > 0 && nextDist > 0 ? prevDist / nextDist : 1);

export const isFrontView = (v: OrbitView): boolean => v.yaw === 0 && v.pitch === 0 && v.zoom === 1;
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run components/face/orbitState.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/face/orbitState.ts components/face/orbitState.test.ts
git commit -m "feat(orbit): orbit view state (clamps, drag, zoom, pinch)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Perspective camera in `PuppetScene` and renderer plumbing

**Files:**
- Modify: `components/face/PuppetScene.ts` (imports; `SceneInput`; `addLights`; fields; constructor; `render`; `updateHands`; new `placeOrbitCamera`)
- Modify: `components/face/FaceMeshRenderer.ts` (`PuppetFrame`, `PuppetOptions`, the `scene.render({...})` call at ~125)

**Interfaces:**
- Consumes: `OrbitView` (Task 8); `focalPx`, `placeHandPoints`, `DEFAULT_R` (Task 7); `handRigFromScenePoints` (Task 7); `toScene`, `Projection` (`projection.ts`).
- Produces:
  - `PuppetScene.ts`: `interface SceneView extends OrbitView { pivot: Landmark | null }`; `SceneInput` gains `view?: SceneView | null` and `handR?: number[]`. `view == null` renders exactly as before (ortho camera, lights at rest).
  - `FaceMeshRenderer.ts`: `PuppetFrame` gains `handR?: number[]` (r per hand, same order as `hands`); `PuppetOptions` gains `view?: SceneView | null`.

This task has no unit test (WebGL cannot run in node); Task 11's Playwright gate covers it. The default path must remain pixel-identical: Task 11 asserts it.

- [ ] **Step 1: `PuppetScene.ts` imports and types**

Replace

```ts
import { handRig, HAND_SEGMENTS } from './handRig';
```

with

```ts
import { handRigFromScenePoints, HAND_SEGMENTS } from './handRig';
import { DEFAULT_R, focalPx, placeHandPoints } from './handDepth';
import { OrbitView } from './orbitState';
```

After the `SceneInput` interface add the two fields and the new type:

```ts
export interface SceneView extends OrbitView {
  /** Fixed pivot of the take (median nose tip, normalized landmark space); null = image center. */
  pivot: Landmark | null;
}
```

and inside `SceneInput` add:

```ts
  /** Orbit view; null/undefined = the fixed ortho front view, exactly as before. */
  view?: SceneView | null;
  /** Depth ratio r per hand, same order as `hands` (orbit view only). */
  handR?: number[];
```

- [ ] **Step 2: Lights ride with the camera**

Replace `addLights` so it returns its rig:

```ts
function addLights(scene: THREE.Scene): THREE.Group {
  // Tuned on the synthetic take: low ambient + a side-ish key so the form reads. The rig is rotated with the
  // orbit camera so an orbited view keeps the same headlight look and is never dark.
  const rig = new THREE.Group();
  rig.add(new THREE.AmbientLight(0xffffff, 0.15));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-0.8, 0.6, 0.7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(0.8, -0.2, 0.8);
  const rim = new THREE.DirectionalLight(0xffffff, 2.5);
  rim.position.set(0.3, 0.8, -1);
  rig.add(key, fill, rim);
  scene.add(rig);
  return rig;
}
```

- [ ] **Step 3: Fields and constructor**

Add fields next to `private camera`:

```ts
  private orbitCamera = new THREE.PerspectiveCamera(50, 1, 10, 20000);
  private orbitQuat = new THREE.Quaternion();
  private faceLights!: THREE.Group;
  private handLights!: THREE.Group;
```

In the constructor replace

```ts
    addLights(this.faceScene);
    addLights(this.handScene);
```

with

```ts
    this.faceLights = addLights(this.faceScene);
    this.handLights = addLights(this.handScene);
```

- [ ] **Step 4: Orbit camera placement**

Add this method to the class (next to `setSize`):

```ts
  /** The capture camera (distance f from the face plane, looking down -z), rotated rigidly about the pivot. */
  private placeOrbitCamera(view: SceneView, p: Projection): THREE.PerspectiveCamera {
    const f = focalPx(p.drawW);
    const stageW = p.drawW + 2 * p.offsetX;
    const stageH = p.drawH + 2 * p.offsetY;
    const cx = p.offsetX + p.drawW / 2;
    const cy = -(p.offsetY + p.drawH / 2);
    const pivot = view.pivot ? new THREE.Vector3(...toScene(view.pivot, p)) : new THREE.Vector3(cx, cy, 0);
    this.orbitQuat.setFromEuler(new THREE.Euler(view.pitch, view.yaw, 0, 'YXZ'));
    const offset = new THREE.Vector3(cx, cy, f).sub(pivot).applyQuaternion(this.orbitQuat).multiplyScalar(view.zoom);
    const cam = this.orbitCamera;
    cam.position.copy(pivot).add(offset);
    cam.quaternion.copy(this.orbitQuat);
    cam.fov = (2 * Math.atan(stageH / 2 / f) * 180) / Math.PI;
    cam.aspect = stageW / stageH;
    cam.updateProjectionMatrix();
    this.faceLights.quaternion.copy(this.orbitQuat);
    this.handLights.quaternion.copy(this.orbitQuat);
    return cam;
  }
```

- [ ] **Step 5: `render` and `updateHands`**

In `render(input, p)`, before `const face = ...` add:

```ts
    const view = input.view ?? null;
    const cam: THREE.Camera = view ? this.placeOrbitCamera(view, p) : this.camera;
    if (!view) {
      this.faceLights.quaternion.identity();
      this.handLights.quaternion.identity();
    }
```

Replace `this.updateHands(input.hands, p);` with `this.updateHands(input.hands, p, view ? input.handR ?? [] : null);` and the two `this.renderer.render(..., this.camera)` calls with `cam`.

Replace `updateHands` with:

```ts
  private updateHands(hands: Landmark[][], p: Projection, rs: number[] | null) {
    let b = 0, j = 0;
    const m = this.tmp;
    const f = focalPx(p.drawW);
    const cx = p.offsetX + p.drawW / 2;
    const cy = -(p.offsetY + p.drawH / 2);
    this.palms.forEach((pm) => (pm.visible = false));
    hands.slice(0, 2).forEach((hand, hi) => {
      if (!hand || hand.length < 21) return;
      let P = hand.map((l) => toScene(l, p));
      if (rs) P = placeHandPoints(P, rs[hi] ?? DEFAULT_R, cx, cy, f);
      const rig = handRigFromScenePoints(P);
      // ...the rest of the body (segments, joints, palm pad) is unchanged
```

Keep the existing loops over `rig.segments`, `rig.joints` and the palm pad exactly as they are, closing with `});` as before. (The previous `hands.filter(...).slice(0, 2)` is replaced by the guarded `slice(0, 2)` so `hi` matches the original hand index.)

- [ ] **Step 6: `FaceMeshRenderer.ts` plumbing**

Add `import { SceneView } from './PuppetScene';` next to the existing `PuppetScene` import. In `PuppetFrame` add:

```ts
  /** Depth ratio r per hand (orbit view only), same order as `hands`. */
  handR?: number[];
```

In `PuppetOptions` add:

```ts
  /** Orbit view; null/undefined renders the fixed front view exactly as before. */
  view?: SceneView | null;
```

In the `scene.render({ face, eyeSource, hands: frame.hands, ... })` call add `view: opts.view ?? null, handR: frame.handR,`.

- [ ] **Step 7: Verify nothing regressed, then commit**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: all tests pass.
Run: `npm run build`
Expected: succeeds.

```bash
git add components/face/PuppetScene.ts components/face/FaceMeshRenderer.ts
git commit -m "feat(orbit): perspective capture-pose camera in PuppetScene, lights ride with it" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Orbit input, toggle and wiring (viewer and Face Puppet)

**Files:**
- Create: `hooks/useOrbitInput.ts`
- Create: `hooks/useTakeDepth.ts`
- Modify: `components/PlaybackOptions.tsx` (optional `orbit` prop)
- Modify: `components/TakeViewer.tsx`
- Modify: `components/FaceDemo.tsx`

**Interfaces:**
- Consumes: `OrbitView`, `FRONT_VIEW`, `dragView`, `zoomView`, `wheelFactor`, `pinchFactor` (Task 8); `computeHandDepth`, `TakeDepth` (Task 7); `SceneView` (Task 9); `PlaybackOptions` (Task 5).
- Produces:
  - `useOrbitInput(ref: React.RefObject<HTMLElement>, enabled: boolean, viewRef: { current: OrbitView }): void` (drag rotates, wheel and two-finger pinch zoom, double-tap or double-click resets, `touch-action: none` only while enabled)
  - `useTakeDepth(frames: FrameData[], aspect: number, enabled: boolean): TakeDepth` (empty depth when disabled)
  - `PlaybackOptionsProps.orbit?: { enabled: boolean; disabled?: boolean; onEnabled(v: boolean): void; onReset(): void }`, rendering a `data-testid="orbit-toggle"` switch button (`aria-checked`) and, when enabled, a `data-testid="orbit-reset"` button.

No unit tests (DOM/pointer code in a node environment); Task 11's Playwright gate covers it.

- [ ] **Step 1: Pointer input hook**

Create `hooks/useOrbitInput.ts`:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pointer wiring for the orbit view: one pointer drags, two pinch, the wheel zooms, a double tap/click resets.
 * The view lives in a ref (the render loops read it every frame), so dragging causes no React renders.
 */
import { RefObject, useEffect } from 'react';
import { FRONT_VIEW, OrbitView, dragView, pinchFactor, wheelFactor, zoomView } from '../components/face/orbitState';

const TAP_MS = 300;
const TAP_SLOP_PX = 24;
const MOVE_SLOP_PX = 8;

export function useOrbitInput(ref: RefObject<HTMLElement>, enabled: boolean, viewRef: { current: OrbitView }): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const prevTouch = el.style.touchAction;
    const prevCursor = el.style.cursor;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let travel = 0;
    let multi = false;
    let lastTap = 0;
    let lastX = 0;
    let lastY = 0;
    const size = () => Math.max(1, Math.min(el.clientWidth, el.clientHeight));
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const down = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        multi = true;
        pinchDist = spread();
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      travel += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 1) {
        viewRef.current = dragView(viewRef.current, dx, dy, size());
      } else if (pointers.size === 2) {
        const d = spread();
        viewRef.current = zoomView(viewRef.current, pinchFactor(pinchDist, d));
        pinchDist = d;
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      const isTap = !multi && travel < MOVE_SLOP_PX && e.type === 'pointerup';
      multi = false;
      travel = 0;
      if (!isTap) return;
      const now = performance.now();
      if (now - lastTap < TAP_MS && Math.hypot(e.clientX - lastX, e.clientY - lastY) < TAP_SLOP_PX) {
        viewRef.current = FRONT_VIEW;
        lastTap = 0;
      } else {
        lastTap = now;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      viewRef.current = zoomView(viewRef.current, wheelFactor(e.deltaY));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.style.touchAction = prevTouch;
      el.style.cursor = prevCursor;
    };
  }, [ref, enabled, viewRef]);
}
```

Create `hooks/useTakeDepth.ts`:

```ts
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
```

- [ ] **Step 2: Extend `PlaybackOptions`**

In `components/PlaybackOptions.tsx` add to `PlaybackOptionsProps`:

```ts
  orbit?: { enabled: boolean; disabled?: boolean; onEnabled(v: boolean): void; onReset(): void };
```

Destructure `orbit` in the component and render, after the cleanup controls inside the same wrapper `div`:

```tsx
    {orbit && (
      <>
        <button
          data-testid="orbit-toggle"
          role="switch"
          aria-checked={orbit.enabled}
          disabled={orbit.disabled}
          onClick={() => orbit.onEnabled(!orbit.enabled)}
          className={`min-h-[44px] md:min-h-0 px-3 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            orbit.enabled ? 'bg-white/15 text-white font-semibold' : 'bg-white/10 text-gray-300 hover:text-white'
          }`}
        >
          ORBIT {orbit.enabled ? 'ON' : 'OFF'}
        </button>
        {orbit.enabled && (
          <button
            data-testid="orbit-reset"
            onClick={orbit.onReset}
            className="min-h-[44px] md:min-h-0 px-3 py-1 rounded-lg bg-white/10 text-gray-300 hover:text-white"
          >
            RESET VIEW
          </button>
        )}
      </>
    )}
```

- [ ] **Step 3: Wire `TakeViewer.tsx`**

Add imports: `import { FRONT_VIEW, OrbitView } from './face/orbitState';`, `import { useOrbitInput } from '../hooks/useOrbitInput';`, `import { useTakeDepth } from '../hooks/useTakeDepth';`.

In `Player`, after the cleanup lines from Task 5 add:

```tsx
  const [orbitOn, setOrbitOn] = useState(false);
  const orbitViewRef = useRef<OrbitView>(FRONT_VIEW);
  const orbitOnRef = useRef(false);
  orbitOnRef.current = orbitOn;
  useOrbitInput(canvasRef, orbitOn, orbitViewRef);
  const depth = useTakeDepth(cleaned.frames, take.aspect, orbitOn);
  const depthRef = useRef(depth);
  depthRef.current = depth;
```

In the draw loop, replace the `drawPuppet(...)` call with:

```tsx
      const idx = findFrameIndex(frames, t);
      const orbiting = orbitOnRef.current;
      drawPuppet(ctx, { face: frame.faceLandmarks ?? null, hands: frame.landmarks ?? [], state: stateRef.current, handR: orbiting ? depthRef.current.handR[idx] : undefined }, canvas.width, canvas.height, {
        showGazeRays: false, showMocapDots: false, videoAspect: take.aspect,
        browBoost: 0.5, jawBoost: 0.75, blinkBoost: 0.5, creaseAngle: 35, meshDetail: 'low',
        view: orbiting ? { ...orbitViewRef.current, pivot: depthRef.current.pivot } : null,
      });
```

(and reuse `idx` for the `frame` lookup: `const frame = frames[idx];` computed just above, so the lookup is done once). Pass the new prop to `PlaybackOptions`:

```tsx
            orbit={{ enabled: orbitOn, onEnabled: setOrbitOn, onReset: () => { orbitViewRef.current = FRONT_VIEW; } }}
```

Turning orbit off must also reset the view so the next enable starts at the front pose: in `onEnabled` use `(on) => { orbitViewRef.current = FRONT_VIEW; setOrbitOn(on); }`.

- [ ] **Step 4: Wire `FaceDemo.tsx`**

Add the same imports. Near the cleanup lines from Task 5:

```tsx
  const [orbitOn, setOrbitOn] = useState(false);
  const orbitViewRef = useRef<OrbitView>(FRONT_VIEW);
  const orbitOnRef = useRef(false);
  orbitOnRef.current = orbitOn;
  useOrbitInput(canvasRef, orbitOn && recorder.isPlaying, orbitViewRef);
  const depthAspect = (() => { const s = recorder.getVideoSize(); return s ? s.width / s.height : 4 / 3; })();
  const depth = useTakeDepth(cleaned.frames, depthAspect, orbitOn && recorder.isPlaying);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  useEffect(() => { if (!recorder.isPlaying) orbitViewRef.current = FRONT_VIEW; }, [recorder.isPlaying]);
```

(`canvasRef` is the stage canvas already declared in this file; if the hook call must sit after its declaration, place it accordingly.)

In the render loop: declare `let playIdx = -1;` before the data-source `if` chain; in the playback branch, after computing `frame`, set `playIdx = pf.length > 0 ? findFrameIndex(pf, recorder.getPlaybackTimeMs()) : -1;` (reuse that index in the `pf[...]` lookup from Task 5). In the main `drawPuppet(...)` call add to the first argument `handR: orbiting && playIdx >= 0 ? depthRef.current.handR[playIdx] : undefined` and to the options `view: orbiting ? { ...orbitViewRef.current, pivot: depthRef.current.pivot } : null`, where `const orbiting = orbitOnRef.current && recorder.isPlaying && !exportFrameRef.current;` is declared just above the call. The export path's own `drawPuppet` call (in `runExport`) is left untouched: exports stay front view and raw.

Pass `orbit={{ enabled: orbitOn, disabled: !recorder.hasData || recorder.isRecording || exportState !== null, onEnabled: (on) => { orbitViewRef.current = FRONT_VIEW; setOrbitOn(on); }, onReset: () => { orbitViewRef.current = FRONT_VIEW; } }}` to the footer's `PlaybackOptions`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: all tests pass.
Run: `npm run build`
Expected: succeeds.

```bash
git add hooks/useOrbitInput.ts hooks/useTakeDepth.ts components/PlaybackOptions.tsx components/TakeViewer.tsx components/FaceDemo.tsx
git commit -m "feat(orbit): Orbit switch, drag/zoom/reset input, wired into the viewer and Face Puppet playback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Orbit browser gate, docs and Phase 2 proof

**Files:**
- Create: `scripts/orbit-check.mjs`
- Modify: `package.json` (scripts: add `"orbit-check": "npm run build && node scripts/orbit-check.mjs"`)
- Create: `docs/TAKE_CLEANUP_AND_ORBIT.md`

**Interfaces:**
- Consumes: `scripts/lib/viewer-harness.mjs` (Task 6), test ids `orbit-toggle`, `orbit-reset`, `take-canvas`, `take-play`, the Scrub input.

- [ ] **Step 1: Write the gate**

Create `scripts/orbit-check.mjs`:

```js
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orbit gate: builds nothing itself (npm run orbit-check builds first). Serves dist/ with vite preview, mocks the
 * shared take, and asserts in Chromium that: orbit is off by default; switching it on at rest looks like the front
 * view (capture-pose camera); a drag moves the camera; Reset restores the rest pose; the wheel zooms; switching it
 * off returns the default view pixel-for-pixel; touch-action is only 'none' while orbit is on. Then records a short
 * video of a drag-orbit during playback, and (if WebGL exists there) repeats a drag in WebKit on the iPhone
 * profile. Output goes to $PROOF_DIR or .proof/<date>-orbit/. The port is $ORBIT_CHECK_PORT (default 4176).
 * Run it LAST (after the unit gates).
 */
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { ensureFixture, makeCheck, startPreview, openViewer, seek, snap, diff } from './lib/viewer-harness.mjs';

const PORT = Number(process.env.ORBIT_CHECK_PORT ?? 4176);
const OUT = process.env.PROOF_DIR ?? `.proof/${new Date().toISOString().slice(0, 10)}-orbit`;
mkdirSync(OUT, { recursive: true });
const { check, finish } = makeCheck();
const take = ensureFixture();
const T_POSE = 496; // frame ~10: face and both hands present, a multiple of the scrubber step

const server = await startPreview(PORT);
const chrome = await chromium.launch();
let code = 1;

async function drag(page, fracX, fracY, steps = 12) {
  const box = await page.getByTestId('take-canvas').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * fracX, y + box.height * fracY, { steps });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

try {
  // 1. Desktop Chromium, deterministic stills.
  const page = await (await chrome.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openViewer(page, server.base, take);
  await seek(page, T_POSE);
  await snap(page, 'front');
  await page.screenshot({ path: path.join(OUT, '01-front-ortho.png') });

  check('orbit is off by default', (await page.getByTestId('orbit-toggle').getAttribute('aria-checked')) === 'false');
  const touchOff = await page.getByTestId('take-canvas').evaluate((el) => getComputedStyle(el).touchAction);
  check('touch-action is untouched while orbit is off', touchOff !== 'none', touchOff);

  await page.getByTestId('orbit-toggle').click();
  await page.waitForTimeout(500);
  await snap(page, 'orbit-rest');
  await page.screenshot({ path: path.join(OUT, '02-orbit-rest.png') });
  const rest = await diff(page, 'front', 'orbit-rest');
  check('orbit at rest looks like the front view', rest < 0.08, `${(rest * 100).toFixed(2)}% of pixels differ`);
  const touchOn = await page.getByTestId('take-canvas').evaluate((el) => getComputedStyle(el).touchAction);
  check('touch-action is none while orbit is on', touchOn === 'none', touchOn);

  await drag(page, 0.3, 0);
  await snap(page, 'orbited');
  await page.screenshot({ path: path.join(OUT, '03-orbit-yaw.png') });
  const moved = await diff(page, 'orbit-rest', 'orbited');
  check('a drag orbits the camera', moved > Math.max(0.03, rest * 3), `${(moved * 100).toFixed(2)}% vs rest ${(rest * 100).toFixed(2)}%`);

  await page.getByTestId('orbit-reset').click();
  await page.waitForTimeout(450);
  await snap(page, 'reset');
  const afterReset = await diff(page, 'orbit-rest', 'reset');
  check('Reset view restores the rest pose', afterReset < 0.005, `${(afterReset * 100).toFixed(3)}%`);

  const box = await page.getByTestId('take-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(450);
  await snap(page, 'zoomed');
  const zoomed = await diff(page, 'reset', 'zoomed');
  check('the wheel zooms', zoomed > 0.02, `${(zoomed * 100).toFixed(2)}%`);

  await page.getByTestId('orbit-toggle').click();
  await page.waitForTimeout(500);
  await snap(page, 'off');
  const off = await diff(page, 'front', 'off');
  check('switching orbit off returns the default view unchanged', off < 0.005, `${(off * 100).toFixed(3)}%`);
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '));
  await page.context().close();

  // 2. Video: drag-orbit while the take plays.
  const vctx = await chrome.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
  const vpage = await vctx.newPage();
  await openViewer(vpage, server.base, take);
  await vpage.getByTestId('orbit-toggle').click();
  await vpage.getByTestId('take-play').click();
  await drag(vpage, 0.25, -0.05, 20);
  await drag(vpage, -0.5, 0.1, 30);
  await drag(vpage, 0.25, -0.05, 20);
  await vpage.mouse.wheel(0, -300);
  await vpage.waitForTimeout(800);
  await vctx.close();
  const webm = readdirSync(OUT).find((f) => f.endsWith('.webm'));
  if (webm) renameSync(path.join(OUT, webm), path.join(OUT, 'orbit-drag.webm'));
  check('a drag-orbit video was recorded', !!webm);
} catch (e) {
  console.error(e);
}

// 3. WebKit on the iPhone profile (the phone is iPhone Safari).
try {
  const wk = await webkit.launch();
  const ctx = await wk.newContext({ ...devices['iPhone 13'] });
  const wpage = await ctx.newPage();
  await openViewer(wpage, server.base, take);
  const hasGL = await wpage.evaluate(() => !!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl'));
  if (!hasGL) {
    console.log('SKIP  WebKit iPhone drag: this Playwright WebKit has no WebGL here (Chromium coverage stands; do a real-iPhone run)');
  } else {
    await seek(wpage, T_POSE);
    await wpage.getByTestId('orbit-toggle').click();
    await wpage.waitForTimeout(500);
    await snap(wpage, 'wk-rest');
    await drag(wpage, 0.3, 0);
    await snap(wpage, 'wk-orbited');
    const wkMoved = await diff(wpage, 'wk-rest', 'wk-orbited');
    check('WebKit iPhone: a drag orbits the camera', wkMoved > 0.03, `${(wkMoved * 100).toFixed(2)}%`);
    await wpage.screenshot({ path: path.join(OUT, '04-webkit-iphone-orbit.png') });
  }
  await wk.close();
} catch (e) {
  console.error('WebKit section failed:', e);
  check('WebKit iPhone section ran', false, String(e));
}

code = finish();
await chrome.close();
server.stop();
process.exit(code);
```

Add to `package.json` scripts: `"orbit-check": "npm run build && node scripts/orbit-check.mjs"`.

- [ ] **Step 2: Write the doc**

Create `docs/TAKE_CLEANUP_AND_ORBIT.md` (short, user-facing): what **Clean up** does (resample, fill gaps up to 300 ms, zero-phase smoothing; off by default, raw never changed, exports and share links stay raw, limits: 100 s cap, a gap over 300 ms stays empty, and the baked-in lag from live filtering is not removed), what **Orbit** does (drag, wheel/pinch, double-tap or Reset; yaw ±75°, pitch ±40°, zoom 0.5x to 2x; only the front of the head was captured), and the accuracy caveat verbatim: hand depth is estimated from apparent size (face width 14.5 cm, hand wrist-to-knuckle 9.5 cm) so it is a plausible 3D view, roughly ±20 to 30 percent, not metric. Link the spec and this plan.

- [ ] **Step 3: Run the full gates**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: all tests pass.
Run: `npm run smoke`
Expected: OK.
Run: `npm run phone-check`
Expected: 97/97 (it is flaky under low RAM: fixed-wait drawer and mic checks; re-run once after the node-hog reaper before treating a failure as real). The orbit switch is off by default, so this gate must be unaffected.
Run: `npm run share-check`
Expected: 28/28.
Run: `npm run cleanup-check`
Expected: all PASS.

- [ ] **Step 4: Run the orbit gate (last, writes the proof)**

Run: `npm run orbit-check`
Expected: every `PASS`; the WebKit line is either `PASS` or an explicit `SKIP` with its reason. If a threshold fails for a real-looking reason, print the measured values, look at `01-`..`03-` and adjust with a comment recording the numbers; never weaken a check silently. If `orbit at rest looks like the front view` fails by a wide margin, look at the stills: it means the capture-pose camera or the hand placement is wrong, which is a code bug, not a threshold problem.

- [ ] **Step 5: Commit, then put the proof in front of Grayson**

```bash
git add scripts/orbit-check.mjs package.json docs/TAKE_CLEANUP_AND_ORBIT.md
git commit -m "test(orbit): viewer orbit gate (Chromium stills + video, WebKit iPhone drag) and docs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Then `SendUserFile` the stills `01-front-ortho.png`, `02-orbit-rest.png`, `03-orbit-yaw.png`, the iPhone shot if produced, and `orbit-drag.webm` from `.proof/<date>-orbit/`, with a caption naming the pose in each and the depth caveat (plausible, not metric).

**Phase 2 gate:** Phase 1 gate still holds; `handDepth`, `handRigScene`, `orbitState` tests green; existing `handRig`/`projection`/`face` tests unchanged and green; `phone-check` and `share-check` green (default view unchanged); `orbit-check` all PASS (WebKit PASS or explicit SKIP reported); docs written.

---

## Self-review (run against the spec)

- **Spec coverage:** cleanTake resample / hand tracking / gap fill / zero-phase / report (Tasks 1-3); hook, switch, strength, default off, remembered, export and upload raw (Tasks 4-5); Phase 1 tests and proof (Tasks 3, 6); depth findings and formula, clamp, fallback, smoothing, missing-face hold (Task 7); camera, lights, `view` option, `handRig` split, pivot, clamps (Tasks 7-9); input, zoom, reset, touch-action (Tasks 8, 10); Phase 2 tests and proof incl. WebKit iPhone and video (Task 11); doc with the accuracy caveat (Task 11). Deviations are listed under "Spec clarifications".
- **Placeholders:** none; every code step carries the code. Tasks 5, 9 and 10 modify existing files and say exactly what to replace; the implementer reads each file first.
- **Type consistency:** `Channel`/`GapStats` (Task 1) match their uses in Tasks 3 and 7; `trackHands` returns `number[][]` in Tasks 2, 3, 7; `CleanReport` (Task 3) matches `reportLabel`, `PlaybackOptions`, `useCleanedFrames`; `OrbitView` (Task 8) matches `SceneView`, `useOrbitInput`; `TakeDepth.handR[frameIndex][k]` matches the `handR` field read in Tasks 9-10; `PuppetFrame.handR` and `PuppetOptions.view` match the `SceneInput` fields.
- **Review Focus:** items 1-4 are pinned in Task 3 tests (degenerate takes, hands-only/face-only/key-less, grid cap with the Task 4 label test, grid spans first-to-last); item 5 in Task 7 tests.
