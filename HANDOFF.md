# 🧭 Session Handoff - Puppeteer Lab

_Last updated: 2026-09-04 19:25 ET_

## 🎯 Current state
Imported and running locally. "Puppeteer Lab" is a zero-hardware webcam tracking + recording framework (React 18 + React-Three-Fiber + Three.js 0.167 + `@mediapipe/tasks-vision`). Four demos in a hub: Air Canvas, Tempo Strike, Motion Recorder, Face Puppet. `npm install` clean, Vite dev boots on :3000, hub renders with zero console errors. Now a PUBLIC GitHub repo, pushed.

## 📌 Where we stopped
Initial import + local verification complete, and the code is live on GitHub. Nothing is mid-flight. The camera demos have not yet been exercised end-to-end with a real webcam (the in-app preview browser has no camera grant).

## ▶️ Next concrete step
Open `http://localhost:3000` in real Chrome (run `npm run dev` first), allow camera + mic, and click into one demo (e.g. Launch Canvas) to confirm MediaPipe hand tracking actually initializes and tracks. Alternatives:
- Skip straight to feature work: the `demos/*/PLANNING.md` files hold per-demo roadmaps to pick from.
- Wire CI or a Vercel/Pages deploy if a public live URL is wanted (it is a static Vite build).

## ❓ Open questions
- The `GEMINI_API_KEY` in `.env.local` is a placeholder and unused (no source references it, no `@google/genai` dep). The AI Studio "server-side Gemini" flag in `metadata.json` is vestigial. Decide later whether any demo (e.g. data-visualizer) is meant to use Gemini, or strip the scaffolding.
- Branch is `main` (renamed from `master` on import). No CI, no deploy yet.

## 🗂️ Changed this session
- Branch: `main` (fresh repo, 1 commit + handoff commit)
- Repo: https://github.com/graysonchalmers/puppeteer-lab (PUBLIC)
- Created: project folder from `puppeteer-lab.zip`, `.claude/launch.json`, local git repo, this `HANDOFF.md`
- Decisions (+ why): named it `Tool-PuppeteerLab` locally (framework-with-demos, not a single game); kept `.env.local` placeholder as-is (harmless, and `*.local` keeps it out of git); renamed default branch to `main` for a clean modern default on the new public repo; did NOT mass-kill node processes (diagnostic showed 0 provably orphaned; the 57 were 47 live MCP servers + live dev servers + Stream Deck).

---

## 🕓 Session log
### 2026-09-04 - Import, local verify, public GitHub repo
- Found `puppeteer-lab.zip` (211 KB) in Downloads, extracted to `C:\Projects-local\Tool-PuppeteerLab`.
- `npm install` (151 pkgs, clean), Vite dev on :3000, hub renders, zero console errors.
- `git init` + initial commit; created PUBLIC repo `graysonchalmers/puppeteer-lab`, renamed branch to `main`, pushed (HTTPS via gh credential helper after SSH publickey failed).
- Node-process cleanup requested: diagnosed as NOT a pileup (0 provably orphaned; bulk is 47 live MCP servers). Only stopped my own puppeteer-lab dev server.
- Verified no `.env.local` / `node_modules` / secrets in the tracked tree (40 files).
