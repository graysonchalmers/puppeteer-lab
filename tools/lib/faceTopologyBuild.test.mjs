import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVariants, SETS, FLIP_OPTS } from './faceTopologyBuild.mjs';
import { keyEdge, buildAdjacency, boundaryKeys, orient2, qualityReport, formatReport, totalEnergy } from './meshOpt.mjs';

const OBJ = 'tools/data/canonical_face_model.obj';
const norm = (s) => s.replace(/\r\n/g, '\n');
const cli = (args) => spawnSync(process.execPath, ['tools/gen-face-topology.mjs', ...args], { encoding: 'utf8' });

describe('generator CLI', () => {
  it('the default CLI output (flip) reproduces the committed faceTopology.ts', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'faceTopology.ts');
    const r = cli(['--out', out]);
    expect(r.status).toBe(0);
    expect(norm(readFileSync(out, 'utf8'))).toBe(norm(readFileSync('components/face/faceTopology.ts', 'utf8')));
  });
  it('--variant current runs and writes the original table: same triangle counts, different text from the shipped file', () => {
    const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'topo-')), 'current.ts');
    const r = cli(['--variant', 'current', '--out', out]);
    expect(r.status).toBe(0);
    const text = norm(readFileSync(out, 'utf8'));
    expect(text).toContain('191 vertices, 298 triangles');
    expect(text).toContain('840 FULL triangles');
    expect(text).not.toBe(norm(readFileSync('components/face/faceTopology.ts', 'utf8')));
  });
  it('--variant current without --out refuses to overwrite the shipped table', () => {
    const file = 'components/face/faceTopology.ts';
    const before = readFileSync(file);
    const r = cli(['--variant', 'current']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--variant current needs --out');
    expect(readFileSync(file).equals(before)).toBe(true);
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
    for (const args of [['--out'], ['--variant'], ['--out', '--variant', 'flip']]) {
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
  const lidsL = [SETS.L_EYE_UPPER, SETS.L_EYE_LOWER], lidsR = [SETS.R_EYE_UPPER, SETS.R_EYE_LOWER];
  const spans = (t, a, b) => t.some((i) => a.includes(i)) && t.some((i) => b.includes(i));
  const lipSet = new Set([...SETS.LIPS_OUTER, ...SETS.LIPS_INNER]);

  for (const name of ['current', 'flip']) {
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

  it('full meshes flag lip triangles by centroid inside the closed outer-lip polygon in (x, -y)', () => {
    const P = (i) => pos2[i];
    const poly = [...SETS.LIPS_OUTER, SETS.LIPS_OUTER[0]];
    const inside = ([px, py]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = P(poly[i]), [bx, by] = P(poly[j]);
        if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) c = !c;
      }
      return c;
    };
    for (const name of ['current', 'flip']) {
      const m = B.variants[name].full;
      const want = m.tris.map((t) => (inside([0, 1].map((a) => t.reduce((s, i) => s + P(i)[a], 0) / 3)) ? 1 : 0));
      expect(m.isLip).toEqual(want);
      expect(want.filter((x) => x === 1).length).toBeGreaterThan(20);
    }
  });

  it('Flip meets the quality bar against Current: no worse on worst angle, slivers and aspect; better valence and dihedral', () => {
    for (const mesh of ['low', 'full']) {
      const c = qualityReport(B.variants.current[mesh].tris, pos3);
      const v = qualityReport(B.variants.flip[mesh].tris, pos3);
      expect(v.minAngleMin).toBeGreaterThanOrEqual(c.minAngleMin - 1e-9);
      expect(v.slivers20).toBeLessThanOrEqual(c.slivers20);
      expect(v.aspectOver3).toBeLessThanOrEqual(c.aspectOver3);
      expect(v.valenceShare5to7).toBeGreaterThan(c.valenceShare5to7);
      expect(v.dihedralMean).toBeLessThan(c.dihedralMean);
    }
  });

  it('reports the quality of exactly the tables it built, and the weights it used', () => {
    for (const name of ['current', 'flip']) {
      for (const mesh of ['low', 'full']) expect(B.reports).toContain(formatReport(`${name} ${mesh}`, qualityReport(B.variants[name][mesh].tris, pos3)));
    }
    expect(B.reports).toContain(`weights ${JSON.stringify(FLIP_OPTS)}`);
  });

  it('builds exactly the current and flip variants', () => {
    expect(Object.keys(B.variants).sort()).toEqual(['current', 'flip']);
  });
});
