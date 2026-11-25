/**
 * AI-vs-AI balance batch: 4 map shapes × 6 seeds × (start at war / at peace), 4 great powers + 3 minors,
 * 120-turn limit. Prints one line per game and an aggregate. Run with `npm run balance`.
 */
import { it } from 'vitest';
import { generateMap } from '../src/map/mapgen';
import { newGame } from '../src/sim/setup';
import { planAI } from '../src/sim/ai';
import { resolveTurn } from '../src/sim/sim';
import { totalTroops } from '../src/sim/rules';
import type { GameState, Settings, Order } from '../src/sim/types';

it('balance batch', () => {
  const shapes = ['semenanjung', 'benua', 'kepulauan', 'duaBenua'] as const;
  const out: string[] = [];
  const agg = {
    games: 0, winners: {} as Record<string, number>, turnsTo: [] as number[], noWinner: 0,
    orderKinds: {} as Record<string, number>, captures: 0, battles: 0, peace: 0, wars: 0, amph: 0, dikepung: 0,
    buildK: {} as Record<string, number>, warTurnShare: [] as number[], leaderPop: [] as number[], leaderGdp: [] as number[], firstCapTurn: [] as number[], aliveMajorsAtEnd: [] as number[],
  };
  for (const startAtWar of [true, false]) for (const shape of shapes) for (let seed = 1; seed <= 6; seed++) {
    const settings: Settings = { theme: 'satelit', tempo: 'santai', startAtWar, usePin: false, difficulty: 'perwira', fog: true, victory: { dominasi: true, ekonomi: true, skor: true, turnLimit: 120 } };
    const map = generateMap({ seed: seed * 31 + shapes.indexOf(shape), shape, size: 'sedang' });
    let s: GameState = newGame(map, [0, 1, 2, 3].map((i) => ({ name: 'P' + i, kind: 'ai' as const, color: i })), 3, settings);
    let firstCap = -1; let warT = 0, totT = 0;
    for (let t = 0; t < 120 && !s.winner; t++) {
      const orders: Order[][] = s.countries.map((c) => planAI(map, s, c.id));
      for (const os of orders) for (const o of os) {
        agg.orderKinds[o.kind] = (agg.orderKinds[o.kind] ?? 0) + 1;
        if (o.kind === 'bangun') agg.buildK[o.what] = (agg.buildK[o.what] ?? 0) + 1;
      }
      const r = resolveTurn(map, s, orders);
      for (const f of r.res.frames) for (const e of f.events) {
        if (e.t === 'battle') agg.battles++;
        if (e.t === 'capture') agg.captures++;
        if (e.t === 'amphib') agg.amph++;
        if (e.t === 'moment' && e.kind === 'dikepung') agg.dikepung++;
        if (e.t === 'moment' && e.kind === 'ibukota' && firstCap < 0) firstCap = s.turn;
        if (e.t === 'moment' && e.kind === 'damai') agg.peace++;
        if (e.t === 'moment' && e.kind === 'perang') agg.wars++;
      }
      s = r.state;
      for (const c of s.countries) if (c.kind !== 'minor' && c.alive) { totT++; if (s.rel[c.id].some((x, k) => k !== c.id && x.status === 'perang' && s.countries[k].alive)) warT++; }
    }
    agg.warTurnShare.push(Math.round(100 * warT / Math.max(1, totT)));
    { const wp = s.provs.reduce((a, p) => a + p.pop, 0); let best = 0; for (const c of s.countries) best = Math.max(best, s.provs.reduce((a, p) => a + (p.ctrl === c.id ? p.pop : 0), 0) / wp); agg.leaderPop.push(Math.round(best * 100)); }
    agg.games++;
    if (firstCap > 0) agg.firstCapTurn.push(firstCap);
    const w = s.winner ? s.winner.cond.split(':')[0].split('(')[0].trim() : 'none';
    agg.winners[w] = (agg.winners[w] ?? 0) + 1;
    if (s.winner) agg.turnsTo.push(s.turn - 1); else agg.noWinner++;
    const maj = s.countries.filter((c) => c.kind !== 'minor');
    agg.aliveMajorsAtEnd.push(maj.filter((c) => c.alive).length);
    out.push(`${startAtWar ? 'WAR' : 'PEACE'} ${shape} s${seed} T${s.turn - 1} win=${s.winner ? s.winner.country + ':' + w : '-'} | ` +
      maj.map((c) => `${c.id}${c.alive ? '' : 'x'}:${s.provs.filter((p) => p.ctrl === c.id).length}p/${Math.round(totalTroops(s, c.id) / 1000)}k/q${c.quality}/st${Math.round(c.stability)}/w${Math.round(c.weariness)}/$${Math.round(c.treasury)}/${c.personality}`).join(' '));
  }
  console.log(out.join('\n'));
  agg.turnsTo.sort((a, b) => a - b);
  console.log(JSON.stringify({ ...agg, turnsTo: agg.turnsTo.join(','), firstCapTurn: agg.firstCapTurn.sort((a, b) => a - b).join(','), aliveMajorsAtEnd: agg.aliveMajorsAtEnd.join(','), warTurnShare: agg.warTurnShare.join(','), leaderPop: agg.leaderPop.sort((a, b) => a - b).join(',') }, null, 1));
}, 600000);
