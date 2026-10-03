**Outcome (2026-10-03):** Flip shipped (default `--variant flip` in `tools/gen-face-topology.mjs`); Flow and the comparison sheet were removed; Even was not built. See `handoff-log/2026-10-03-face-mesh-topology.md`.

# Face Puppet mesh topology pass: Current, Flip, Flow

Date: 2026-10-03. Status: approved in chat (variants chosen by Grayson), spec for review.

## Intent
Grayson finds the face mesh "dirty and not very modeled well": messy facets, with diagonals that "need to be flipped", and poor edge flow. He wants a few options rendered side by side to choose from, without going overboard. The silhouette / mask-like oval edge is explicitly not part of this pass.

Success: three topology variants (Current, Flip, Flow) rendered side by side on the synthetic take, with objective quality numbers beside them; Grayson picks one; the winner replaces the shipped triangle tables and the rest are deleted.

Stated by Grayson: the two problems are messy facets and edge flow. The "Even" variant (re-picking the vertex subset for even density) was dropped.

Assumptions (correctable):
- Vertices stay exactly as they are (the ~191-point subset for low, all 468 for full). Only the triangle tables change. That keeps cavity darkening, lip/eye/brow code, crease groups and hands working without edits.
- Full mesh gets the Flip optimization only (MediaPipe's canonical table already has its own edge loops).
- The shipped neon look is the rendering look for the comparison.

## Current state
- `tools/gen-face-topology.mjs` (one-shot generator, run by hand) picks `SUBSET` (oval, lips, eyes, brows, nose, 41 fill points), Delaunay-triangulates it with `delaunator` on the frontal 2D projection `(x, -y)` of the canonical face (depth is ignored), keeps triangles whose centroid is inside `FACE_OVAL`, and drops hole triangles (a triangle spanning both lips or both lids, or with its centroid inside the inner-lip or an eye polygon). `FACE_TRIS_FULL` is the canonical model's own 840 faces with the same holes cut. Lip flags: low = all 3 vertices in `LIPS_OUTER`/`LIPS_INNER`; full = centroid inside the outer-lip polygon.
- Output is a fixed table written into `components/face/faceTopology.ts` (298 low triangles, 840 full). Never retriangulated at runtime.
- Consumers: `faceGeometry.ts` (`FACE_MESHES`), `creaseGroups.ts` (computed from the table on `CANONICAL_VERTS`), `cavity.ts` (vertex-indexed), `faceTopology.test.ts` (count bounds 250..450 low, 800..898 full; no triangle bridges an eye or the mouth hole; indices 0..467; lip flags present).
- Why it looks messy: the 2D Delaunay picks diagonals by planar angle only, so on the curved nose, cheek and brow region it chooses diagonals that run across the curvature instead of along it, giving slivers and uneven facets; and nothing makes edges follow the loops around the eyes, mouth and nose.

## Design

### 1. Variants (all keep the vertex set)
- **Current**: today's tables, unchanged. `--variant current` must reproduce the committed `faceTopology.ts` byte for byte.
- **Flip**: the current Delaunay tables, then a deterministic edge-flip optimization against the 3D canonical face. Boundary edges (oval, hole rings) are never flipped, so holes and outline are identical to Current.
- **Flow**: retriangulate low with edge-loop constraint chains forced in as edges, then run the same optimization with those chains locked. Full gets Flip only.

### 2. Edge-flip optimization (`tools/lib/meshOpt.mjs`, pure, no dependencies)
Input: triangle list (vertex ids), 3D positions (`CANONICAL_VERTS`), a set of locked undirected edges, options. Output: new triangle list, same vertex set and triangle count.
- A flip replaces the shared edge `(a,b)` of triangles `(a,b,c)` and `(b,a,d)` with `(c,d)`.
- A flip is allowed only if: the edge is not locked or a boundary edge; the quad `a,c,b,d` is strictly convex in the frontal 2D projection (no fold-over); `(c,d)` does not already exist; both new triangles keep the original 2D winding sign.
- Energy of a candidate quad (lower is better), evaluated in 3D:
  - triangle quality: `sum(1 - 4*sqrt(3)*area / sum(edge_length^2))` over the two triangles;
  - valence regularity: `sum((valence - target)^2)` over `a,b,c,d` after the flip, target 6 for interior vertices, 4 for boundary vertices, weighted by `wValence`;
  - curvature alignment: the dihedral angle across the new diagonal (smaller is better, so the diagonal runs along the surface, not across it), weighted by `wDihedral`;
  - flow term (Flow variant only, `wFlow > 0`): for edges near an eye, the mouth or the nose, penalize alignment with the radial direction from that feature's center, so edges favor concentric rings.
- Greedy and deterministic: visit candidate edges in sorted `(min id, max id)` order, flip when the exact change in the global energy (including the dihedral of the four side edges of the quad) is strictly negative, repeat sweeps until no flip happens or 50 sweeps. Because every applied flip lowers the global energy, sweeps terminate. Same input gives the same output.
- Weights are options with defaults chosen on the synthetic take; the generator prints the values it used.

### 3. Constraint chains for Flow (`tools/lib/meshOpt.mjs: enforceEdges`)
- Chains forced as edges: eye contour rings, outer and inner lip rings, both brow polylines, the nose bridge line (168 to 4), the alar lines (nostril rim), the nasolabial line on each side (a fixed landmark chain from the nose wing to the lip corner), and the oval.
- Enforcement uses the standard constraint-by-flips method: while a chain edge is crossed by existing edges, flip a crossing edge whose quad is convex; cap iterations and fail loudly if a constraint cannot be recovered. No new dependency.
- Hole cut for Flow: after enforcement, hole triangles are exactly those inside the eye and inner-lip rings, so each hole boundary is the contour ring itself, instead of the jagged boundary the centroid/spans rule leaves in Current and Flip.
- Locked edges for the optimization = all chain edges.

### 4. Generator changes (`tools/gen-face-topology.mjs`)
- `--variant current|flip|flow` selects what is written to the output; `--out <path>` overrides the output path (default `components/face/faceTopology.ts`); `--emit-candidates <path>` writes all three variants (low and full tables plus lip flags) as one JSON file for the comparison sheet.
- Lip flags are recomputed per variant with the existing rules.
- Prints a quality report per variant and mesh: triangle count; min-angle min and mean (3D); triangles with a min angle under 20 degrees; triangles with an aspect ratio over 3; interior valence histogram and the share at valence 5 to 7; edges flipped versus Current; mean and 90th-percentile dihedral across interior edges (degrees).
- Existing default behavior without flags is unchanged.

### 5. Comparison sheet (throwaway)
- A single dev hook file `components/face/topoSheetHook.ts` exports `topoHook(): { variant: 'current'|'flip'|'flow'; detail: 'low'|'full' } | null`. It returns null unless the build sets `import.meta.env.VITE_TOPO_SHEET`; the flag is a compile-time constant so normal builds drop the hook and the candidate JSON entirely. Under the flag it reads `window.__topo` (set by Playwright `addInitScript` before load), and Playwright injects the selected variant's tables as `window.__topo = { low, full, detail }` (no candidate data is ever bundled); `faceGeometry.ts` and `drawPuppet` consult it.
- `scripts/topo-sheet.mjs`: builds with `VITE_TOPO_SHEET=1` into a separate `dist-topo` (the normal `dist` is untouched), serves it, imports the synthetic take through the share viewer, and renders each variant (Current, Flip, Flow) x {low, full} x {front, orbit} at the pinned pose, in the shipped neon look. It also draws a wireframe of each variant (edges of the table over the frontal canonical projection, drawn by the script from the candidate JSON, no product code) because edge flow is easiest to judge from wires. One contact sheet PNG plus per-variant PNGs go to `.proof/<date>-topo/` (gitignored); the generator's quality report is saved beside them.
- The sheet script asserts: no page errors; each render non-blank; Flip and Flow differ from Current (more than 0.02% pixels; the real difference is asserted on the tables themselves, in the generator tests); the full-mesh Flip differs from Current full; a normal `dist` build contains no candidate table (grep for a marker string).

### 6. After Grayson picks
- Regenerate `faceTopology.ts` with the winning `--variant`, so the winner becomes the shipped table (low and full).
- Delete: the other variants' code paths if unused (the optimizer stays only if the winner uses it, as generator tooling), the hook file, `VITE_TOPO_SHEET` handling, the candidate JSON, and `scripts/topo-sheet.mjs` (moved to `_to_delete`). Record what was tried in `handoff-log/`.
- Re-run the full gate, plus one screenshot of the shipped mesh in Face Puppet and the viewer.

## Testing and gates
- `tools/lib/meshOpt.test.mjs` (vitest include gains `tools/**/*.test.mjs`): on small synthetic meshes with known answers: a flip preserves vertex set and triangle count; never creates a fold-over (all 2D signed areas keep their sign); never flips a locked or boundary edge; the sweep terminates and its global energy strictly decreases when any flip happens; output is deterministic; a long diagonal across a bent quad flips to the diagonal with the lower dihedral; `enforceEdges` makes a forced edge present across several crossings without changing the triangle count; an unrecoverable constraint throws.
- Per-variant validity tests (parameterized over Current, Flip, Flow from the emitted candidates): every undirected edge is in at most 2 triangles (manifold), no duplicate triangles, consistent winding in the frontal projection, indices 0..467, no triangle bridges the mouth or an eye hole, lip flags present (more than 10), triangle counts inside the existing bounds (250..450 low, 800..898 full). Flip: its boundary edge set equals Current's exactly. Flow: the whole boundary is exactly the oval ring plus the eye and inner-lip rings.
- Generator regression: `--variant current --out <tmp>` is byte-identical to the committed `faceTopology.ts`.
- Existing `faceTopology`, `faceGeometry`, `cavity`, `creaseGroups` tests keep passing for the shipped table.
- Full gate after the winner ships: `tsc`, `npm test`, `smoke`, `phone-check`, `share-check`, `cleanup-check`, `orbit-check`, `facedemo-check`.

## Risks
- Changing triangles changes shading under the Crease Angle slider and the cavity darkening gradients (vertex-indexed, so only their interpolation changes); judged on the sheet.
- Flow constraint chains may be unrecoverable for some landmark chains on the 2D triangulation; the generator fails loudly with the chain name, and the chain is then dropped or re-chosen (a spec-level decision, recorded in the handoff).
- Flow changes hole shape (rings become exact contours); the eye, teeth and mouth meshes are drawn from landmarks, not the table, so they are unaffected; verified on the sheet.
- The dev hook is a hidden global read only in a sheet-only build; normal builds are checked to contain no candidate data.
- Valence and dihedral weights are judgment calls; the sheet and quality report decide, not the numbers alone.

## Out of scope
Re-picking the vertex subset (the dropped Even variant), the silhouette / mask edge, subdivision or smoothing of the full mesh, runtime retriangulation, any change to eyes, teeth, brows, hands or looks.
