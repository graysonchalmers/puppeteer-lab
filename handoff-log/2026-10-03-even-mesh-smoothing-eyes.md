# 2026-10-03 (evening): Even vertex re-pick, hard-edge smoothing, dimmer eyes and teeth (pushed and live)

Follows `2026-10-03-face-mesh-topology.md`, which ended with "a vertex re-pick is the next lever". Grayson still saw hard facets at the nose and eye spokes on Flip, picked Even from comparison sheets, then asked for smoothing groups, hard edges at lips / nose underside / eyelids, and to try the eyes and teeth below full brightness.

## What was done
- `tools/lib/faceTopologyBuild.mjs`: `lowFromSubset(subset)` extracted; new `even` variant = `SUBSET + EVEN_ADD` -> Delaunay -> same oval/hole cuts -> the same edge-flip optimizer (`FLIP_OPTS`). `buildVariants` also returns `lowFlipFor`, `subsetFor`, `inPoly`.
- `tools/pick-even-vertices.mjs`: greedy additive search, one landmark plus its x-mirror partner per round (symmetric mesh), scored by sum of max(0, 30 - minAngle)^2 over the flipped low mesh. The first run was asymmetric (left eye and nose got different points than the right); the mirror-pair run scored better (3347 vs 3794 at 48 points). 36 pairs = 72 points = 442 triangles. The first 24 pairs are a prefix of the 36 (deterministic).
- Shipped table regenerated (`components/face/faceTopology.ts`, 263 vertices, 442 low / 840 full triangles); CLI default is now `even`, `flip` and `current` need `--out`.
- `components/face/hardEdges.ts` + `buildCreaseGroups(..., hardEdges)`: per-vertex fan splitting at hard edges; `PuppetScene` passes `hardEdgesFor(tris)`. Hard edges: outer lip ring; outer edge of the first triangle ring around each eye hole (rule: the edge opposite the lone contour vertex in every triangle with exactly one contour vertex; a first try using the full mesh's 1-ring only caught the inner corners); nose underside chains.
- Crease angle default 35 -> 90 (`FaceDemo.tsx`, `TakeViewer.tsx`). Slider max stays 90.
- `LOOK.eyeGain` / `LOOK.teethGain` = 0.55 (compared 100 / 75 / 55%).

## Numbers (low mesh, flip -> even)
Worst min angle 2.42 -> 15.36; under 20 deg 70 -> 6; aspect over 3 98 -> 25; valence 5..7 80.6% -> 91.4%; mean dihedral 18.58 -> 14.25; 298 -> 442 triangles (bound 450).

## Gates (this state)
tsc clean; 546 tests; smoke OK; phone-check 97/97; share-check 28/28; cleanup-check 7/7; orbit-check 11/11 (rest 7.33%, drag 22.73% vs bound 3 x 7.33 = 21.99); facedemo-check 27/27 (rest 9.36% vs 11% bound, drag 28.38% vs bound 3 x 9.36 = 28.08). Thin margins on both drag checks (0.74 and 0.30 points). No threshold or test bound was changed.

## Not done / next
- Committed `a04b379`, pushed to origin/main (`0527154..a04b379`) and redeployed (static, stamp `BEYOND · a04b37`, backup `index.html.bak-20261003152828`); verified live: 200, bundle match, 40 of 40 files, API health, mocked-take viewer with zero errors. No real-phone check.
- The picks target slivers, not nose curvature; with 442 of 450 triangles used, more nose detail needs a different objective or a bound change (Grayson's call).
- A crease slider max above 90 would give a true "smooth all".
- Proof (gitignored): `.proof/2026-10-03-even/` and `.proof/2026-10-03-even2/`.
