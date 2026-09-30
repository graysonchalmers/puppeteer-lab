import { describe, it, expect } from 'vitest';
import { resolveInitialMode, withDemoParam, resolveTakeId, isTakePath } from './appRoute';

describe('resolveInitialMode', () => {
  it('opens Face Puppet with no params (the default load)', () => {
    expect(resolveInitialMode('')).toBe('face');
    expect(resolveInitialMode('?')).toBe('face');
  });
  it('keeps ?debug from changing the demo', () => {
    expect(resolveInitialMode('?debug')).toBe('face');
  });
  it('deep-links to each other demo', () => {
    expect(resolveInitialMode('?demo=telemetry')).toBe('telemetry');
    expect(resolveInitialMode('?demo=aircanvas')).toBe('aircanvas');
    expect(resolveInitialMode('?demo=game')).toBe('game');
    expect(resolveInitialMode('?demo=recorder')).toBe('recorder');
    expect(resolveInitialMode('?debug&demo=telemetry')).toBe('telemetry');
  });
  it('opens the overview for ?demo=menu', () => {
    expect(resolveInitialMode('?demo=menu')).toBe('home');
    expect(resolveInitialMode('?demo=hub')).toBe('home');
  });
  it('falls back to Face Puppet for an unknown demo', () => {
    expect(resolveInitialMode('?demo=nope')).toBe('face');
    expect(resolveInitialMode('?demo=')).toBe('face');
  });
});

describe('withDemoParam', () => {
  it('drops the param for Face Puppet and keeps the others', () => {
    expect(withDemoParam('?demo=telemetry&debug=', 'face')).toBe('?debug=');
    expect(withDemoParam('?demo=telemetry', 'face')).toBe('');
  });
  it('sets the param for another demo and for the overview', () => {
    expect(withDemoParam('', 'telemetry')).toBe('?demo=telemetry');
    expect(withDemoParam('?debug', 'game')).toBe('?debug=&demo=game');
    expect(withDemoParam('', 'home')).toBe('?demo=menu');
  });
  it('round-trips through resolveInitialMode', () => {
    for (const m of ['face', 'game', 'aircanvas', 'telemetry', 'recorder', 'home'] as const) {
      expect(resolveInitialMode(withDemoParam('?debug', m))).toBe(m);
    }
  });
});

describe('resolveTakeId', () => {
  const id = 'AbCdEfGhIjKlMnOpQrStUv';
  it('reads a 22-char id from /t/<id>, with or without a trailing slash', () => {
    expect(resolveTakeId(`/t/${id}`)).toBe(id);
    expect(resolveTakeId(`/t/${id}/`)).toBe(id);
  });
  it('ignores everything else', () => {
    for (const p of ['/', '/t', '/t/', '/t/short', `/t/${id}x`, `/x/t/${id}`, `/t/${id}/more`, '/t/../etc']) {
      expect(resolveTakeId(p)).toBeNull();
    }
  });
});

describe('isTakePath', () => {
  it('is true for anything under /t/, so a cut-off or mistyped link reaches the viewer (not Face Puppet)', () => {
    for (const p of ['/t/AbCdEfGhIjKlMnOpQrStUv', '/t/short', '/t/', '/t/AbCdEfGhIjKlMnOpQrStUvx', '/t/a/b']) {
      expect(isTakePath(p)).toBe(true);
    }
  });
  it('is false elsewhere', () => {
    for (const p of ['/', '/t', '/x/t/abc', '/tt/abc', '/index.html']) {
      expect(isTakePath(p)).toBe(false);
    }
  });
});
