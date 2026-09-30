# 2026-09-30: Face Puppet is the default load; camera + microphone permission flow redone

## What happened
Grayson's first iPhone run: "mostly works", and the camera/microphone permission "seemed a little buggy". Face Puppet is to be the premiere example, so (1) it became the default load and (2) the permission flow was audited and rebuilt. Worktree branch `claude/default-permissions` (not pushed, not deployed).

## Audit (each item verified in code before fixing)
- (a) Record called `getUserMedia({audio:true})` mid-take while the camera was live. Present. Also a leak: Stop before the answer arrived left the mic stream open and the recorder started after Stop.
- (b) Camera opened on page load with no gesture and no explanation. Present.
- (c) Every denial collapsed into two sentences; NotAllowed vs dismissed vs busy vs no camera were not separated; no insecure/unsupported check before asking. Present.
- (d) Nothing listened to track `ended`/`mute`, `visibilitychange` or orientation: a stream the OS killed left a frozen puppet. Present.
- (e) Stale error only cleared on success; Retry always reloaded both models; double taps could stack requests; Flip stayed disabled after a failed open. Present.
- "Nothing leaves the device" checked: no upload path exists in the app (only asset fetches: vendored MediaPipe, and the game demo's song URL). Tailwind still loads from a CDN and the deploy adds a badge/analytics script, so the copy says "video and voice stay on this device", not "nothing leaves".

## Flow (state diagram)
```
load -> [query camera+mic permission, 600 ms cap]
   camera granted AND (mic granted | mic denied | mic not wanted) -> auto-start (no prompt possible)
   else -> START CARD  (nothing requested; "Record with sound" ticked by default)
START CARD --tap "Start camera"--> STARTING  (ONE getUserMedia: camera [+ mic]; models load in parallel)
STARTING --camera ok--> LIVE          (mic track kept aside, muted; Record/Stop only unmute/mute it)
STARTING --camera+mic failed--> planAudioFallback:
     video-only : retry camera alone, mic 'unavailable' (quiet note), LIVE
     offer      : ERROR card + "Continue without microphone" (user tap = one video-only request)
     none       : ERROR card
STARTING --camera failed--> ERROR card (kind) --Try again (one request per tap)--> STARTING
LIVE --track 'ended' | muted > 2.5 s | (checked on visible/pageshow/orientation)--> LOST card --Resume camera--> STARTING
LIVE --Flip--> STARTING (camera only; mic untouched)
LOST --track 'unmute'--> LIVE (automatic)
LIVE --60 s idle--> paused (existing overlay) --click--> STARTING (permission already granted)
```

## Error matrix
| error | kind | card | next step |
|---|---|---|---|
| NotAllowedError "denied", SecurityError | blocked | Camera is blocked | per-browser steps + Try again + Reload page (+ Continue without microphone when the mic may be the cause) |
| NotAllowedError "dismissed" | dismissed | Camera not allowed yet | Try again (re-prompts) |
| NotFoundError | no-camera | No camera found | Try again (camera+mic request first falls back to video-only once) |
| NotReadableError, AbortError | in-use | Camera is busy | close other app/tab, Try again |
| OverconstrainedError | constraints | Camera not supported | plain `video:true` is tried first; card only if that fails too; Try again |
| not https (checked before asking) | insecure | Needs a secure page | Reload page, no Try again |
| no mediaDevices / TypeError | unsupported | Camera not available here | open in Safari or Chrome, no Try again |
| other | unknown | Could not start the camera | Try again |
| model load failure | (unchanged) | red box with the message | Retry (full re-run) |

## Changes
- `hooks/cameraAccess.ts` (new, pure, 33 tests in `cameraAccess.test.ts`; `appRoute.test.ts` adds 8 more, 204 -> 245): browser detection, environment check, error classifier and copy, per-browser steps, `planAudioFallback`, `planStart`, `assessTrack`, guarded permission queries.
- `hooks/useTracker.ts` (rewritten setup): `enabled`, `audio` options; `status`, `cameraIssue`, `micStatus`, `audioStreamRef`, `resumeCamera`, `enableMic`, `skipMic` returned; camera request before models; track watching; idle hold while a prompt is open.
- `hooks/useRecorder.ts`: optional shared audio source (borrowed tracks are muted, never stopped); stale-request guard for the legacy path (other demos).
- `components/CameraPanels.tsx`, `components/DemoSwitcher.tsx` (new); `FaceDemo.tsx`, `DemoHub.tsx`, `PhoneBar.tsx`, `RecorderControls.tsx`, `App.tsx`, `appRoute.ts` (+test) edited.
- `scripts/phone-check.mjs` rewritten: 97 checks.

## Verification
typecheck clean; 245 tests; smoke OK; `npm run phone-check` 97/97. Screenshots in `.proof/2026-09-30-default-permissions/` (gitignored). Chromium used a fake camera (no face, so the live puppet shows "waiting for a face"; the puppet shots are a REPLAY of `tools/fixtures/synthetic-face-hands-take.json`). WebKit has no camera and no `navigator.mediaDevices` in Playwright: its error cards are stubbed rejections plus one real (unsupported) tap.

## Only reasoned (not observed on any iOS/Android device)
- iOS prompt wording and whether a combined camera+mic request is one prompt or two.
- That the combined request avoids the older iOS bug where a later audio request muted the camera.
- Whether iOS fires `mute`/`ended` on the camera track on backgrounding, and how quickly `unmute` returns.
- Settings paths in the blocked-card steps for iOS Safari/Chrome/Edge and Android Chrome.
- That `permissions.query({name:'camera'})` returns a useful state on iOS Safari (assumed unknown; planStart then keeps the start card).
- That a held, muted mic track still shows the OS recording indicator (assumed yes; the copy says "only recorded while you record").
- That "Permission dismissed" appears in the message in Chrome on Android.

## Decisions left for Grayson
1. Mic in the first prompt (default ticked) vs off by default. Ticked keeps Record silent-prompt-free; the cost is a mic prompt (and possibly an OS mic indicator all session) for someone who only wanted to see the puppet.
2. Other four demos still request the camera on load (and Tempo Strike etc. ask for the mic on Record); a `?demo=` deep link to them prompts immediately. Gate them too?
3. Web-GC card copy stays "desktop webcam" until a real phone run.
