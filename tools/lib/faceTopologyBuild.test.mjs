import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVariants, SETS, FLIP_OPTS, FLOW_OPTS, FLOW_CHAINS } from './faceTopologyBuild.mjs';
import { edgeKey, keyEdge, buildAdjacency, boundaryKeys, orient2, qualityReport, totalEnergy } from './meshOpt.mjs';

const OBJ = 'tools/data/canonical_face_model.obj';
const norm = (s) => s.replace(/\r\n/g, '\n');
const cli = (args) => spawnSync(process.execPath, ['tools/gen-face-topology.mjs', ...args], { encoding: 'utf8' });

describe('generator CLI', () => {
  it('--variant current reproduces the committed faceTopology.ts exactly', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'faceTopology.ts');
    const r = cli(['--variant', 'current', '--out', out]);
    expect(r.status).toBe(0);
    expect(norm(readFileSync(out, 'utf8'))).toBe(norm(readFileSync('components/face/faceTopology.ts', 'utf8')));
  });
  it('rejects an unknown variant', () => {
    const r = cli(['--variant', 'nope', '--out', path.join(os.tmpdir(), 'x.ts')]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('unknown or unavailable variant "nope"');
  });
  it('rejects an inherited object key as a variant with the friendly error', () => {
    const r = cli(['--variant', 'constructor', '--out', path.join(os.tmpdir(), 'x.ts')]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('unknown or unavailable variant "constructor"');
    expect(r.stderr).not.toContain('TypeError');
  });
  it('rejects a flag with a missing value with a usage error', () => {
    for (const args of [['--out'], ['--variant'], ['--emit-candidates'], ['--out', '--variant', 'flip'], ['--emit-candidates', '--out', 'x.ts']]) {
      const r = cli(args);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/needs a value/);
      expect(r.stderr).toMatch(/usage:/);
    }
  });
});

describe('buildVariants (current)', () => {
  const B = buildVariants(OBJ);
  it('has the shipped sizes', () => {
    expect(B.V).toHaveLength(468);
    expect(B.SUBSET).toHaveLength(191);
    for (const ring of [SETS.FACE_OVAL, SETS.LEFT_EYE, SETS.RIGHT_EYE, SETS.LIPS_INNER, SETS.LIPS_OUTER]) {
      for (const i of ring) expect(B.SUBSET).toContain(i);
    }
    expect(B.variants.current.low.tris.length).toBe(298);
    expect(B.variants.current.full.tris.length).toBe(840);
    expect(B.variants.current.low.isLip).toHaveLength(298);
    expect(B.variants.current.full.isLip).toHaveLength(840);
  });
  it('shares landmark sets read-only so no variant can mutate them', () => {
    expect(Object.isFrozen(SETS)).toBe(true);
    for (const k of Object.keys(SETS)) expect(Object.isFrozen(SETS[k])).toBe(true);
    expect(() => SETS.FACE_OVAL.push(1)).toThrow();
  });
});

describe('variants: validity', () => {
  const B = buildVariants(OBJ);
  const pos2 = B.V.map((v) => [v[0], -v[1]]);
  const pos3 = B.V;
  const ring = (ids) => ids.map((x, i) => edgeKey(x, ids[(i + 1) % ids.length]));
  const lidsL = [SETS.L_EYE_UPPER, SETS.L_EYE_LOWER], lidsR = [SETS.R_EYE_UPPER, SETS.R_EYE_LOWER];
  const spans = (t, a, b) => t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));
  const lipSet = new Set([...SETS.LIPS_OUTER, ...SETS.LIPS_INNER]);

  for (const name of ['current', 'flip', 'flow']) {
    for (const mesh of ['low', 'full']) {
      describe(`${name} ${mesh}`, () => {
        const m = B.variants[name][mesh];
        it('is manifold with no duplicate triangles and valid ids', () => {
          for (const l of buildAdjacency(m.tris).values()) expect(l.length).toBeLessThanOrEqual(2);
          const seen = new Set(m.tris.map((t) => [...t].sort((a, b) => a - b).join(',')));
          expect(seen.size).toBe(m.tris.length);
          expect(m.tris.flat().every((i) => Number.isInteger(i) && i >= 0 && i < 468)).toBe(true);
          expect(m.isLip).toHaveLength(m.tris.length);
        });
        it('has consistent winding (degenerate triangles aside)', () => {
          const a = m.tris.map((t) => orient2(pos2[t[0]], pos2[t[1]], pos2[t[2]])).filter((x) => Math.abs(x) > 1e-9);
          const pos = a.filter((x) => x > 0).length;
          expect(Math.min(pos, a.length - pos) / a.length).toBeLessThan(0.01);
        });
        it('keeps every interior vertex at 3 or more neighbors', () => {
          const adj = buildAdjacency(m.tris);
          const bnd = boundaryKeys(m.tris);
          const bv = new Set([...bnd].flatMap((k) => keyEdge(k)));
          const val = new Map();
          for (const k of adj.keys()) for (const x of keyEdge(k)) val.set(x, (val.get(x) ?? 0) + 1);
          for (const [x, n] of val) if (!bv.has(x)) expect(n).toBeGreaterThanOrEqual(3);
        });
        it('never bridges the mouth or an eye hole and has lip triangles', () => {
          expect(m.tris.some((t) => spans(t, SETS.LIPS_INNER_UPPER, SETS.LIPS_INNER_LOWER))).toBe(false);
          expect(m.tris.some((t) => spans(t, lidsL[0], lidsL[1]) || spans(t, lidsR[0], lidsR[1]))).toBe(false);
          expect(m.isLip.filter((x) => x === 1).length).toBeGreaterThan(10);
        });
        it('keeps the triangle count inside the pinned bounds', () => {
          if (mesh === 'low') { expect(m.tris.length).toBeGreaterThan(250); expect(m.tris.length).toBeLessThan(450); }
          else { expect(m.tris.length).toBeGreaterThan(800); expect(m.tris.length).toBeLessThanOrEqual(898); }
        });
        it('recomputes lip flags with the existing rule', () => {
          if (mesh === 'low') m.tris.forEach((t, i) => expect(m.isLip[i]).toBe(t.every((x) => lipSet.has(x)) ? 1 : 0));
        });
      });
    }
  }

  it('Flip keeps vertices, count and the exact boundary of Current, and changes some edges', () => {
    for (const mesh of ['low', 'full']) {
      const c = B.variants.current[mesh], f = B.variants.flip[mesh];
      expect(f.tris.length).toBe(c.tris.length);
      expect([...new Set(f.tris.flat())].sort((a, b) => a - b)).toEqual([...new Set(c.tris.flat())].sort((a, b) => a - b));
      expect([...boundaryKeys(f.tris)].sort()).toEqual([...boundaryKeys(c.tris)].sort());
    }
    expect(B.stats.flip.low.flips).toBeGreaterThan(0);
    expect(B.stats.flip.full.flips).toBeGreaterThan(0);
  });

  it('Flip lowers the optimizer energy on both meshes', () => {
    for (const mesh of ['low', 'full']) {
      const o = { pos2, pos3, ...FLIP_OPTS };
      expect(totalEnergy(B.variants.flip[mesh].tris, o)).toBeLessThan(totalEnergy(B.variants.current[mesh].tris, o));
    }
  });

  it('Flow: hole boundaries are the exact rings, the outer boundary is the exact oval, chains are present', () => {
    const f = B.variants.flow.low;
    const expected = new Set([...ring(SETS.FACE_OVAL), ...ring(SETS.LEFT_EYE), ...ring(SETS.RIGHT_EYE), ...ring(SETS.LIPS_INNER)]);
    expect([...boundaryKeys(f.tris)].sort()).toEqual([...expected].sort());
    const adj = buildAdjacency(f.tris);
    const used = FLOW_CHAINS.filter((c) => !B.stats.flow.low.dropped.includes(c.name));
    expect(used.length).toBeGreaterThanOrEqual(7); // oval, 2 eyes, 2 lip rings, 2 brows, nose bridge are required
    for (const c of used) for (let i = 0; i + 1 < c.ids.length; i++) expect(adj.has(edgeKey(c.ids[i], c.ids[i + 1]))).toBe(true);
    expect(JSON.stringify(f.tris)).not.toBe(JSON.stringify(B.variants.current.low.tris));
  });

  it('Flow full equals Flip full', () => {
    expect(B.variants.flow.full.tris).toEqual(B.variants.flip.full.tris);
  });

  it('prints a report for every variant and mesh', () => {
    for (const name of ['current', 'flip', 'flow']) for (const mesh of ['low', 'full']) expect(B.reports).toContain(`${name} ${mesh}`);
  });

  it('exports the weights and a quality report that matches the variant', () => {
    expect(FLOW_OPTS.wFlow).toBeGreaterThan(0);
    expect(qualityReport(B.variants.flip.low.tris, pos3).tris).toBe(B.variants.flip.low.tris.length);
  });
});

describe('generator CLI emits candidates', () => {
  it('writes a candidates JSON with verts, all three variants and the report', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'c.json');
    const r = cli(['--emit-candidates', out, '--out', path.join(os.tmpdir(), 'unused.ts')]);
    expect(r.status).toBe(0);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    expect(j.verts).toHaveLength(468 * 3);
    expect(Object.keys(j.variants).sort()).toEqual(['current', 'flip', 'flow']);
    expect(j.variants.flip.low.tris.length % 3).toBe(0);
    expect(typeof j.report).toBe('string');
  });
});
