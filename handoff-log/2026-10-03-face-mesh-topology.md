# 2026-10-03: Face Puppet mesh topology pass (Flip shipped)

Grayson found the face mesh "dirty and not very modeled well": messy facets, diagonals that "need to be flipped", poor edge flow. Spec `docs/superpowers/specs/2026-10-03-face-mesh-topology-design.md`, plan `docs/superpowers/plans/2026-10-03-face-mesh-topology.md`. Direct to local `main`, not pushed or deployed.

## What was tried
Three topologies over the same vertex set (the 191-point subset for low, all 468 for full), rendered side by side on the synthetic take in the neon look, with objective numbers:
- **Current**: the original tables (2D Delaunay on the frontal projection, canonical faces for full, holes cut).
- **Flip**: Current followed by a deterministic edge-flip optimizer against the 3D canonical face. Boundary and hole rings are never flipped, so outline, holes, vertices and triangle counts are identical to Current.
- **Flow** (low only; its full mesh was Flip's): low re-triangulated with edge-loop chains forced in (oval, eyes, lips, brows, nose bridge, optional nasolabial lines), holes cut exactly at the rings, then optimized with the chain edges locked.
- "Even" (a vertex re-pick for even density) was dropped in the spec and never built.

The optimizer (`tools/lib/meshOpt.mjs`) minimizes a weighted energy of triangle quality, vertex valence (target 6 interior) and dihedral smoothness across edges, with exact per-flip deltas, convexity and lock rules, and an optional min-angle guard.

## Quality numbers (final, from `.proof/2026-10-03-topo/report.txt`)

| | worst min angle | under 20 deg | aspect over 3 | valence 5..7 | mean dihedral | dihedral p90 |
|---|---|---|---|---|---|---|
| current low | 2.42 | 82 | 102 | 78.6% | 20.51 | 48.22 |
| flip low | 2.42 | 70 | 98 | 80.6% | 18.58 | 47.49 |
| flow low | 2.42 | 72 | 97 | 79.6% | 19.17 | 49.98 |
| current full | 10.75 | 70 | 116 | 91.9% | 12.42 | 26.60 |
| flip full (= flow full) | 10.75 | 66 | 92 | 97.3% | 11.38 | 25.30 |

Flip: 56 flips on low, 129 on full. Flow: 6 chain-enforcement flips (no chain dropped, boundary equal to the exact oval and rings) then 57 optimizer flips.

## Tuning cycles
- r0 (untuned, weights 1 / 0.1 / 1, no guard): valence and dihedral improved a lot (low valence 83.5%, dihedral 16.01) but the independent metrics got worse (Flip worst angle 2.16, slivers 80, aspect over 3 105). The optimizer was gaming its own objective.
- Cycle 1: added the min-angle guard (a flip may not worsen the worst angle or the count under 20 degrees; guaranteed by construction). Slivers 82 -> 69, aspect 102 -> 93, but valence share fell below Current (77.7%), so it failed the bar.
- Cycle 2 (final): swept 24 weight sets with the guard on; chose wQuality 0.5, wValence 0.2, wDihedral 2 (best Flip dihedral among the settings that keep the sliver gain; Flow passes too).
- Cycle 3 (Flow only): dropping the optional nasolabial chains made Flow almost identical to Flip (1 edge apart), so they stayed; a wFlow sweep kept 0.3 (1.0 broke valence).
- The bar, pinned in tests: no worse than Current on worst angle, slivers and aspect; better on valence and dihedral. Flip meets it on low and full.

## The pick and why
Grayson picked **Flip**. Flow beat Flip on no pinned metric: same worst angle, valence +1.0 point on low against Flip's +2.0, a worse dihedral p90 than Current (49.98 vs 48.22), and its chains changed the mouth region visibly for no measurable gain. Flip is the smallest change that improves the numbers: same vertices, holes and counts.

## Real-data findings
- The visible wedges beside the nose and the spoke fans around the eyes are **not** fixable by flips: they come from which vertices exist. The 2.42 degree worst angle is an inner-eye-corner triangle on the hole boundary, which flips cannot touch. The honest result is a **modest** visible improvement. A vertex re-pick (Even) is the next lever.
- Without the min-angle guard, optimizing valence and dihedral worsens slivers; judge by metrics the optimizer does not optimize.
- Flip removes the extreme vertices (Current has valence 11 and 12; Flip's maximum is 10) but has more valence-8 vertices (2 -> 10).
- The face-normal orientation fix (Task 0, `a5cacf7`, `b93e66a`) landed first: every triangle, including those folded by a head turn, is lit with the viewer-facing normal.

## What shipped, what was deleted, what was kept
- Shipped: regenerated `components/face/faceTopology.ts` (298 low / 840 full triangles, same counts as before). `node tools/gen-face-topology.mjs` (default `--variant flip`) reproduces it byte for byte (a test pins that); `--variant current` writes the original; `--out path`.
- Deleted: the Flow variant (`buildFlowLow`-style code, `FLOW_CHAINS`, `FLOW_OPTS`, its stats and report lines) and its tests, `--emit-candidates` and the candidates JSON, the sheet-only override hook `components/face/topoSheetHook.ts` and its test, the `__TOPO_SHEET__` define in `vite.config.ts`, `scripts/topo-sheet.mjs`, the `topo-sheet` npm script and the `dist-topo` ignore line. `scripts/topo-sheet.mjs` and the `dist-topo` build output went to `C:\Projects-local\_to_delete\Tool-PuppeteerLab-2026-10-03-topo-sheet\`.
- Kept: `tools/lib/meshOpt.mjs` and `meshOpt.test.mjs` unchanged, as a generic tested library (edge enforcement, chains, flow term and guard are unused by the shipped generator), `FLIP_OPTS` with the guard, `cornerCavity(tris)`, `startPreview(port, outDir)` in `scripts/lib/viewer-harness.mjs`.
- No pixel threshold or test bound was changed. `faceTopology.test.ts` and every other existing test pass untouched.

## Gates
typecheck clean, 518 tests, smoke OK, `phone-check` 97/97, `share-check` 28/28, `cleanup-check` 7/7. `orbit-check` 11/11 three times (rest 7.15%, drag 22.66% against its 3x-rest bound 21.45%; WebKit iPhone drag 23.46%), `facedemo-check` 27/27 three times (rest 9.16% against its 11% bound, drag 28.30% against 3x rest 27.48%; cleanup short gap 13.53% vs long 2.32%). The numbers are deterministic: all three runs of each were identical, and the margins are about the same as before Flip. `npm run build` bundle has no `__topo` string.

## Proof
`.proof/2026-10-03-mesh-shipped/` (gitignored): `stage-low.png`, `stage-full.png` (+ `-canvas` crops) from the real Face Puppet stage, `viewer-low.png` (the share viewer has no mesh switch, so low only), and a real video export (`puppet-take-*.mp4`, 249,607 B, downloaded after 5.5 s, no page errors) with its 0.5 s frame `export-frame-0.5s.png`: neon head and hands, clean face. `proof.mjs` is the throwaway capture script.
