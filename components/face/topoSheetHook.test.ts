import { describe, it, expect } from 'vitest';
import { topoOverride } from './topoSheetHook';

describe('topoSheetHook', () => {
  it('is off in normal builds and under vitest, even if window.__topo is set', () => {
    (globalThis as { __topo?: unknown }).__topo = { low: { tris: [], isLip: [] }, full: { tris: [], isLip: [] }, detail: 'low' };
    expect(topoOverride()).toBeNull();
    delete (globalThis as { __topo?: unknown }).__topo;
  });
});
