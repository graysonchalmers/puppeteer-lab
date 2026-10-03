/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sheet-only hook for the face topology comparison (scripts/topo-sheet.mjs): lets Playwright inject a candidate
 * triangle table through a window global. The build flag (vite.config.ts `define`, env VITE_TOPO_SHEET=1) is a
 * compile-time constant, so normal builds drop this branch and contain no candidate data. Deleted with the losing
 * variants. (The license comment is kept by the bundler, so it deliberately avoids the identifiers the build check greps.)
 */
declare const __TOPO_SHEET__: boolean;

export interface TopoTable { tris: readonly number[]; isLip: readonly (0 | 1)[] }
export interface TopoOverride { low: TopoTable; full: TopoTable; detail: 'low' | 'full' }

export function topoOverride(): TopoOverride | null {
  if (typeof __TOPO_SHEET__ === 'undefined' || !__TOPO_SHEET__) return null;
  return (globalThis as { __topo?: TopoOverride }).__topo ?? null;
}
