# 2026-10-03 (evening): pushed main and redeployed the static site (neon look, normals fix, Flip mesh)

Continues `2026-10-03-face-puppet-looks.md` and `2026-10-03-face-mesh-topology.md`. At Grayson's request pushed `main` and redeployed mocap.graysonchalmers.com. Nothing under `server/` changed, so the API container and uploads (off) were untouched.

## What was done
- `git push origin main`: `89893be..46626df`, 37 commits, clean fast-forward; then docs-only `a8f774a` (HANDOFF records the push and deploy). Sync confirmed `0 0`.
- Static redeploy via the go-live static path: fresh `npm run build` (stamp `v0.0.0 🧭 HOBBY · 46626d · 2026-10-03`), secret gate on `dist/assets` empty (`sk-or-`, `AIza`, `GEMINI_API_KEY`; no `__topo` sheet-hook marker), shared `kit.graysonchalmers.com/badge.js` injected into `dist/index.html`, tar over ssh to `/tmp/mocap-up`, new hashed assets copied first, `index.html` swapped last (backup `/var/www/mocap/index.html.bak-20261003193915`), stale assets pruned, `root:root` + `a+rX`. No Caddy change.

## Verified live
200 on `/`; live bundle `index-Bos7gfMw.js` equals the local build; every local asset 200; `/api/health` 200; `/api/config` uploads off; `/t/<id>` 200; stamp present in the live chunk; a Playwright run on the live viewer with a mocked take (neon look, orbit drag, zero page errors or failed requests). Proof (gitignored): `.proof/2026-10-03-live2/`; stills sent to Grayson.

## Why mocked
Uploads are off, so no real shared link exists; the viewer only renders for a saved take. Nothing was checked on a real phone or with a live camera.

## Also recorded
`_agent-commons/state/apps-01-server.md` (2026-10-03 third entry), project memory `deploy-live.md`, commons logs `2026-10-03-claude-code-puppeteerlab-{looks-spec,looks-and-mesh-built,pushed-and-deployed-neon-flip}.md`.
