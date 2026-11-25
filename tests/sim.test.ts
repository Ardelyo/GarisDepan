import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/map/mapgen';
import { migrateState, newGame } from '../src/sim/setup';
import { planAI } from '../src/sim/ai';
import { resolveTurn } from '../src/sim/sim';
import { RULES, SUPPLY_FULL, UNIT_INFO, attackOdds, makeUnit, stackCap, supplyLevels, syncTroops, totalTroops, unitsIn } from '../src/sim/rules';
import type { GameState, Order, Settings } from '../src/sim/types';

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
    for (let k = 0; k < 10; k++) makeUnit(s, 0, 'inf', cap);
    syncTroops(s);
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
    makeUnit(s, 0, 'inf', a);
    makeUnit(s, 0, 'inf', b);
    syncTroops(s);
    const o1 = { kind: 'serang' as const, from: a, path: [a, t], units: unitsIn(s, a).map((u) => u.id) };
    const o2 = { kind: 'serang' as const, from: b, path: [b, t], units: unitsIn(s, b).map((u) => u.id) };
    const single = attackOdds(map, s, 0, o1)!.ratio!;
    const both = attackOdds(map, s, 0, o1, [o1, o2])!.ratio!;
    expect(both).toBeGreaterThan(single * 2);
  });
});

describe('divisions (revamp)', () => {
  const map = generateMap({ seed: 5, shape: 'benua', size: 'sedang' });
  const base = () => newGame(map, [
    { name: 'A', kind: 'ai', color: 0 }, { name: 'B', kind: 'ai', color: 1 },
  ], 2, settings);

  it('starts with a mixed order of battle that matches province troops', () => {
    const s = base();
    const types = new Set(s.units.filter((u) => u.owner === 0).map((u) => u.type));
    expect(types.has('inf')).toBe(true);
    expect(types.size).toBeGreaterThanOrEqual(2);
    for (const u of s.units) expect(u.str).toBeLessThanOrEqual(UNIT_INFO[u.type].maxStr + 1);
    s.provs.forEach((p, i) => expect(p.troops).toBe(unitsIn(s, i).reduce((a, u) => a + u.str, 0)));
  });

  it('moves only the ordered divisions and they arrive', () => {
    const s = base();
    const src = s.provs.findIndex((p, i) => p.ctrl === 0 && unitsIn(s, i).length >= 2 &&
      map.provinces[i].neighbors.some((n) => s.provs[n].ctrl === 0));
    if (src < 0) return;
    const dst = map.provinces[src].neighbors.find((n) => s.provs[n].ctrl === 0)!;
    const [u1, u2] = unitsIn(s, src);
    const orders = s.countries.map(() => [] as Order[]);
    orders[0] = [{ kind: 'gerak', from: src, path: [src, dst], units: [u1.id] }];
    const next = resolveTurn(map, s, orders).state;
    expect(next.units.find((u) => u.id === u1.id)?.prov).toBe(dst);
    expect(next.units.find((u) => u.id === u2.id)?.prov).toBe(src);
  });

  it('recruiting creates a division of the requested type', () => {
    const s = base();
    s.countries[0].treasury = 1000;
    const cap = s.countries[0].capital;
    const orders = s.countries.map(() => [] as Order[]);
    orders[0] = [{ kind: 'rekrut', prov: cap, type: 'art' }];
    const before = s.units.filter((u) => u.owner === 0 && u.type === 'art').length;
    const next = resolveTurn(map, s, orders).state;
    expect(next.units.filter((u) => u.owner === 0 && u.type === 'art').length).toBe(before + 1);
  });

  it('migrates a version-1 save into divisions', () => {
    const s = base() as unknown as Record<string, unknown>;
    const old = JSON.parse(JSON.stringify(s));
    delete old.units; delete old.groups; old.version = 1;
    const m = migrateState(map, old);
    expect(m.version).toBe(2);
    expect(m.units.length).toBeGreaterThan(0);
  });
});
