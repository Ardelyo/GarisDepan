import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/map/mapgen';

describe('generateMap', () => {
  for (const shape of ['benua', 'semenanjung', 'kepulauan', 'duaBenua'] as const) {
    it(`produces a playable ${shape} map`, () => {
      const t0 = performance.now();
      const m = generateMap({ seed: 1234, shape, size: 'sedang' });
      const ms = performance.now() - t0;
      expect(m.provinces.length).toBeGreaterThan(40);
      for (const p of m.provinces) {
        expect(p.loops.length).toBeGreaterThan(0);
        expect(p.area).toBeGreaterThan(0);
        for (const n of p.neighbors) expect(m.provinces[n].neighbors).toContain(p.id);
        // the outer loop is closed
        const L = p.loops.reduce((a, b) => (a.length > b.length ? a : b));
        const f = L[0], l = L[L.length - 1];
        expect(Math.hypot(f.x - l.x, f.y - l.y)).toBeLessThan(0.01);
      }
      console.log(shape, m.provinces.length, 'provinces', m.arcs.length, 'arcs', ms.toFixed(0) + 'ms');
    });
  }
  it('is deterministic', () => {
    const a = generateMap({ seed: 77, shape: 'benua', size: 'kecil' });
    const b = generateMap({ seed: 77, shape: 'benua', size: 'kecil' });
    expect(a.provinces.map((p) => [p.x, p.y, p.basePop])).toEqual(b.provinces.map((p) => [p.x, p.y, p.basePop]));
  });
});
