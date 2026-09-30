/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which demo opens, from the URL. Face Puppet is the default (no params). `?demo=<id>` deep-links to
 * another demo, `?demo=menu` opens the all-demos overview; every other param (e.g. ?debug) is left alone.
 */
import { AppMode } from './types';

export const DEMO_IDS = ['face', 'game', 'aircanvas', 'telemetry', 'recorder'] as const satisfies readonly AppMode[];

export function resolveInitialMode(search: string): AppMode {
  const d = new URLSearchParams(search).get('demo');
  if (!d) return 'face';
  if (d === 'menu' || d === 'hub' || d === 'home') return 'home';
  return (DEMO_IDS as readonly string[]).includes(d) ? (d as AppMode) : 'face';
}

/** The query string (with leading "?" or empty) that reflects `mode`, keeping all other params. */
export function withDemoParam(search: string, mode: AppMode): string {
  const p = new URLSearchParams(search);
  if (mode === 'face') p.delete('demo');
  else p.set('demo', mode === 'home' ? 'menu' : mode);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** The take id when the page is a share link (`/t/<22 chars>`), else null. */
export function resolveTakeId(pathname: string): string | null {
  const m = /^\/t\/([A-Za-z0-9_-]{22})\/?$/.exec(pathname);
  return m ? m[1] : null;
}
