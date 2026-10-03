# Face Puppet looks: design pass on shading and light

Date: 2026-10-03. Status: approved in chat, spec for review.

**Outcome (2026-10-03):** Grayson picked **neon**. It shipped as the single `LOOK` in `looks.ts`; the other candidates, the old default, `?look=`/`?mesh=`, the toon/outline/hemisphere code and the sheet script were deleted. The face now shades with outward normals unconditionally (see `handoff-log/2026-10-03-face-puppet-looks.md`).

## Intent
Grayson wants a design pass on how the Face Puppet head and its scene lighting look, with a few distinct options to choose from. Success: four candidate looks rendered side by side, one chosen by Grayson, and that one shipped as the new default with the other three removed.

Stated by Grayson:
- The look has to serve live view, exported video / share clips, and the portfolio equally, so every candidate must hold up live, in an export, and at phone size.
- The options are candidates for choosing one winner. There is no user-facing selector.
- Shading, light and material only. Topology (`low` 298 tris, `full`) is untouched.

Assumptions (flagged, correctable):
- Eyes, teeth, brows and lips stay self-lit and fixed-color so they read under every look. Hands take each look's skin color and lights.
- The default look must equal today's rendering exactly, so merging the machinery changes nothing visible.

## Current state
- `components/face/PuppetScene.ts`: `addLights()` builds a 3-light white rig (ambient 0.15, key 3.2, fill 0.7, rim 2.5) rotated with the camera; `skinMat` is a `MeshStandardMaterial` (roughness 0.75, vertex colors); background `BG 0x090a0c`; hand color `SKIN_HAND 0xa3a7ad`.
- `components/face/faceGeometry.ts`: `SKIN_GRAY 0.62`, `LIP_GRAY 0.45` baked into per-corner vertex colors by `createFaceBuffers`; crease-angle normals from `creaseGroups.ts`.
- `components/face/FaceMeshRenderer.ts` `drawPuppet(ctx, ..., opts)` passes `creaseAngle` and `meshDetail` into `PuppetScene.render`. Both FaceDemo (live, export) and TakeViewer (share viewer) go through it.

## Design

### 1. `components/face/looks.ts` (new, pure data, no three.js import)
```
type LookId = 'default' | 'clay' | 'faceted' | 'toon' | 'neon';
interface Look {
  id: LookId;
  background: number;        // clear color
  skinGray: number; lipGray: number;
  creaseAngle: number | null; // null = use the UI slider value
  skin: 'standard' | 'toon';
  toonBands: number;          // used when skin = 'toon'
  roughness: number;
  cavity: number;             // 0..1 strength of baked cavity darkening
  tint: { skin: number; lip: number }; // multiplied into vertex gray, 0xffffff = neutral
  ambient: { color: number; intensity: number };
  lights: { color: number; intensity: number; pos: [number, number, number] }[];
  hemisphere?: { sky: number; ground: number; intensity: number };
  outline?: { color: number; width: number };
  handColor: number;
}
export const LOOKS: Record<LookId, Look>;
export const DEFAULT_LOOK: LookId; // 'default' until Grayson picks
export function lookById(id: string | null | undefined): Look; // unknown id falls back to the default look
```
The `default` look carries today's literals verbatim. `PuppetScene.ts` stops owning those constants; it reads them from the active look.

### 2. Applying a look
- `SceneInput` gains `look?: Look`. A new `PuppetScene.applyLook(look)` runs only when the look id changes, never per frame: rebuild the light rig children, swap `skinMat` between `MeshStandardMaterial` and `MeshToonMaterial` (shared gradient map from `toonBands`), set the clear color, hand material color, and, when `outline` is set, show a back-face hull mesh.
- Vertex gray and cavity weights are written by `createFaceBuffers` from `look.skinGray`, `look.lipGray`, `look.tint` and `look.cavity`. Changing look triggers one buffer rebuild, the same path `ensureFace` already uses for a mesh-detail change. No per-frame allocation is added.
- Cavity darkening: a static per-vertex weight table in `looks.ts` or `faceTopology.ts`, built from fixed landmark index sets (eye sockets, nostrils, under-lip, inner nose wing). It darkens vertex gray; it never touches geometry.
- Toon outline: second draw of the face geometry with `BackSide` and a basic material, vertices pushed along the existing crease normals in the same `Float32Array` pass. Hands skip the outline unless the look sets it.
- Self-lit parts (eyes, teeth, seam, lips-closed, brows, cavity) keep `MeshBasicMaterial` and are unaffected.
- `drawPuppet` opts gain `look?: Look`; FaceDemo and TakeViewer pass nothing and get the default look.

### 3. Candidate looks
Values are starting points, tuned on the sheet.
- **clay**: warm matte skin (roughness ~0.9), soft wide key with a cool rim, moderate cavity darkening, slightly lifted background.
- **faceted**: `creaseAngle: 0` (every facet visible), hemisphere light, one hard key, raised contrast, no cavity.
- **toon**: `MeshToonMaterial` with 3 bands, flat color skin, dark outline, low cavity.
- **neon**: darker skin, cyan and magenta rim lights from opposite sides, faint cool fill, strong cavity, near-black background.

### 4. Comparison sheet (throwaway tool, no product UI)
- `scripts/looks-sheet.mjs`, in the style of `facedemo-check`: builds `dist/`, serves it with vite preview, imports the synthetic take through the real file input in Chromium, then for each look in `LOOKS` and each of {low, full} x {front, orbit} captures the stage canvas at one pinned time (hands in frame).
- A look is selected through a `?look=<id>` query param read once at mount by `lookById`. Unknown ids fall back to the default look. The param exists for this script only and is removed together with the losing looks.
- Output: per-look PNGs plus one contact sheet in `.proof/<date>-looks/` (gitignored). A phone-width crop (390 px) of each look is included to judge legibility.
- The sheet script asserts: each render is non-blank, and no two looks produce a bitwise-identical image.

### 5. After Grayson picks
- Copy the winner's values into the `default` look, delete the other three looks, the `?look=` param and, unless Grayson wants to keep it, the sheet script. The comparison sheet and rationale go into `handoff-log/`.
- If the winner needs the toon outline or hemisphere light, keep only the code paths it uses.

## Testing and gates
- `looks.test.ts` (unit, new): every look defines every field, all light intensities and gray values are in range, `lookById` falls back correctly, and the `default` look equals the pre-change constants.
- `PuppetScene` default-look regression: with the default look, `facedemo-check`, `orbit-check` and `cleanup-check` pass unchanged.
- Sheet script assertions as in section 4.
- Export: after the winner ships, run one real export and inspect one frame.
- Full gate on completion: typecheck, unit tests, smoke, `phone-check`, `share-check`, `cleanup-check`, `orbit-check`, `facedemo-check`.

## Risks
- Toon outline via inverted hull can show cracks at sharp creases on the low mesh. Mitigation: push along the smoothed crease normals; judge it on the sheet; drop the look if it fails.
- A look change recreates materials once. The `applyLook` path must dispose the old material to avoid leaking on repeated switches (only the sheet script switches looks in practice).
- Cavity weights depend on landmark index sets; wrong indices darken the wrong region. The sheet shows it immediately.
- The `?look=` param is a hidden dev hook in a public build until the winner ships. It only selects among built-in looks and has no other effect.

## Out of scope
Topology changes, a user-facing Look selector, persisting a look per viewer, per-look eye or teeth restyling, post-processing passes.
