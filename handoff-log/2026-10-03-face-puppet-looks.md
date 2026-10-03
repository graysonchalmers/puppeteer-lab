# 2026-10-03 (later): Face Puppet looks, neon shipped

Continues `2026-10-03-push-and-live-redeploy.md`. A design pass on how the Face Puppet head, hands and scene light look: four candidate looks rendered side by side, Grayson picked one, it shipped as the only look and the rest was deleted. Spec `docs/superpowers/specs/2026-10-03-face-puppet-looks-design.md`, plan `docs/superpowers/plans/2026-10-03-face-puppet-looks.md`. Executed subagent-driven (implementer + review per task). **Local `main` only: not pushed, not deployed** (the live site still shows the gray look).

## What was tried
A temporary `looks.ts` held the old gray `default` plus four candidates. `PuppetScene` applied a look once (lights, skin/hand materials, background, baked gray/tint/cavity in the face buffers), and `scripts/looks-sheet.mjs` rendered every look through the share viewer (`/t/<id>?look=<id>&mesh=<low|full>`) at a pinned pose, front and orbited, into one contact sheet. It asserted non-blank, pairwise-distinct and default-equals-the-pre-looks-baseline (0.000%).
- **clay:** warm terracotta matte, soft studio light. The most "product render"; soft contrast, can read as tan skin.
- **faceted:** icy low-poly gem, crease angle 0, hard key. Striking in orbit; the full mesh gets busy around nose and mouth.
- **toon:** 3-band cel shading with an inverted-hull outline on slate. The most readable at phone size; no inner lines.
- **neon:** dark navy head, cyan and magenta rims on black. The most dramatic for clips; orbit is mostly magenta, brows and hands dim at phone size.

**Grayson picked neon** ("Go with neon"), and asked for a mesh-redesign pass as a separate next thread.

## Root cause found on the way: the face was lit from the wrong side
`updateFaceBuffers` points every normal toward the camera, but the x-mirror makes the face triangles back-facing, and three's double-sided shading multiplies the normal by `faceDirection`. So the face was shaded with inverted normals: every light acted as if it sat at `-pos`, while the (unmirrored) hands were lit correctly. The old gray look had been tuned under the inversion (its "rim" behind the head was really its front light). During tuning a `trueNormals` look flag negated the face normals per frame; with neon shipped it is unconditional, so face and hands now share light directions and the specular lands where it should.

## Toon outline, dropped with toon
The first inverted hull (pushed along the normals, then pushed back in depth) blackened the face or left a cheek wedge and slivers through sloped triangles. Drawing the hull first (`renderOrder -1`) with `depthWrite: false` and a view-perpendicular push fixed that: the skin always paints over it, so it only shows past the silhouette (no inner lines by design). It went away with toon.

## What shipped
`looks.ts` exports one `LOOK` (neon values, pure data) and `shadeOf`; `PuppetScene` builds its two light rigs and the skin/hand `MeshStandardMaterial`s from it once. Deleted: the other looks and the gray default, `LOOKS`/`lookById`/`LookId`/`DEFAULT_LOOK_ID`, `?look=`/`?mesh=` in `TakeViewer`, `look` in `PuppetOptions`/`SceneInput`, the per-id apply/restyle, toon material and gradient, the outline hull, hemisphere light, the crease-angle override and the `trueNormals` field. Kept: `cavity.ts` (neon uses cavity 0.8), `FaceShade`/`DEFAULT_SHADE`, `openViewer(..., query)`. The sheet script went to `C:\Projects-local\_to_delete\Tool-PuppeteerLab-2026-10-03-looks-sheet\`. The shipped viewer render equals the pre-ship `?look=neon` render at 0.0000% pixel difference.

## Gates
typecheck clean, 437 tests, smoke OK, `phone-check` 97/97, `share-check` 28/28, `cleanup-check` 7/7, `orbit-check` 11/11, `facedemo-check` 27/27 (three runs each of orbit/facedemo, all green and identical). First run was 26/27: "orbit at rest looks like the front view" read 9.22% against an 8% bound (7.38% on the gray look). The silhouette difference was unchanged (about 45k pixels either way); the extra is interior shading, from neon's glossier skin and strong rims under the perspective camera's per-pixel view direction. Ruling: the bound was calibrated to the gray look, raised to 11% with a calibration comment. The drag check (`moved > 3x rest`) was left as is; it is deterministic but thin (28.3% vs 27.7%).

Also from review: neon's background moved from `0x050508` to `0x090a0c`, equal to `STAGE_BG`, so the stage canvas has no seam against its container.

## Export check
In the built app (vite preview, Chromium with the fake-camera flags), the synthetic take imported through the real file input, the primary export button ("Video") clicked: a 3.7 s mp4 (vp9, 1120x900, 273 KB) downloaded after 5.3 s, no dialogs or page errors. A frame at 0.5 s (ffmpeg) shows the neon head and hands on black. Proof (gitignored): `.proof/2026-10-03-neon-shipped/`.
