import { Rng } from '../core/rng';
import type { GameMap } from '../map/types';
import {
  BUILD_INFO, RULES, UNIT_INFO, allied, artilleryDefense, artillerySupport, atWar, columnAttack, defenseMultiplier,
  findPath, isSeaStep, manpowerCap, stackCap, totalTroops, unitDefense,
} from './rules';
import type { GameState, Order, Proposal, Unit, UnitType } from './types';

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
  const myUnits = s.units.filter((u) => u.owner === c);
  const free = new Set(myUnits.map((u) => u.id));
  const freeAt = (i: number) => myUnits.filter((u) => u.prov === i && free.has(u.id));
  const strOf = (us: Unit[]) => us.reduce((a, u) => a + u.str, 0);
  const threat = (i: number) => enemyAdj(i).reduce((a, n) => a + s.provs[n].troops, 0) / Math.max(1, s.provs[i].troops);
  // projected garrison after this turn's moves, to respect stacking limits
  const projected = new Map<number, number>();
  for (const i of mine) projected.set(i, s.provs[i].troops);
  const room = (i: number) => stackCap(map, s, i) - (projected.get(i) ?? 0);
  const take = (us: Unit[], from: number) => {
    for (const u of us) free.delete(u.id);
    projected.set(from, (projected.get(from) ?? 0) - strOf(us));
  };

  // attacks: enemy provinces bordering us, best value per defence first
  const targets = new Set<number>();
  for (const i of front) for (const n of enemyAdj(i)) targets.add(n);
  const scored = [...targets].map((q) => {
    const dus = s.units.filter((u) => u.prov === q);
    const deff = Math.max(1, dus.reduce((a, u) => a + u.str * unitDefense(map, s, u), 0)) * defenseMultiplier(map, s, q) *
      (s.countries[s.provs[q].ctrl]?.quality ?? 1) * artilleryDefense(dus);
    const value = s.provs[q].pop / 1000 + (s.countries[s.provs[q].ctrl]?.capital === q ? 5 : 0) + (s.provs[q].owner === c ? 3 : 0);
    return { q, deff, value };
  }).sort((a, b) => b.value / b.deff - a.value / a.deff);
  let group = 1;
  for (const t of scored) {
    const plan: { from: number; units: Unit[] }[] = [];
    for (const n of P[t.q].neighbors) {
      if (s.provs[n].ctrl !== c) continue;
      const here = freeAt(n);
      if (!here.length || strOf(here) < 1500) continue;
      // threatened provinces keep a division (preferably infantry/artillery) behind
      let send = here;
      if (threat(n) > 0.8 && here.length > 1) {
        const keep = here.slice().sort((a, b) => (a.type === 'arm' ? 1 : 0) - (b.type === 'arm' ? 1 : 0) || b.str - a.str)[0];
        send = here.filter((u) => u !== keep);
      } else if (threat(n) > 0.8 && me.personality !== 'agresif') continue;
      // artillery supports from where it stands instead of attacking
      send = send.filter((u) => u.type !== 'art');
      if (send.length) plan.push({ from: n, units: send });
    }
    if (!plan.length) continue;
    const pincer = plan.length >= 2 ? RULES.pincerBonus : 1;
    const pot = plan.reduce((a, p) => a + columnAttack(map, s, p.units, t.q, isSeaStep(map, p.from, t.q)), 0) *
      me.quality * skill * pincer * artillerySupport(map, s, c, t.q);
    const need = t.deff * (me.personality === 'agresif' ? 1.15 : 1.35);
    if (pot < need) continue;
    for (const p of plan) {
      orders.push({ kind: 'serang', from: p.from, path: [p.from, t.q], units: p.units.map((u) => u.id), group });
      take(p.units, p.from);
    }
    group++;
  }

  // reinforcement: interior divisions flow to the most threatened front provinces with room
  const moves = new Map<string, { from: number; path: number[]; units: Unit[] }>();
  const addMove = (from: number, dest: number, u: Unit) => {
    const key = from + '>' + dest;
    let m = moves.get(key);
    if (!m) {
      const path = findPath(map, s, c, from, dest, { attack: false });
      if (!path || path.length < 2) return false;
      m = { from, path, units: [] };
      moves.set(key, m);
    }
    m.units.push(u);
    take([u], from);
    projected.set(dest, (projected.get(dest) ?? 0) + u.str);
    return true;
  };
  if (front.length) {
    const ranked = front.slice().sort((a, b) => threat(b) - threat(a));
    for (const i of mine) {
      if (front.includes(i)) continue;
      const here = freeAt(i).sort((a, b) => b.str - a.str);
      // the capital keeps one division
      const movable = i === me.capital ? here.slice(1) : here;
      for (const u of movable) {
        let dest = -1, bd = Infinity;
        for (const f of ranked) {
          if (room(f) < u.str * 0.8) continue;
          const d = Math.hypot(P[f].x - P[i].x, P[f].y - P[i].y) / (1 + threat(f));
          if (d < bd) { bd = d; dest = f; }
        }
        if (dest < 0) break;
        addMove(i, dest, u);
      }
    }
  } else if (enemies.length === 0) {
    // peacetime: spread divisions toward borders with other countries
    const border = mine.filter((i) => P[i].neighbors.some((n) => s.provs[n].ctrl !== c && !allied(s, c, s.provs[n].ctrl)));
    for (const i of mine) {
      if (border.includes(i) || i === me.capital || !border.length) continue;
      const here = freeAt(i);
      if (here.length < 2 || !rng.chance(0.3)) continue;
      const u = here[0];
      const dest = border[Math.floor(rng.next() * border.length)];
      if (room(dest) < u.str) continue;
      addMove(i, dest, u);
    }
  }
  moves.forEach((m) => orders.push({ kind: 'gerak', from: m.from, path: m.path, units: m.units.map((u) => u.id) }));

  // ---- economy ----
  let money = me.treasury;
  const cap = manpowerCap(s, c);
  let troops = totalTroops(s, c);
  const hasMil = s.provs.some((p) => p.ctrl === c && p.milFactories > 0);
  if (enemies.length && front.length) {
    const ranked = front.slice().sort((a, b) => threat(b) - threat(a));
    for (const f of ranked.slice(0, 3)) {
      if (s.provs[f].owner !== c) continue;
      const r = rng.next();
      let type: UnitType = hasMil && r < 0.25 ? 'arm' : r < 0.45 ? 'art' : 'inf';
      if (type === 'inf' && P[f].coastal && rng.chance(0.15)) type = 'mar';
      const info = UNIT_INFO[type];
      if (money * 0.6 < info.cost || troops + info.maxStr > cap || room(f) < info.maxStr * 0.8) continue;
      orders.push({ kind: 'rekrut', prov: f, type });
      projected.set(f, (projected.get(f) ?? 0) + info.maxStr);
      money -= info.cost;
      troops += info.maxStr;
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
