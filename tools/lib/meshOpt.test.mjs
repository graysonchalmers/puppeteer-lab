import { describe, it, expect } from 'vitest';
import { edgeKey, keyEdge, orient2, buildAdjacency, boundaryKeys, valences, totalEnergy, optimize, enforceEdge, enforceChains, qualityReport, formatReport, windingInfo, flipCandidate, flipDelta } from './meshOpt.mjs';

/** n x n vertex grid; every cell split along the same diagonal; pos3 gets a bumpy height field. */
function grid(n, bumpy = true) {
  const pos2 = [], pos3 = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    pos2.push([c, r]);
    const z = bumpy ? 0.9 * Math.sin(1.7 * c + 0.9 * r) + 0.6 * Math.cos(2.3 * r - c) : 0;
    pos3.push([c, r, z]);
  }
  const id = (r, c) => r * n + c;
  const tris = [];
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) {
    tris.push([id(r, c), id(r, c + 1), id(r + 1, c + 1)], [id(r, c), id(r + 1, c + 1), id(r + 1, c)]);
  }
  return { pos2, pos3, tris, id };
}
const signs = (tris, pos2) => tris.map((t) => Math.sign(orient2(pos2[t[0]], pos2[t[1]], pos2[t[2]])));
const verts = (tris) => [...new Set(tris.flat())].sort((a, b) => a - b);

describe('meshOpt basics', () => {
  it('edgeKey is symmetric and invertible', () => {
    expect(edgeKey(5, 9)).toBe(edgeKey(9, 5));
    expect(keyEdge(edgeKey(467, 3))).toEqual([3, 467]);
  });
  it('adjacency, boundary and valence of a 2x2 cell', () => {
    const { tris } = grid(2, false);
    const adj = buildAdjacency(tris);
    expect(adj.get(edgeKey(0, 3))).toHaveLength(2); // the shared diagonal
    expect(boundaryKeys(tris).size).toBe(4);
    expect(valences(adj).get(0)).toBe(3);
  });
});

describe('optimize', () => {
  // A long diagonal over a flat diamond flips to the short one (quality only).
  const diamond = () => ({
    pos2: [[0, 0], [4, 0], [2, 1], [2, -1]],
    pos3: [[0, 0, 0], [4, 0, 0], [2, 1, 0], [2, -1, 0]],
    tris: [[0, 1, 2], [1, 0, 3]], // u=0 v=1 c=2 d=3, shared edge 0-1
  });
  const qOnly = { wQuality: 1, wValence: 0, wDihedral: 0 };

  it('flips a long diagonal to the better-shaped one', () => {
    const { pos2, pos3, tris } = diamond();
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.flips).toBe(1);
    const adj = buildAdjacency(r.tris);
    expect(adj.has(edgeKey(2, 3))).toBe(true);
    expect(adj.has(edgeKey(0, 1))).toBe(false);
    expect(signs(r.tris, pos2)).toEqual([1, 1]);
  });

  it('never flips a locked edge', () => {
    const { pos2, pos3, tris } = diamond();
    const r = optimize(tris, { pos2, pos3, ...qOnly, locked: new Set([edgeKey(0, 1)]) });
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
  });

  it('never flips when the quad is not convex (no fold-over), even though the flip would improve quality', () => {
    // Concave at u=0: the replacement triangle [0,3,2] has orientation -0.5, yet the quality sum would rise (~0.66 -> ~0.73).
    const pos2 = [[0, 0], [4, 0], [1, 1], [-1, -0.5]];
    const pos3 = pos2.map(([x, y]) => [x, y, 0]);
    const tris = [[0, 1, 2], [1, 0, 3]];
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
  });

  it('prefers the diagonal with the smaller dihedral (dihedral only)', () => {
    // Unit square a b c d with only d lifted. Diagonal b-d gives 60 degrees, a-c gives 54.7: b-d must flip to a-c.
    const pos2 = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const pos3 = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 1]];
    const tris = [[0, 1, 3], [1, 2, 3]]; // diagonal 1-3 (b-d)
    const r = optimize(tris, { pos2, pos3, wQuality: 0, wValence: 0, wDihedral: 1 });
    expect(r.flips).toBe(1);
    expect(buildAdjacency(r.tris).has(edgeKey(0, 2))).toBe(true);
  });

  it('freezes a degenerate (collinear) triangle instead of flipping across it', () => {
    // Consistently wound; the quad is convex and the flip improves quality, so it flips unless triangle 1 is frozen.
    const pos2 = [[0, 0], [2, 0], [1, 1], [1, 0]];
    const pos3 = pos2.map(([x, y]) => [x, y, 0]);
    const tris = [[0, 1, 2], [1, 0, 3]];
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.frozen).toBe(1);
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
  });

  it('freezes an inverted triangle instead of flipping across it', () => {
    // Fan of 3 triangles around vertex 0; the middle one [0,2,3] is wound the other way (orientation < 0), the majority is CCW.
    const pos2 = [[0, 0], [2, 0], [1, 1], [1.5, 0.3], [0, 2]];
    // pos3 is chosen so that flipping edge 0-2 (which borders the inverted triangle) would clearly improve quality:
    // vertices 0,1,2,3 form a thin rhombus in 3D with 0-2 as the long diagonal. Without the freeze it would flip.
    const pos3 = [[-2, 0, 0], [0, -1, 0], [2, 0, 0], [0, 1, 0], [0, 3, 0]];
    const tris = [[0, 1, 2], [0, 2, 3], [0, 3, 4]];
    expect(signs(tris, pos2)).toEqual([1, -1, 1]);
    const r = optimize(tris, { pos2, pos3, ...qOnly });
    expect(r.frozen).toBe(1);
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
    const adj = buildAdjacency(r.tris);
    for (const [a, b] of [[0, 2], [2, 3], [0, 3]]) expect(adj.has(edgeKey(a, b))).toBe(true);
  });

  it('on a bumpy grid: keeps vertices, count, boundary and winding, lowers energy, and is deterministic', () => {
    const { pos2, pos3, tris } = grid(6);
    const opts = { pos2, pos3, wQuality: 1, wValence: 0.1, wDihedral: 1 };
    const r1 = optimize(tris, opts);
    const r2 = optimize(tris, opts);
    expect(r2.tris).toEqual(r1.tris);
    expect(r1.flips).toBeGreaterThan(0);
    expect(r1.sweeps).toBeLessThanOrEqual(50);
    expect(r1.tris).toHaveLength(tris.length);
    expect(verts(r1.tris)).toEqual(verts(tris));
    expect([...boundaryKeys(r1.tris)].sort()).toEqual([...boundaryKeys(tris)].sort());
    expect(new Set(signs(r1.tris, pos2))).toEqual(new Set([1]));
    expect(totalEnergy(r1.tris, opts)).toBeLessThan(totalEnergy(tris, opts));
    for (const l of buildAdjacency(r1.tris).values()) expect(l.length).toBeLessThanOrEqual(2);
  });
});

describe('flipDelta is the exact energy change', () => {
  const bndVerts = (tris) => {
    const out = new Set();
    for (const k of boundaryKeys(tris)) for (const x of keyEdge(k)) out.add(x);
    return out;
  };
  const optionSets = {
    default: {},
    'with flow': { wFlow: 0.7, centers: [{ c: [2.1, 2.3], r: 1.5 }] },
  };
  for (const [name, extra] of Object.entries(optionSets)) {
    it(`matches totalEnergy(after) - totalEnergy(before) for every flippable interior edge (${name})`, () => {
      const { pos2, pos3, tris } = grid(6);
      const o = { wQuality: 1, wValence: 0.1, wDihedral: 1, wFlow: 0, centers: [], ...extra };
      const eopts = { pos2, pos3, ...o };
      const adj = buildAdjacency(tris);
      const val = valences(adj);
      const bv = bndVerts(tris);
      const { sign0, frozen } = windingInfo(tris, pos2);
      expect(sign0).toBe(1);
      expect(frozen.size).toBe(0);
      const e0 = totalEnergy(tris, eopts);
      let checked = 0;
      for (const key of adj.keys()) {
        const f = flipCandidate(tris, adj, key, pos2, sign0, frozen);
        if (!f) continue;
        const after = tris.map((t) => t.slice());
        after[f.i1] = f.n1;
        after[f.i2] = f.n2;
        const exact = totalEnergy(after, eopts) - e0;
        expect(Math.abs(flipDelta(tris, adj, val, bv, f, o, pos2, pos3) - exact)).toBeLessThan(1e-9);
        checked++;
      }
      expect(checked).toBeGreaterThan(10);
    });
  }

  it('total energy never increases across optimize runs with more sweeps', () => {
    const { pos2, pos3, tris } = grid(6);
    const opts = { pos2, pos3, wQuality: 1, wValence: 0.1, wDihedral: 1, wFlow: 0.7, centers: [{ c: [2.1, 2.3], r: 1.5 }] };
    let prev = totalEnergy(tris, opts);
    for (const maxSweeps of [0, 1, 2, 3]) {
      const e = totalEnergy(optimize(tris, { ...opts, maxSweeps }).tris, opts);
      expect(e).toBeLessThanOrEqual(prev + 1e-9);
      prev = e;
    }
  });
});

describe('enforceEdge / enforceChains', () => {
  it('forces an edge across several crossings without changing the triangle count', () => {
    const { pos2, tris, id } = grid(5, false);
    const a = id(0, 0), b = id(1, 3); // segment (0,0)-(3,1): crosses several cell edges
    expect(buildAdjacency(tris).has(edgeKey(a, b))).toBe(false);
    const r = enforceEdge(tris, pos2, a, b);
    expect(r.flips).toBeGreaterThan(0);
    expect(buildAdjacency(r.tris).has(edgeKey(a, b))).toBe(true);
    expect(r.tris).toHaveLength(tris.length);
    expect(verts(r.tris)).toEqual(verts(tris));
    expect(new Set(signs(r.tris, pos2))).toEqual(new Set([1]));
  });

  it('throws when the constraint crosses a locked edge', () => {
    const { pos2, tris, id } = grid(5, false);
    const locked = new Set([edgeKey(id(0, 1), id(1, 1))]); // vertical edge x=1, crossed by (0,0)-(3,1)
    expect(() => enforceEdge(tris, pos2, id(0, 0), id(1, 3), locked)).toThrow(/locked/);
  });

  it('throws (never hangs) when the segment passes exactly through another vertex', () => {
    const { pos2, tris, id } = grid(5, false);
    expect(() => enforceEdge(tris, pos2, id(0, 0), id(2, 2))).toThrow(/cannot be enforced/);
  });

  it('enforces a chain and locks its edges; an unrecoverable optional chain is dropped and rolled back', () => {
    const { pos2, tris, id } = grid(5, false);
    const good = { name: 'good', ids: [id(0, 0), id(1, 2), id(0, 4)] };
    const bad = { name: 'bad', ids: [id(0, 0), id(2, 2)], optional: true };
    const r = enforceChains(tris, pos2, [good, bad]);
    expect(r.dropped).toEqual(['bad']);
    const adj = buildAdjacency(r.tris);
    expect(adj.has(edgeKey(id(0, 0), id(1, 2)))).toBe(true);
    expect(adj.has(edgeKey(id(1, 2), id(0, 4)))).toBe(true);
    expect(r.locked.has(edgeKey(id(0, 0), id(1, 2)))).toBe(true);
    expect(r.locked.has(edgeKey(id(0, 0), id(2, 2)))).toBe(false);
    expect(() => enforceChains(tris, pos2, [{ name: 'must', ids: [id(0, 0), id(2, 2)] }])).toThrow(/chain "must"/);
  });
});

describe('qualityReport', () => {
  it('describes a flat unit grid: right isosceles triangles, valence 6 inside', () => {
    const { pos3, tris } = grid(5, false);
    const r = qualityReport(tris, pos3);
    expect(r.tris).toBe(32);
    expect(r.minAngleMin).toBeCloseTo(45, 5);
    expect(r.minAngleMean).toBeCloseTo(45, 5);
    expect(r.slivers20).toBe(0);
    expect(r.aspectOver3).toBe(0);
    expect(r.interiorVertices).toBe(9);
    expect(r.valenceShare5to7).toBe(1);
    expect(r.dihedralMean).toBeCloseTo(0, 5);
    expect(formatReport('flat', r)).toMatch(/flat/);
  });
});
