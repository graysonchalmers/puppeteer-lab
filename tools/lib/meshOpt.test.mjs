import { describe, it, expect } from 'vitest';
import { edgeKey, keyEdge, orient2, buildAdjacency, boundaryKeys, valences, totalEnergy, optimize, enforceEdge, enforceChains, qualityReport, formatReport, windingInfo, flipCandidate, flipDelta, triShape, guardAllows } from './meshOpt.mjs';

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

describe('min-angle guard', () => {
  // A convex quad (diagonal B-D, both triangles above 26 degrees) whose dihedral-preferred diagonal A-C makes two slivers.
  const quad = () => ({
    pos2: [[-1, 0], [-0.8, -0.5], [1, 0], [-0.7, 0.4]],
    pos3: [[-1, 0, 0.4], [-0.8, -0.5, 0.2], [1, 0, 0], [-0.7, 0.4, 0.6]],
    tris: [[0, 1, 3], [1, 2, 3]],
  });
  const dOnly = { wQuality: 0, wValence: 0, wDihedral: 1 };
  const mins = (pos3, tris) => tris.map((t) => triShape(pos3, t).minAngle);

  it('rejects a flip that would create a sliver, which the energy alone takes', () => {
    const { pos2, pos3, tris } = quad();
    expect(Math.min(...mins(pos3, tris))).toBeGreaterThan(26);
    const free = optimize(tris, { pos2, pos3, ...dOnly });
    expect(free.flips).toBe(1);
    expect(buildAdjacency(free.tris).has(edgeKey(0, 2))).toBe(true);
    expect(Math.min(...mins(pos3, free.tris))).toBeLessThan(15);
    const guarded = optimize(tris, { pos2, pos3, ...dOnly, minAngleGuard: 20 });
    expect(guarded.flips).toBe(0);
    expect(guarded.tris).toEqual(tris);
  });

  it('the floor caps the requirement: under a 14 degree floor the same flip is allowed', () => {
    const { pos2, pos3, tris } = quad();
    expect(optimize(tris, { pos2, pos3, ...dOnly, minAngleGuard: 14 }).flips).toBe(1);
  });

  /** Isosceles triangle with apex angle `deg` at its first vertex (its minimum angle when under 60). */
  const iso = (pos3, deg) => {
    const h = Math.tan((deg * Math.PI) / 360);
    const i = pos3.length;
    pos3.push([0, 0, 0], [1, -h, 0], [1, h, 0]);
    return [i, i + 1, i + 2];
  };
  const shapes = (degs) => {
    const pos3 = [];
    return { pos3, t: degs.map((d) => iso(pos3, d)) };
  };

  it('guardAllows: off without a floor; compares the new minimum with min(old minimum, floor)', () => {
    const { pos3, t } = shapes([30, 30, 15, 15, 10, 40, 12, 25, 8, 50]);
    expect(triShape(pos3, t[2]).minAngle).toBeCloseTo(15, 9);
    expect(guardAllows([t[0], t[1]], [t[2], t[3]], pos3, {})).toBe(true);
    expect(guardAllows([t[0], t[1]], [t[2], t[3]], pos3, { minAngleGuard: 20 })).toBe(false); // 15 < min(30, 20)
    expect(guardAllows([t[0], t[1]], [t[2], t[3]], pos3, { minAngleGuard: 10 })).toBe(true); // 15 >= min(30, 10)
    expect(guardAllows([t[4], t[5]], [t[6], t[7]], pos3, { minAngleGuard: 20 })).toBe(true); // worst 10 -> 12, one sliver -> one
    expect(guardAllows([t[4], t[5]], [t[8], t[9]], pos3, { minAngleGuard: 20 })).toBe(false); // worst 10 -> 8
  });

  it('guardAllows: never raises the count of triangles under the floor, even when the worst angle improves', () => {
    const { pos3, t } = shapes([10, 40, 15, 15]);
    // 15 >= min(10, 20), but one sliver becomes two.
    expect(guardAllows([t[0], t[1]], [t[2], t[3]], pos3, { minAngleGuard: 20 })).toBe(false);
  });

  it('on a bumpy grid: still flips and lowers the energy, never lowers the worst angle or adds triangles under the floor', () => {
    const { pos2, pos3, tris } = grid(6);
    const opts = { pos2, pos3, ...dOnly };
    const before = qualityReport(tris, pos3);
    // Control: unguarded, dihedral-only flips do make slivers here (worst 22.7 -> 15.0 degrees, 0 -> 6 under 20).
    const free = optimize(tris, opts);
    expect(qualityReport(free.tris, pos3).minAngleMin).toBeLessThan(before.minAngleMin - 5);
    expect(mins(pos3, free.tris).filter((x) => x < 20).length).toBeGreaterThan(mins(pos3, tris).filter((x) => x < 20).length);
    for (const F of [20, 35]) {
      const r = optimize(tris, { ...opts, minAngleGuard: F });
      const after = qualityReport(r.tris, pos3);
      expect(r.flips).toBeGreaterThan(0);
      expect(totalEnergy(r.tris, opts)).toBeLessThan(totalEnergy(tris, opts));
      expect(after.minAngleMin).toBeGreaterThanOrEqual(Math.min(before.minAngleMin, F) - 1e-9);
      expect(mins(pos3, r.tris).filter((x) => x < F).length).toBeLessThanOrEqual(mins(pos3, tris).filter((x) => x < F).length);
    }
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

  it('rolls back a multi-edge optional chain whose later edge fails: no lock, no triangle change, no flips counted', () => {
    const { pos2, tris, id } = grid(5, false);
    const good = { name: 'good', ids: [id(0, 0), id(1, 2), id(0, 4)] };
    // First edge (0,4)-(1,3) is the anti-diagonal of a cell (one flip, then locked); the second, (1,3)-(3,1), passes through vertex (2,2) and fails.
    const opt = { name: 'opt', ids: [id(4, 0), id(3, 1), id(1, 3)], optional: true };
    const base = enforceChains(tris, pos2, [good]);
    const r = enforceChains(tris, pos2, [good, opt]);
    expect(r.dropped).toEqual(['opt']);
    expect(r.locked.has(edgeKey(id(4, 0), id(3, 1)))).toBe(false);
    expect(r.tris).toEqual(base.tris);
    expect(r.flips).toBe(base.flips);
    expect([...r.locked].sort()).toEqual([...base.locked].sort());
    // Sanity: the optional chain's first edge does succeed (and would be locked) when its second edge is dropped.
    const first = enforceChains(tris, pos2, [{ name: 'first', ids: [id(4, 0), id(3, 1)] }]);
    expect(first.flips).toBeGreaterThan(0);
    expect(first.locked.has(edgeKey(id(4, 0), id(3, 1)))).toBe(true);
  });

  it('keeps a lock set by an earlier chain when a later optional chain containing that edge is rolled back', () => {
    const { pos2, tris, id } = grid(5, false);
    const early = { name: 'early', ids: [id(4, 0), id(3, 1)] };
    const opt = { name: 'opt', ids: [id(4, 0), id(3, 1), id(1, 3)], optional: true };
    const r = enforceChains(tris, pos2, [early, opt]);
    expect(r.dropped).toEqual(['opt']);
    expect(r.locked.has(edgeKey(id(4, 0), id(3, 1)))).toBe(true);
    expect(buildAdjacency(r.tris).has(edgeKey(id(4, 0), id(3, 1)))).toBe(true);
  });

  it('counts only the flips of chains that succeed', () => {
    const { pos2, tris, id } = grid(5, false);
    const r = enforceChains(tris, pos2, [{ name: 'only-bad', ids: [id(4, 0), id(3, 1), id(1, 3)], optional: true }]);
    expect(r.dropped).toEqual(['only-bad']);
    expect(r.flips).toBe(0);
    expect(r.tris).toEqual(tris);
  });
});

describe('enforceEdge on jittered grids (neutral-flip ping-pong guard)', () => {
  const mulberry32 = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** n x n jittered grid, each cell split along a pseudo-randomly chosen diagonal, all triangles positively wound. */
  function jittered(n, rand) {
    const pos2 = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) pos2.push([c + (rand() - 0.5) * 0.3, r + (rand() - 0.5) * 0.3]);
    const id = (r, c) => r * n + c;
    const tris = [];
    for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) {
      if (rand() < 0.5) tris.push([id(r, c), id(r, c + 1), id(r + 1, c + 1)], [id(r, c), id(r + 1, c + 1), id(r + 1, c)]);
      else tris.push([id(r, c), id(r, c + 1), id(r + 1, c)], [id(r, c + 1), id(r + 1, c + 1), id(r + 1, c)]);
    }
    return { pos2, tris, id };
  }

  it('enforces random interior vertex pairs without a false flip-cap failure', () => {
    const n = 7;
    const rand = mulberry32(20261003);
    const { pos2, tris, id } = jittered(n, rand);
    expect(new Set(signs(tris, pos2))).toEqual(new Set([1]));
    const adj0 = buildAdjacency(tris);
    const interior = [];
    for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) interior.push(id(r, c));
    let tested = 0, totalFlips = 0;
    while (tested < 60) {
      const a = interior[Math.floor(rand() * interior.length)];
      const b = interior[Math.floor(rand() * interior.length)];
      if (a === b || adj0.has(edgeKey(a, b))) continue;
      const res = enforceEdge(tris, pos2, a, b);
      expect(buildAdjacency(res.tris).has(edgeKey(a, b))).toBe(true);
      expect(res.tris).toHaveLength(tris.length);
      expect(verts(res.tris)).toEqual(verts(tris));
      expect(new Set(signs(res.tris, pos2))).toEqual(new Set([1]));
      expect(res.flips).toBeLessThan(200);
      totalFlips += res.flips;
      tested++;
    }
    expect(totalFlips).toBeGreaterThan(0);
  });

  it('recovers the pinned cases where flipping the lowest-key crossing edge ping-pongs (9x9, found by a 300-seed search)', () => {
    // Without the neutral-flip memory these fail with a false 'flip cap reached'; each is a recoverable constraint.
    for (const [seed, a, b] of [[17, 46, 70], [49, 10, 64], [58, 55, 16], [70, 16, 68]]) {
      const { pos2, tris } = jittered(9, mulberry32(seed));
      expect(buildAdjacency(tris).has(edgeKey(a, b))).toBe(false);
      const res = enforceEdge(tris, pos2, a, b);
      expect(buildAdjacency(res.tris).has(edgeKey(a, b))).toBe(true);
      expect(res.tris).toHaveLength(tris.length);
      expect(new Set(signs(res.tris, pos2))).toEqual(new Set([1]));
    }
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
    const text = formatReport('flat', r);
    expect(text).toMatch(/^flat: 32 triangles/);
    expect(text).toMatch(/min angle: worst 45\.00 deg, mean 45\.00 deg/);
    expect(text).toMatch(/interior valence: \{"6":9\} \(100\.0% at 5\.\.7 of 9\)/);
  });

  it('does not return Infinity or NaN for an empty mesh', () => {
    const r = qualityReport([], []);
    expect(r.tris).toBe(0);
    expect(r.minAngleMin).toBe(0);
    expect(r.minAngleMean).toBe(0);
    expect(Object.values(r).filter((v) => typeof v === 'number').every(Number.isFinite)).toBe(true);
  });
});
