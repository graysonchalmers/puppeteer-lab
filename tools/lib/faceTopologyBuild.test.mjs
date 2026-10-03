import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVariants, SETS } from './faceTopologyBuild.mjs';

const OBJ = 'tools/data/canonical_face_model.obj';
const norm = (s) => s.replace(/\r\n/g, '\n');

describe('generator CLI', () => {
  it('--variant current reproduces the committed faceTopology.ts exactly', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'faceTopology.ts');
    const r = spawnSync(process.execPath, ['tools/gen-face-topology.mjs', '--variant', 'current', '--out', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(norm(readFileSync(out, 'utf8'))).toBe(norm(readFileSync('components/face/faceTopology.ts', 'utf8')));
  });
  it('rejects an unknown variant', () => {
    const r = spawnSync(process.execPath, ['tools/gen-face-topology.mjs', '--variant', 'nope', '--out', path.join(os.tmpdir(), 'x.ts')], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
  });
});

describe('buildVariants (current)', () => {
  const B = buildVariants(OBJ);
  it('has the shipped sizes', () => {
    expect(B.V).toHaveLength(468);
    expect(B.SUBSET).toEqual(SETS.SUBSET);
    expect(B.variants.current.low.tris.length).toBe(298);
    expect(B.variants.current.full.tris.length).toBe(840);
    expect(B.variants.current.low.isLip).toHaveLength(298);
    expect(B.variants.current.full.isLip).toHaveLength(840);
  });
});
