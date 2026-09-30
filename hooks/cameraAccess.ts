/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure permission and error logic for the camera + microphone flow (no React,
 * no DOM globals unless passed in), so vitest covers it. useTracker calls these;
 * the copy shown to people lives here so it is tested in one place.
 */

export type PermState = 'granted' | 'denied' | 'prompt' | 'unknown';
export type MicStatus = 'on' | 'off' | 'unavailable';

export type CameraIssueKind =
  | 'blocked' // the browser or OS said no (or a policy blocks it)
  | 'dismissed' // the prompt was closed without an answer
  | 'no-camera'
  | 'in-use' // another app or tab holds the camera
  | 'constraints'
  | 'insecure' // not https
  | 'unsupported' // no getUserMedia (in-app browsers, very old browsers)
  | 'unknown';

export type BrowserFamily =
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-edge'
  | 'ios-other'
  | 'android-chrome'
  | 'android-other'
  | 'desktop-chrome'
  | 'desktop-edge'
  | 'desktop-safari'
  | 'firefox'
  | 'other';

export interface CameraIssue {
  kind: CameraIssueKind;
  title: string;
  message: string;
  /** Numbered next steps (browser specific for `blocked`). Empty when there is nothing to do but retry. */
  steps: string[];
  /** A Try again tap can succeed (it never loops by itself; one request per tap). */
  canRetry: boolean;
  /** Reloading the page is a sensible second option (settings changes on some browsers need it). */
  canReload: boolean;
  /** The failed request included the microphone and the camera might work without it. */
  micOptional: boolean;
}

export function errorName(err: unknown): string {
  return (err as { name?: string } | null | undefined)?.name ?? '';
}

/** Family of the running browser, from the UA string. iPadOS 13+ reports as a Mac; touch points tell them apart. */
export function detectBrowser(ua: string, maxTouchPoints = 0): BrowserFamily {
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (iOS) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    if (/EdgiOS/.test(ua)) return 'ios-edge';
    if (/FxiOS|OPiOS|GSA\//.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) return /Chrome\//.test(ua) && !/EdgA|OPR\/|SamsungBrowser/.test(ua) ? 'android-chrome' : 'android-other';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'desktop-edge';
  if (/Chrome\//.test(ua)) return 'desktop-chrome';
  if (/Safari\//.test(ua)) return 'desktop-safari';
  return 'other';
}

export interface CameraEnv {
  secure: boolean;
  hasMediaDevices: boolean;
}

/** Checked BEFORE asking, so a doomed request never runs. null = fine to ask. */
export function checkEnvironment(env: CameraEnv): CameraIssueKind | null {
  if (!env.secure) return 'insecure';
  if (!env.hasMediaDevices) return 'unsupported';
  return null;
}

/** getUserMedia rejection -> what to tell the person. */
export function classifyCameraError(err: unknown): CameraIssueKind {
  const name = errorName(err);
  const message = String((err as { message?: string } | null | undefined)?.message ?? '');
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      // Chrome says "Permission dismissed" when the prompt was closed, "Permission denied" when it was refused.
      return /dismiss/i.test(message) ? 'dismissed' : 'blocked';
    case 'SecurityError':
      return 'blocked';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no-camera';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'constraints';
    case 'TypeError':
      // navigator.mediaDevices was undefined (non-https) or the constraints were malformed.
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/** Where to switch the permission back on, per browser. `mic` adds the microphone to the wording. */
export function blockedSteps(browser: BrowserFamily, mic: boolean): string[] {
  const cam = mic ? 'Camera and Microphone' : 'Camera';
  const retry = 'Come back here and tap Try again.';
  switch (browser) {
    case 'ios-safari':
      return ['Tap the aA button in the address bar.', 'Choose Website Settings.', `Set ${cam} to Allow.`, retry];
    case 'ios-chrome':
      return ['Open the Settings app and tap Chrome.', `Turn on ${cam}.`, retry];
    case 'ios-edge':
      return ['Open the Settings app and tap Edge.', `Turn on ${cam}.`, retry];
    case 'ios-other':
      return ['Open the Settings app and find this browser.', `Turn on ${cam}.`, retry];
    case 'android-chrome':
      return ['Tap the icon at the left of the address bar.', 'Choose Permissions.', `Allow ${cam}.`, retry];
    case 'desktop-chrome':
    case 'desktop-edge':
      return ['Click the camera or lock icon at the left of the address bar.', `Set ${cam} to Allow.`, 'Click Try again (or reload the page).'];
    case 'firefox':
      return ['Click the permissions icon at the left of the address bar.', `Clear the blocked ${cam} setting.`, 'Click Try again (or reload the page).'];
    case 'desktop-safari':
      return ['In the Safari menu choose Settings, then Websites.', `Set ${cam} to Allow for this site.`, 'Click Try again (or reload the page).'];
    default:
      return [`Allow ${cam} for this site in your browser's site settings.`, retry];
  }
}

export interface IssueOptions {
  browser?: BrowserFamily;
  /** The failed request asked for the microphone too. */
  withMic?: boolean;
  /** Offer "continue without microphone" (the failure may have been about the mic alone). */
  micOptional?: boolean;
}

/** The error matrix: kind -> words, steps and which buttons make sense. */
export function buildCameraIssue(kind: CameraIssueKind, opts: IssueOptions = {}): CameraIssue {
  const browser = opts.browser ?? 'other';
  const micOptional = !!opts.micOptional;
  const base = { kind, steps: [] as string[], canRetry: true, canReload: false, micOptional };
  switch (kind) {
    case 'blocked':
      return {
        ...base,
        title: 'Camera is blocked',
        message: 'Your browser is not letting this page use the camera.',
        steps: blockedSteps(browser, !!opts.withMic),
        canReload: true,
      };
    case 'dismissed':
      return {
        ...base,
        title: 'Camera not allowed yet',
        message: 'The camera request was closed. Tap Try again and choose Allow.',
      };
    case 'no-camera':
      return { ...base, title: 'No camera found', message: 'Connect or turn on a camera, then try again.' };
    case 'in-use':
      return {
        ...base,
        title: 'Camera is busy',
        message: 'Another app or browser tab is using it. Close that, then try again.',
      };
    case 'constraints':
      return {
        ...base,
        title: 'Camera not supported',
        message: 'This camera cannot give us the video we need. Try another camera or another browser.',
      };
    case 'insecure':
      return {
        ...base,
        title: 'Needs a secure page',
        message: 'The camera only works on https pages. Open this site with https://.',
        canRetry: false,
        canReload: true,
        micOptional: false,
      };
    case 'unsupported':
      return {
        ...base,
        title: 'Camera not available here',
        message: 'This browser cannot use the camera. Open the page in Safari or Chrome.',
        canRetry: false,
        micOptional: false,
      };
    default:
      return { ...base, title: 'Could not start the camera', message: 'Something went wrong. Try again.' };
  }
}

/** One sentence per failure, for consumers that only show a string (the other demos). */
export function issueSentence(issue: CameraIssue): string {
  return `${issue.title}. ${issue.message}`;
}

/**
 * The first request asked for camera AND microphone and failed. What next?
 *  - 'video-only': ask again for the camera alone, no prompt is lost (the failure was about the mic or a missing device).
 *  - 'offer':      cannot tell whose fault it is; show the error with a "continue without microphone" button (never re-prompt on our own).
 *  - 'none':       the camera itself is refused or the error is unrelated; show it.
 */
export function planAudioFallback(a: { errName: string; cameraState: PermState; withAudio: boolean }): 'video-only' | 'offer' | 'none' {
  if (!a.withAudio) return 'none';
  switch (a.errName) {
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'video-only';
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      if (a.cameraState === 'granted') return 'video-only'; // camera is fine, so the mic was refused
      if (a.cameraState === 'denied') return 'none';
      return 'offer'; // 'prompt' (closed the prompt) or unknown (Safari): do not loop the prompt
    default:
      return 'none';
  }
}

/**
 * On page load: can we skip the explainer? Only when every permission the start would ask for is already
 * decided, so the tap-free start can never show a prompt. requestMic is false when the mic is known denied.
 */
export function planStart(a: { camera: PermState; microphone: PermState; wantMic: boolean }): { autoStart: boolean; requestMic: boolean } {
  const requestMic = a.wantMic && a.microphone !== 'denied';
  const micSettled = !requestMic || a.microphone === 'granted';
  return { autoStart: a.camera === 'granted' && micSettled, requestMic };
}

/** Is the camera track still delivering? `muted` alone is not death (it is transient), the caller decides how long to wait. */
export function assessTrack(t: { readyState: string; muted: boolean } | null | undefined): 'ok' | 'muted' | 'ended' {
  if (!t || t.readyState === 'ended') return 'ended';
  return t.muted ? 'muted' : 'ok';
}

type PermissionsLike = { query?: (d: { name: string }) => Promise<{ state: string }> };

/** navigator.permissions.query, guarded: unsupported names (Firefox, older Safari) and throws become 'unknown'. */
export async function queryPermission(name: 'camera' | 'microphone', perms?: PermissionsLike | null): Promise<PermState> {
  try {
    if (!perms?.query) return 'unknown';
    const s = (await perms.query({ name })).state;
    return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Both states, but never wait long: a hung query must not hold the start screen back. */
export async function readPermissions(
  perms?: PermissionsLike | null,
  timeoutMs = 600,
): Promise<{ camera: PermState; microphone: PermState }> {
  const timeout = new Promise<PermState>((r) => setTimeout(() => r('unknown'), timeoutMs));
  const [camera, microphone] = await Promise.all([
    Promise.race([queryPermission('camera', perms), timeout]),
    Promise.race([queryPermission('microphone', perms), timeout]),
  ]);
  return { camera, microphone };
}
