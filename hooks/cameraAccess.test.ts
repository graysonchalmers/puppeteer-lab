import { describe, it, expect } from 'vitest';
import {
  detectBrowser,
  checkEnvironment,
  classifyCameraError,
  blockedSteps,
  buildCameraIssue,
  planAudioFallback,
  planStart,
  assessTrack,
  queryPermission,
  readPermissions,
  issueSentence,
} from './cameraAccess';

const dom = (name: string, message = '') => ({ name, message });

describe('detectBrowser', () => {
  const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  it('tells iOS browsers apart (all WebKit, different Settings paths)', () => {
    expect(detectBrowser(IPHONE_SAFARI)).toBe('ios-safari');
    expect(detectBrowser(IPHONE_SAFARI.replace('Version/17.5', 'CriOS/126.0'))).toBe('ios-chrome');
    expect(detectBrowser(IPHONE_SAFARI.replace('Version/17.5', 'EdgiOS/126.0'))).toBe('ios-edge');
    expect(detectBrowser(IPHONE_SAFARI.replace('Version/17.5', 'FxiOS/126.0'))).toBe('ios-other');
  });
  it('treats an iPad that reports as a Mac as iOS only when it has touch', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(detectBrowser(mac, 5)).toBe('ios-safari');
    expect(detectBrowser(mac, 0)).toBe('desktop-safari');
  });
  it('finds Android Chrome, desktop Chrome/Edge/Firefox', () => {
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36')).toBe('android-chrome');
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/126.0.0.0 SamsungBrowser/25.0 Mobile Safari/537.36')).toBe('android-other');
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36')).toBe('desktop-chrome');
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')).toBe('desktop-edge');
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('firefox');
    expect(detectBrowser('')).toBe('other');
  });
});

describe('checkEnvironment', () => {
  it('flags an insecure page before any request', () => {
    expect(checkEnvironment({ secure: false, hasMediaDevices: false })).toBe('insecure');
    expect(checkEnvironment({ secure: false, hasMediaDevices: true })).toBe('insecure');
  });
  it('flags a browser with no getUserMedia (in-app webviews)', () => {
    expect(checkEnvironment({ secure: true, hasMediaDevices: false })).toBe('unsupported');
  });
  it('lets a normal page through', () => {
    expect(checkEnvironment({ secure: true, hasMediaDevices: true })).toBeNull();
  });
});

describe('classifyCameraError (the error matrix input)', () => {
  it('maps every DOMException name we expect to a kind', () => {
    expect(classifyCameraError(dom('NotAllowedError', 'Permission denied'))).toBe('blocked');
    expect(classifyCameraError(dom('NotAllowedError', 'Permission dismissed'))).toBe('dismissed');
    expect(classifyCameraError(dom('NotAllowedError', 'The request is not allowed by the user agent or the platform'))).toBe('blocked');
    expect(classifyCameraError(dom('SecurityError'))).toBe('blocked');
    expect(classifyCameraError(dom('NotFoundError'))).toBe('no-camera');
    expect(classifyCameraError(dom('NotReadableError'))).toBe('in-use');
    expect(classifyCameraError(dom('AbortError'))).toBe('in-use');
    expect(classifyCameraError(dom('OverconstrainedError'))).toBe('constraints');
    expect(classifyCameraError(new TypeError('x'))).toBe('unsupported');
    expect(classifyCameraError(dom('Weird'))).toBe('unknown');
  });
  it('never throws on junk', () => {
    expect(classifyCameraError(null)).toBe('unknown');
    expect(classifyCameraError(undefined)).toBe('unknown');
    expect(classifyCameraError('boom')).toBe('unknown');
  });
});

describe('blockedSteps', () => {
  it('gives the iPhone Safari path and mentions the mic only when it was requested', () => {
    const cam = blockedSteps('ios-safari', false).join(' ');
    expect(cam).toMatch(/aA/);
    expect(cam).toMatch(/Website Settings/);
    expect(cam).not.toMatch(/Microphone/);
    expect(blockedSteps('ios-safari', true).join(' ')).toMatch(/Camera and Microphone/);
  });
  it('sends iOS Chrome and Edge to the Settings app, not the address bar', () => {
    expect(blockedSteps('ios-chrome', false).join(' ')).toMatch(/Settings app.*Chrome/);
    expect(blockedSteps('ios-edge', false).join(' ')).toMatch(/Settings app.*Edge/);
  });
  it('has steps for every browser family, always ending in a way back', () => {
    for (const b of ['ios-safari', 'ios-chrome', 'ios-edge', 'ios-other', 'android-chrome', 'android-other', 'desktop-chrome', 'desktop-edge', 'desktop-safari', 'firefox', 'other'] as const) {
      const steps = blockedSteps(b, true);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[steps.length - 1]).toMatch(/Try again/);
    }
  });
});

describe('buildCameraIssue', () => {
  it('blocked: browser steps, retry and reload', () => {
    const i = buildCameraIssue('blocked', { browser: 'android-chrome', withMic: true });
    expect(i.title).toMatch(/blocked/i);
    expect(i.steps.join(' ')).toMatch(/Permissions/);
    expect(i.canRetry && i.canReload).toBe(true);
  });
  it('dismissed and unknown: plain retry, no steps', () => {
    for (const k of ['dismissed', 'unknown'] as const) {
      const i = buildCameraIssue(k);
      expect(i.steps).toEqual([]);
      expect(i.canRetry).toBe(true);
    }
  });
  it('no-camera and in-use say what to do', () => {
    expect(buildCameraIssue('no-camera').message).toMatch(/camera/i);
    expect(buildCameraIssue('in-use').message).toMatch(/another app or browser tab/i);
  });
  it('insecure and unsupported offer no Try again (it cannot succeed)', () => {
    expect(buildCameraIssue('insecure').canRetry).toBe(false);
    expect(buildCameraIssue('insecure').canReload).toBe(true);
    expect(buildCameraIssue('unsupported').canRetry).toBe(false);
    expect(buildCameraIssue('unsupported').message).toMatch(/Safari or Chrome/);
  });
  it('micOptional is kept on kinds a retry can fix and dropped on the others', () => {
    expect(buildCameraIssue('blocked', { micOptional: true }).micOptional).toBe(true);
    expect(buildCameraIssue('insecure', { micOptional: true }).micOptional).toBe(false);
    expect(buildCameraIssue('blocked').micOptional).toBe(false);
  });
  it('issueSentence joins title and message', () => {
    expect(issueSentence(buildCameraIssue('no-camera'))).toBe('No camera found. Connect or turn on a camera, then try again.');
  });
});

describe('planAudioFallback (camera+mic request failed: what next?)', () => {
  const p = (errName: string, cameraState: any, withAudio = true) => planAudioFallback({ errName, cameraState, withAudio });
  it('never falls back when audio was not requested', () => {
    expect(p('NotAllowedError', 'granted', false)).toBe('none');
    expect(p('NotFoundError', 'unknown', false)).toBe('none');
  });
  it('a missing or busy device retries video-only (a desktop with no mic must still get its camera)', () => {
    expect(p('NotFoundError', 'unknown')).toBe('video-only');
    expect(p('OverconstrainedError', 'prompt')).toBe('video-only');
    expect(p('NotReadableError', 'granted')).toBe('video-only');
  });
  it('refused with the camera already granted = the mic was refused: video-only', () => {
    expect(p('NotAllowedError', 'granted')).toBe('video-only');
  });
  it('refused with the camera denied: show the error, do not ask again', () => {
    expect(p('NotAllowedError', 'denied')).toBe('none');
  });
  it('refused with the camera still undecided or unknowable: offer, never auto-retry (would loop the prompt)', () => {
    expect(p('NotAllowedError', 'prompt')).toBe('offer');
    expect(p('NotAllowedError', 'unknown')).toBe('offer');
    expect(p('SecurityError', 'unknown')).toBe('offer');
  });
  it('unrelated errors are shown as they are', () => {
    expect(p('TypeError', 'granted')).toBe('none');
  });
});

describe('planStart (skip the explainer only when no prompt can appear)', () => {
  it('auto-starts when camera and wanted mic are both granted', () => {
    expect(planStart({ camera: 'granted', microphone: 'granted', wantMic: true })).toEqual({ autoStart: true, requestMic: true });
  });
  it('auto-starts camera-only when no mic is wanted, whatever the mic state', () => {
    expect(planStart({ camera: 'granted', microphone: 'prompt', wantMic: false })).toEqual({ autoStart: true, requestMic: false });
  });
  it('a known-denied mic is not requested and does not block the auto-start', () => {
    expect(planStart({ camera: 'granted', microphone: 'denied', wantMic: true })).toEqual({ autoStart: true, requestMic: false });
  });
  it('shows the explainer when the mic would still prompt', () => {
    expect(planStart({ camera: 'granted', microphone: 'prompt', wantMic: true })).toEqual({ autoStart: false, requestMic: true });
    expect(planStart({ camera: 'granted', microphone: 'unknown', wantMic: true }).autoStart).toBe(false);
  });
  it('shows the explainer when the camera is not granted (or the API is missing)', () => {
    expect(planStart({ camera: 'prompt', microphone: 'granted', wantMic: true }).autoStart).toBe(false);
    expect(planStart({ camera: 'denied', microphone: 'granted', wantMic: true }).autoStart).toBe(false);
    expect(planStart({ camera: 'unknown', microphone: 'unknown', wantMic: false }).autoStart).toBe(false);
  });
});

describe('assessTrack', () => {
  it('ended and missing tracks are dead', () => {
    expect(assessTrack({ readyState: 'ended', muted: false })).toBe('ended');
    expect(assessTrack(null)).toBe('ended');
  });
  it('a muted live track is only muted (transient), not dead', () => {
    expect(assessTrack({ readyState: 'live', muted: true })).toBe('muted');
    expect(assessTrack({ readyState: 'live', muted: false })).toBe('ok');
  });
});

describe('queryPermission / readPermissions (guarded)', () => {
  it('returns the state when supported', async () => {
    const perms = { query: async ({ name }: { name: string }) => ({ state: name === 'camera' ? 'granted' : 'denied' }) };
    expect(await queryPermission('camera', perms)).toBe('granted');
    expect(await queryPermission('microphone', perms)).toBe('denied');
    expect(await readPermissions(perms)).toEqual({ camera: 'granted', microphone: 'denied' });
  });
  it('is unknown when the API or the name is unsupported, or it throws', async () => {
    expect(await queryPermission('camera', undefined)).toBe('unknown');
    expect(await queryPermission('camera', {})).toBe('unknown');
    expect(await queryPermission('camera', { query: async () => { throw new TypeError('bad name'); } })).toBe('unknown');
    expect(await queryPermission('camera', { query: async () => ({ state: 'weird' }) })).toBe('unknown');
  });
  it('does not wait forever on a hung query', async () => {
    const hung = { query: () => new Promise<{ state: string }>(() => {}) };
    expect(await readPermissions(hung, 20)).toEqual({ camera: 'unknown', microphone: 'unknown' });
  });
});
