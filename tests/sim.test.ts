import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/map/mapgen';
import { newGame } from '../src/sim/setup';
import { planAI } from '../src/sim/ai';
import { resolveTurn } from '../src/sim/sim';
import { totalTroops } from '../src/sim/rules';
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
