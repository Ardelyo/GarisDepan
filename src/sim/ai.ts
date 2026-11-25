import { Rng } from '../core/rng';
import type { GameMap } from '../map/types';
import {
  BUILD_INFO, RULES, allied, atWar, defenseMultiplier, findPath, manpowerCap, stackCap, totalTroops,
} from './rules';
import type { Frac, GameState, Order, Proposal } from './types';

/** Utility AI: same order format as human players, no cheating on orders. */

function strength(s: GameState, c: number): number {
  return totalTroops(s, c) * s.countries[c].quality;
}

export function aiAcceptsProposal(_map: GameMap, s: GameState, p: Proposal): boolean {
  const me = s.countries[p.to];
  const them = s.countries[p.from];
  const r = s.rel[p.to][p.from];
  const ratio = strength(s, p.from) / Math.max(1, strength(s, p.to));
  const trust = r.value + them.reputation * 0.5 + p.pay * 0.1;
  switch (p.kind) {
    case 'damai': {
      // accept when losing, tired, or when the war is going nowhere
      const losing = ratio > 1.3 || me.weariness > 45 || me.exiled;
      const winningBig = ratio < 0.6 && me.weariness < 30;
      return !winningBig && (losing || me.personality === 'pasifis' || p.pay > 100 || trust > -20 && me.weariness > 25);
    }
    case 'aliansi': {
      const commonEnemy = s.countries.some((k) => k.alive && atWar(s, p.to, k.id) && atWar(s, p.from, k.id));
      return (commonEnemy && trust > -30) || trust > 40;
    }
    case 'nap':
      return me.personality !== 'agresif' && trust > -40;
    case 'dagang':
      return trust > -20;
  }
}

const DIFF = { rekrut: 0.75, perwira: 1, jenderal: 1.2 } as const;

export function planAI(map: GameMap, s: GameState, c: number): Order[] {
  const rng = new Rng((s.rng ^ (c * 7919 + s.turn * 104729)) >>> 0);
  const me = s.countries[c];
  const P = map.provinces;
  const orders: Order[] = [];
  if (!me.alive) return orders;
  const skill = me.kind === 'minor' ? 0.8 : DIFF[s.settings.difficulty];
  const mine = s.provs.map((p, i) => (p.ctrl === c ? i : -1)).filter((i) => i >= 0);
  const enemies = s.countries.filter((k) => k.alive && atWar(s, c, k.id)).map((k) => k.id);

  // ---- budget ----
  me.budget = enemies.length ? { mil: 60, civ: 25, res: 15 } : { mil: 30, civ: 45, res: 25 };

  // ---- event ----
  if (me.pendingEvent) orders.push({ kind: 'event', choice: me.treasury > 150 ? 0 : 1 });

  // ---- answer proposals ----
  for (const pr of s.proposals) {
    if (pr.to !== c) continue;
    orders.push({ kind: 'jawab', proposal: pr.id, accept: aiAcceptsProposal(map, s, pr) });
  }

  // ---- diplomacy ----
  for (const e of enemies) {
    const ratio = strength(s, e) / Math.max(1, strength(s, c));
    if ((me.weariness > 55 || ratio > 1.8 || me.exiled) && rng.chance(0.5)) orders.push({ kind: 'usul', to: e, what: 'damai', pay: 0 });
  }
  if (me.kind !== 'minor' && s.turn > 3 && enemies.length === 0 && (me.personality === 'agresif' || me.personality === 'oportunis')) {
    // pick the weakest neighbour
    const nbs = new Set<number>();
    for (const i of mine) for (const n of P[i].neighbors) {
      const o = s.provs[n].ctrl;
      if (o !== c && s.rel[c][o].status === 'damai' && s.rel[c][o].truce === 0) nbs.add(o);
    }
    let best = -1, br = 0;
    nbs.forEach((o) => {
      const r = strength(s, c) / Math.max(1, strength(s, o));
      if (r > br) { br = r; best = o; }
    });
    const threshold = me.personality === 'agresif' ? 1.3 : 2.0;
    if (best >= 0 && br > threshold && rng.chance(me.personality === 'agresif' ? 0.35 : 0.15)) {
      orders.push({ kind: 'deklarasi', target: best });
      enemies.push(best);
    }
  }
  if (me.kind !== 'minor' && rng.chance(0.15)) {
    // seek allies against our enemies / trade with peaceful neighbours
    for (const k of s.countries) {
      if (k.id === c || !k.alive || k.kind === 'manusia') continue;
      const r = s.rel[c][k.id];
      if (r.status === 'damai' && !r.trade && rng.chance(0.3)) orders.push({ kind: 'usul', to: k.id, what: 'dagang', pay: 0 });
    }
  }

  // ---- military ----
  const hostile = (i: number) => enemies.includes(s.provs[i].ctrl);
  const enemyAdj = (i: number) => P[i].neighbors.filter(hostile);
  const front = mine.filter((i) => enemyAdj(i).length > 0);
  const avail = new Map<number, number>();
  for (const i of mine) avail.set(i, s.provs[i].troops);
  const threat = (i: number) => enemyAdj(i).reduce((a, n) => a + s.provs[n].troops, 0) / Math.max(1, s.provs[i].troops);
  // projected garrison after this turn's moves, to respect stacking limits
  const projected = new Map<number, number>();
  for (const i of mine) projected.set(i, s.provs[i].troops);
  const room = (i: number) => stackCap(map, s, i) - (projected.get(i) ?? 0);

  // attacks: enemy provinces bordering us, weakest first
  const targets = new Set<number>();
  for (const i of front) for (const n of enemyAdj(i)) targets.add(n);
  const scored = [...targets].map((q) => {
    const deff = Math.max(1, s.provs[q].troops) * defenseMultiplier(map, s, q) * (s.countries[s.provs[q].ctrl]?.quality ?? 1);
    const value = s.provs[q].pop / 1000 + (s.countries[s.provs[q].ctrl]?.capital === q ? 5 : 0) + (s.provs[q].owner === c ? 3 : 0);
    return { q, deff, value };
  }).sort((a, b) => b.value / b.deff - a.value / a.deff);
  let group = 1;
  for (const t of scored) {
    const srcs = P[t.q].neighbors.filter((n) => s.provs[n].ctrl === c && (avail.get(n) ?? 0) > 1500);
    if (!srcs.length) continue;
    let pot = 0;
    for (const n of srcs) pot += (avail.get(n) ?? 0) * 0.75;
    pot *= me.quality * skill;
    const need = t.deff * (me.personality === 'agresif' ? 1.15 : 1.35);
    if (pot < need) continue;
    for (const n of srcs) {
      const frac: Frac = threat(n) > 0.8 ? 0.5 : 1;
      const keep = frac === 1 ? 0 : 0.5;
      orders.push({ kind: 'serang', from: n, path: [n, t.q], frac, group });
      avail.set(n, (avail.get(n) ?? 0) * keep);
      projected.set(n, (projected.get(n) ?? 0) * keep);
    }
    group++;
  }

  // reinforcement: interior troops flow to the most threatened front province
  if (front.length) {
    const ranked = front.slice().sort((a, b) => threat(b) - threat(a));
    for (const i of mine) {
      if (front.includes(i) || (avail.get(i) ?? 0) < 2000) continue;
      if (i === me.capital && enemies.length === 0) continue;
      const frac: Frac = i === me.capital ? 0.5 : (avail.get(i) ?? 0) > 2 * Math.max(2000, room(ranked[0])) ? 0.5 : 1;
      const amt = (avail.get(i) ?? 0) * frac;
      let dest = -1, bd = Infinity;
      for (const f of ranked) {
        if (room(f) < Math.min(amt, 4000)) continue;
        const d = Math.hypot(P[f].x - P[i].x, P[f].y - P[i].y) / (1 + threat(f));
        if (d < bd) { bd = d; dest = f; }
      }
      if (dest < 0) continue;
      const path = findPath(map, s, c, i, dest, { attack: false });
      if (path && path.length >= 2) {
        orders.push({ kind: 'gerak', from: i, path, frac });
        avail.set(i, (avail.get(i) ?? 0) - amt);
        projected.set(i, (projected.get(i) ?? 0) - amt);
        projected.set(dest, (projected.get(dest) ?? 0) + amt);
      }
    }
  } else if (enemies.length === 0) {
    // peacetime: spread troops toward borders with other countries
    const border = mine.filter((i) => P[i].neighbors.some((n) => s.provs[n].ctrl !== c && !allied(s, c, s.provs[n].ctrl)));
    for (const i of mine) {
      if (border.includes(i) || i === me.capital || s.provs[i].troops < 5000 || !border.length) continue;
      if (!rng.chance(0.3)) continue;
      const dest = border[Math.floor(rng.next() * border.length)];
      const amt = s.provs[i].troops * 0.5;
      if (room(dest) < amt) continue;
      const path = findPath(map, s, c, i, dest, { attack: false });
      if (path) {
        orders.push({ kind: 'gerak', from: i, path, frac: 0.5 });
        projected.set(dest, (projected.get(dest) ?? 0) + amt);
      }
    }
  }

  // ---- economy ----
  let money = me.treasury;
  const cap = manpowerCap(s, c);
  let troops = totalTroops(s, c);
  if (enemies.length && front.length) {
    const ranked = front.slice().sort((a, b) => threat(b) - threat(a));
    for (const f of ranked.slice(0, 3)) {
      if (s.provs[f].owner !== c) continue;
      const amount = Math.min(30000, Math.floor((money * 0.5) / RULES.recruitCostPer1000) * 1000, Math.floor((cap - troops) / 1000) * 1000,
        Math.floor(room(f) / 1000) * 1000);
      if (amount < 5000) continue;
      orders.push({ kind: 'rekrut', prov: f, amount });
      projected.set(f, (projected.get(f) ?? 0) + amount);
      money -= (amount / 1000) * RULES.recruitCostPer1000;
      troops += amount;
    }
    const hot = ranked[0];
    if (hot !== undefined && s.provs[hot].owner === c && s.provs[hot].fort < 2 && s.provs[hot].queue.length === 0 && money > BUILD_INFO.benteng.cost + 50) {
      orders.push({ kind: 'bangun', prov: hot, what: 'benteng' });
      money -= BUILD_INFO.benteng.cost;
    }
  }
  if (money > 260) {
    const own = mine.filter((i) => s.provs[i].owner === c && s.provs[i].queue.length === 0)
      .sort((a, b) => s.provs[b].pop - s.provs[a].pop);
    const pick = own[0];
    if (pick !== undefined) {
      const what = enemies.length && rng.chance(0.5) ? 'pabrikMil' : 'pabrik';
      orders.push({ kind: 'bangun', prov: pick, what });
      money -= BUILD_INFO[what].cost;
    }
  }
  if (enemies.length && money > RULES.airCost + 100 && me.kind !== 'minor' && scored.length && rng.chance(0.4)) {
    const q = scored[0].q;
    orders.push({ kind: 'udara', x: P[q].x, y: P[q].y, r: 70 });
  }
  return orders;
}
