import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/map/mapgen';
import { newGame } from '../src/sim/setup';
import { planAI } from '../src/sim/ai';
import { resolveTurn } from '../src/sim/sim';
import { RULES, SUPPLY_FULL, attackOdds, stackCap, supplyLevels, totalTroops } from '../src/sim/rules';
import type { GameState, Settings } from '../src/sim/types';

const settings: Settings = {
  theme: 'satelit', tempo: 'santai', startAtWar: true, usePin: false, difficulty: 'perwira', fog: true,
  victory: { dominasi: true, ekonomi: true, skor: true, turnLimit: 200 },
};

function play(seed: number, turns: number) {
  const map = generateMap({ seed, shape: 'benua', size: 'kecil' });
  let s: GameState = newGame(map, [
    { name: 'A', kind: 'ai', color: 0 }, { name: 'B', kind: 'ai', color: 1 }, { name: 'C', kind: 'ai', color: 2 },
  ], 3, settings);
  let battles = 0, captures = 0;
  for (let t = 0; t < turns && !s.winner; t++) {
    const orders = s.countries.map((c) => planAI(map, s, c.id));
    const r = resolveTurn(map, s, orders);
    for (const f of r.res.frames) for (const e of f.events) {
      if (e.t === 'battle') battles++;
      if (e.t === 'capture') captures++;
    }
    s = r.state;
  }
  return { s, battles, captures, map };
}

describe('resolveTurn', () => {
  it('runs a headless AI game without NaN and with real fighting', () => {
    const t0 = performance.now();
    const { s, battles, captures } = play(42, 40);
    const ms = performance.now() - t0;
    for (const p of s.provs) expect(Number.isFinite(p.troops)).toBe(true);
    for (const c of s.countries) {
      expect(Number.isFinite(c.treasury)).toBe(true);
      expect(Number.isFinite(c.stability)).toBe(true);
    }
    expect(battles).toBeGreaterThan(10);
    expect(captures).toBeGreaterThan(3);
    const summary = s.countries
      .map((c) => `${c.name}:${s.provs.filter((p) => p.ctrl === c.id).length}p/${Math.round(totalTroops(s, c.id) / 1000)}k/$${Math.round(c.treasury)}/stab${Math.round(c.stability)}`)
      .join(' | ');
    console.log('turns', s.turn - 1, 'battles', battles, 'captures', captures, 'winner', s.winner, ms.toFixed(0) + 'ms', summary);
  });

  it('is deterministic (replays give identical state)', () => {
    const a = play(7, 12).s;
    const b = play(7, 12).s;
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('strategy rules (putaran 1)', () => {
  const map = generateMap({ seed: 11, shape: 'benua', size: 'sedang' });
  const fresh = () => newGame(map, [
    { name: 'A', kind: 'ai', color: 0 }, { name: 'B', kind: 'ai', color: 1 }, { name: 'C', kind: 'ai', color: 2 },
  ], 2, settings);

  it('caps equipment quality from research', () => {
    let s = fresh();
    s.countries[0].budget = { mil: 0, civ: 0, res: 100 };
    s.countries[0].quality = RULES.qualityCap - 0.05;
    s.countries[0].researchPts = 1e6;
    s = resolveTurn(map, s, s.countries.map(() => [])).state;
    s = resolveTurn(map, s, s.countries.map(() => [])).state;
    expect(s.countries[0].quality).toBeLessThanOrEqual(RULES.qualityCap);
  });

  it('reinforcements never push a province above its stack cap', () => {
    let s = fresh();
    for (let t = 0; t < 6; t++) s = resolveTurn(map, s, s.countries.map(() => [])).state;
    s.provs.forEach((p, i) => expect(p.troops).toBeLessThanOrEqual(stackCap(map, s, i) + 1));
  });

  it('overcrowded provinces lose part of the excess', () => {
    const s = fresh();
    const cap = s.countries[0].capital;
    s.provs[cap].troops = stackCap(map, s, cap) + 100000;
    const after = resolveTurn(map, s, s.countries.map(() => [])).state;
    expect(after.provs[cap].troops).toBeLessThan(s.provs[cap].troops - 10000);
  });

  it('supply is full at home and weakens with distance', () => {
    const s = fresh();
    const lv = supplyLevels(map, s, 0);
    expect(lv[s.countries[0].capital]).toBe(SUPPLY_FULL);
    // pretend country 0 owns everything with no cities except the capital: far provinces get stretched or cut
    s.provs.forEach((p, i) => { p.ctrl = 0; p.owner = 0; if (i !== s.countries[0].capital) p.urban = 0; });
    const far = supplyLevels(map, s, 0);
    expect([...far].some((l) => l !== SUPPLY_FULL)).toBe(true);
  });

  it('attack odds add pincer arrows on the same target', () => {
    const s = fresh();
    s.settings.fog = false;
    s.rel[0][1].status = s.rel[1][0].status = 'perang';
    const P = map.provinces;
    // find an enemy province with two of our neighbours
    const t = P.findIndex((p, i) => s.provs[i].ctrl === 1 && p.neighbors.filter((n) => s.provs[n].ctrl === 0).length >= 2);
    if (t < 0) return;
    const [a, b] = P[t].neighbors.filter((n) => s.provs[n].ctrl === 0);
    s.provs[a].troops = s.provs[b].troops = 20000;
    const o1 = { kind: 'serang' as const, from: a, path: [a, t], frac: 1 as const };
    const o2 = { kind: 'serang' as const, from: b, path: [b, t], frac: 1 as const };
    const single = attackOdds(map, s, 0, o1)!.ratio!;
    const both = attackOdds(map, s, 0, o1, [o1, o2])!.ratio!;
    expect(both).toBeGreaterThan(single * 2);
  });
});

describe('manoeuvre rules (putaran 2)', () => {
  const map = generateMap({ seed: 5, shape: 'benua', size: 'sedang' });
  const fresh = () => newGame(map, [{ name: 'A', kind: 'ai', color: 0 }, { name: 'B', kind: 'ai', color: 1 }], 0, { ...settings, fog: false });
  const deepPath = (s: GameState) => {
    for (let a = 0; a < s.provs.length; a++) {
      if (s.provs[a].ctrl !== 0) continue;
      const b = map.provinces[a].neighbors.find((n) => s.provs[n].ctrl === 1);
      if (b === undefined) continue;
      const path = [a, b];
      let cur = b;
      for (let k = 0; k < 4; k++) {
        const nx = map.provinces[cur].neighbors.find((n) => s.provs[n].ctrl === 1 && !path.includes(n));
        if (nx === undefined) break;
        path.push(nx);
        cur = nx;
      }
      if (path.length >= 4) return path;
    }
    return null;
  };

  it('an army marches through empty enemy land without stopping at every border', () => {
    const s = fresh();
    s.provs.forEach((p) => { if (p.ctrl === 1) p.troops = 0; });
    const path = deepPath(s)!;
    s.provs[path[0]].troops = 20000;
    const r = resolveTurn(map, s, [[{ kind: 'serang', from: path[0], path, frac: 1 }], []]);
    for (const p of path) expect(r.state.provs[p].ctrl).toBe(0);
  });

  it('a much stronger column overruns a weak garrison', () => {
    const s = fresh();
    const path = deepPath(s)!.slice(0, 2);
    s.provs[path[0]].troops = 60000;
    s.provs[path[1]].troops = 1500;
    const r = resolveTurn(map, s, [[{ kind: 'serang', from: path[0], path, frac: 1 }], []]);
    const caps = r.res.frames.flatMap((f) => f.events).filter((e) => e.t === 'capture' && e.prov === path[1]);
    expect(caps.length).toBe(1);
    expect(r.state.provs[path[1]].ctrl).toBe(0);
  });

  it('keeps the drawn stroke on the columns and staggers events inside each day', () => {
    const s = fresh();
    const path = deepPath(s)!.slice(0, 2);
    const stroke = path.map((i) => ({ x: map.provinces[i].x + 3, y: map.provinces[i].y - 4 }));
    const r = resolveTurn(map, s, [[{ kind: 'serang', from: path[0], path, frac: 1, stroke }], []]);
    expect(r.res.frames[0].cols[0].stroke).toEqual(stroke);
    for (const f of r.res.frames) for (const e of f.events) if (e.t === 'capture' || e.t === 'battle') {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeLessThanOrEqual(1);
    }
  });
});
