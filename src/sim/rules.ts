import type { GameMap } from '../map/types';
import { TERRAIN_INFO } from '../map/types';
import type { Pt } from '../core/geom';
import { distToPolyline } from '../core/geom';
import type { BuildKind, GameState, Order, ProposalKind, Unit, UnitType } from './types';

/** Balancing constants — starting values, not real-world data. */
export const RULES = {
  daysPerTurn: 7,
  lanchesterK: 0.09,
  breakRatio: 1.7,
  attackerGiveUp: 0.65,
  amphibPenalty: 0.6,
  pincerBonus: 1.2,
  airBonus: 1.2,
  capitalBonus: 1.2,
  entrenchBonus: 1.25,
  fortPerLevel: 0.25,
  unsuppliedAttrition: 0.1,
  unsuppliedCombat: 0.65,
  mobilizationCap: 0.025, // of population
  mobilizationSoft: 0.02,
  recruitCostPer1000: 6,
  integrationPerTurn: 0.15,
  airCost: 40,
  spyCost: 60,
  // ---- stacking: how many troops a province can feed ----
  stackBase: 14000,
  stackPerInfra: 6000,
  stackPerUrban: 18000,
  overStackLoss: 0.15, // share of the excess lost per turn
  // ---- supply range (in route-cost units from a depot) ----
  supplyRange: 3.2,
  stretchedCombat: 0.82,
  stretchedAttrition: 0.04,
  // ---- research ----
  qualityCap: 1.5,
};

/**
 * Division types. atk/def are multipliers on strength; armour is further modified by terrain
 * (see unitAttack). Artillery supports attacks launched next to it; marines ignore the
 * amphibious penalty.
 */
export const UNIT_INFO: Record<UnitType, {
  name: string; short: string; maxStr: number; cost: number; speed: number; atk: number; def: number; desc: string;
}> = {
  inf: { name: 'Infanteri', short: 'INF', maxStr: 12000, cost: 70, speed: 1, atk: 1, def: 1, desc: 'Tulang punggung garis depan. Murah dan tangguh bertahan.' },
  arm: { name: 'Lapis Baja', short: 'LB', maxStr: 9000, cost: 160, speed: 1.45, atk: 1.7, def: 1, desc: 'Cepat dan kuat menyerang di medan terbuka; lemah di gunung, hutan, dan kota.' },
  art: { name: 'Artileri', short: 'ART', maxStr: 6000, cost: 110, speed: 0.85, atk: 0.5, def: 1.15, desc: 'Memperkuat serangan ke provinsi di sebelahnya (+12% per divisi) dan pertahanan.' },
  mar: { name: 'Marinir', short: 'MAR', maxStr: 9000, cost: 120, speed: 1, atk: 1.05, def: 0.95, desc: 'Tanpa penalti pendaratan amfibi.' },
};
export const UNIT_TYPES: UnitType[] = ['inf', 'arm', 'art', 'mar'];

/** Terrain penalty for armour (1 = open ground). */
export function armourTerrain(map: GameMap, s: GameState, prov: number): number {
  const t = map.provinces[prov].terrain;
  let k = t === 'gunung' ? 0.45 : t === 'hutan' || t === 'bukit' || t === 'rawa' || t === 'hutanHujan' ? 0.62 : 1;
  if (s.provs[prov].urban > 0) k *= 0.7;
  return k;
}

/** Attack multiplier of a unit fighting into province `target`. */
export function unitAttack(map: GameMap, s: GameState, u: Unit, target: number): number {
  let m = UNIT_INFO[u.type].atk;
  if (u.type === 'arm') m *= armourTerrain(map, s, target);
  return m * (0.45 + 0.55 * u.org);
}

/** Defence multiplier of a unit holding its province. */
export function unitDefense(map: GameMap, s: GameState, u: Unit): number {
  let m = UNIT_INFO[u.type].def;
  if (u.type === 'arm' && u.prov >= 0) m *= 0.6 + 0.4 * armourTerrain(map, s, u.prov);
  return m * (0.45 + 0.55 * u.org);
}

/** Artillery support for an attack on `target`: own artillery standing in provinces bordering it. */
export function artillerySupport(map: GameMap, s: GameState, c: number, target: number): number {
  const adj = new Set(map.provinces[target].neighbors);
  let k = 0;
  for (const u of s.units) if (u.owner === c && u.type === 'art' && adj.has(u.prov)) k += u.str / UNIT_INFO.art.maxStr;
  return 1 + Math.min(0.5, 0.12 * k);
}

/** Artillery dug in with the defenders. */
export function artilleryDefense(units: Unit[]): number {
  return 1 + Math.min(0.4, 0.15 * units.filter((u) => u.type === 'art').length);
}

export function unitsIn(s: GameState, prov: number): Unit[] {
  return s.units.filter((u) => u.prov === prov);
}

export function unitById(s: GameState, id: number): Unit | undefined {
  return s.units.find((u) => u.id === id);
}

/** Recompute province troop totals from units. */
export function syncTroops(s: GameState) {
  for (const p of s.provs) p.troops = 0;
  for (const u of s.units) if (u.prov >= 0) s.provs[u.prov].troops += u.str;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const roman = (n: number) => ROMAN[n - 1] ?? String(n);

/** Create a fresh division owned by c in prov. */
export function makeUnit(s: GameState, c: number, type: UnitType, prov: number, str = UNIT_INFO[type].maxStr, org = 1): Unit {
  const k = s.countries[c];
  k.unitSerial[type] = (k.unitSerial[type] ?? 0) + 1;
  const u: Unit = {
    id: s.nextUnitId++, owner: c, type, prov, str: Math.round(str), org, group: 0,
    name: `${k.unitSerial[type]}. Div. ${UNIT_INFO[type].name}`,
  };
  s.units.push(u);
  return u;
}

export const BUILD_INFO: Record<BuildKind, { name: string; cost: number; turns: number; desc: string }> = {
  pabrik: { name: 'Pabrik sipil', cost: 120, turns: 4, desc: '+PDB provinsi' },
  pabrikMil: { name: 'Pabrik militer', cost: 150, turns: 5, desc: 'Peralatan & penguatan otomatis' },
  benteng: { name: 'Benteng', cost: 80, turns: 2, desc: '+25% bertahan per level (maks 3)' },
  pelabuhan: { name: 'Pelabuhan', cost: 100, turns: 4, desc: 'Syarat invasi amfibi & dagang laut' },
  kota: { name: 'Perluasan kota', cost: 160, turns: 6, desc: '+populasi urban, +pajak' },
  jalan: { name: 'Jalan / rel', cost: 25, turns: 1, desc: 'Per provinsi: +kecepatan & suplai' },
};

export const relOf = (s: GameState, a: number, b: number) => s.rel[a][b];
export const atWar = (s: GameState, a: number, b: number) => a !== b && s.rel[a][b].status === 'perang';
export const allied = (s: GameState, a: number, b: number) => a === b || s.rel[a][b].status === 'aliansi';

/** Can country c pass/stay in province p without fighting? */
export const friendlyTo = (s: GameState, c: number, p: number) => allied(s, c, s.provs[p].ctrl);

export function countryProvs(s: GameState, c: number): number[] {
  const out: number[] = [];
  s.provs.forEach((p, i) => { if (p.ctrl === c) out.push(i); });
  return out;
}

export function totalTroops(s: GameState, c: number): number {
  let t = 0;
  for (const u of s.units) if (u.owner === c) t += u.str;
  return t;
}

export function totalPop(s: GameState, c: number): number {
  let t = 0;
  for (const p of s.provs) if (p.owner === c) t += p.pop;
  return t;
}

export function manpowerCap(s: GameState, c: number): number {
  return totalPop(s, c) * 1000 * RULES.mobilizationCap;
}

export function provinceGdp(s: GameState, i: number): number {
  const p = s.provs[i];
  const c = s.countries[p.owner];
  const stab = c ? 0.6 + 0.4 * (c.stability / 100) : 1;
  const occupied = p.ctrl !== p.owner ? 0.25 : 1;
  return (p.pop / 1000) * (1 + 0.35 * p.factories + 0.1 * p.urban) * (1 + 0.06 * p.infra) * p.integration * stab * occupied * (p.scorched > 0 ? 0.3 : 1);
}

export function countryGdp(s: GameState, c: number): number {
  let g = 0;
  s.provs.forEach((p, i) => { if (p.owner === c && p.ctrl === c) g += provinceGdp(s, i); });
  return g;
}

/** Max troops a province can sustain; above this the excess wastes away. */
export function stackCap(map: GameMap, s: GameState, i: number): number {
  const p = s.provs[i];
  const terr = Math.max(0.6, Math.min(1, TERRAIN_INFO[map.provinces[i].terrain].speed));
  return Math.round((RULES.stackBase + RULES.stackPerInfra * p.infra + RULES.stackPerUrban * p.urban) * terr);
}

export const SUPPLY_CUT = 0, SUPPLY_STRETCHED = 1, SUPPLY_FULL = 2;

/**
 * Supply level per province for country c. Depots are the capital and own cities;
 * supply flows through own/allied land (and by sea from ports), and each step costs
 * less on good roads. Within `supplyRange` = full, up to twice that = stretched,
 * further or disconnected = cut.
 */
export function supplyLevels(map: GameMap, s: GameState, c: number): Uint8Array {
  const n = s.provs.length;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const country = s.countries[c];
  if (country.capital >= 0 && s.provs[country.capital].ctrl === c) dist[country.capital] = 0;
  s.provs.forEach((p, i) => { if (p.ctrl === c && p.owner === c && p.urban > 0) dist[i] = 0; });
  const step = (b: number) => {
    const pb = s.provs[b];
    let k = 1 / (1 + 0.3 * pb.infra);
    if (pb.owner !== c) k *= 1.5; // occupied land: no depots, hostile population
    return k;
  };
  for (;;) {
    let i = -1, bd = Infinity;
    for (let j = 0; j < n; j++) if (!done[j] && dist[j] < bd) { bd = dist[j]; i = j; }
    if (i < 0) break;
    done[i] = 1;
    const pr = map.provinces[i];
    for (const nb of pr.neighbors) {
      if (done[nb] || !allied(s, c, s.provs[nb].ctrl)) continue;
      const d = bd + step(nb);
      if (d < dist[nb]) dist[nb] = d;
    }
    if (s.provs[i].port) for (const nb of pr.seaLinks) {
      if (done[nb] || s.provs[nb].ctrl !== c) continue;
      const d = bd + 1.5 * step(nb);
      if (d < dist[nb]) dist[nb] = d;
    }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = dist[i] <= RULES.supplyRange ? SUPPLY_FULL : dist[i] <= RULES.supplyRange * 2 ? SUPPLY_STRETCHED : SUPPLY_CUT;
  }
  return out;
}

/** Combat multiplier for a supply level. */
export function supplyCombat(level: number): number {
  return level === SUPPLY_FULL ? 1 : level === SUPPLY_STRETCHED ? RULES.stretchedCombat : RULES.unsuppliedCombat;
}

/** Provinces with any supply (not cut off). */
export function suppliedSet(map: GameMap, s: GameState, c: number): Uint8Array {
  return supplyLevels(map, s, c).map((l) => (l > SUPPLY_CUT ? 1 : 0));
}

/** Which provinces can country c see troop counts for (own, allied, adjacent, intel). */
export function visibleSet(map: GameMap, s: GameState, c: number): Uint8Array {
  const v = new Uint8Array(s.provs.length);
  if (!s.settings.fog || c < 0) return v.fill(1);
  s.provs.forEach((p, i) => {
    if (allied(s, c, p.ctrl)) {
      v[i] = 1;
      for (const n of map.provinces[i].neighbors) v[n] = 1;
    }
  });
  const intel = s.intel[c];
  if (intel && intel.turn === s.turn) s.provs.forEach((p, i) => { if (p.ctrl === intel.target) v[i] = 1; });
  return v;
}

export function defenseMultiplier(map: GameMap, s: GameState, i: number): number {
  const p = s.provs[i];
  let m = TERRAIN_INFO[map.provinces[i].terrain].defense;
  m *= 1 + RULES.fortPerLevel * p.fort;
  if (p.urban > 0) m *= 1 + 0.15 * p.urban;
  const c = s.countries[p.ctrl];
  if (c && c.capital === i) m *= RULES.capitalBonus;
  if (p.entrenched) m *= RULES.entrenchBonus;
  return m;
}

/** Edge cost for routing troops of country c from a to b. */
function stepCost(map: GameMap, s: GameState, a: number, b: number, sea: boolean): number {
  const pa = map.provinces[a], pb = map.provinces[b];
  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
  const sp = TERRAIN_INFO[pb.terrain].speed * (1 + 0.1 * s.provs[b].infra);
  return (d / sp) * (sea ? 2.5 : 1);
}

export interface PathOpts {
  /** Allow entering non-friendly provinces (attack). */
  attack: boolean;
  stroke?: Pt[];
}

/**
 * A* over the province graph. With a stroke, edges far from the drawn line
 * cost more so curved arrows choose the drawn route.
 */
export function findPath(map: GameMap, s: GameState, c: number, from: number, to: number, opts: PathOpts): number[] | null {
  if (from === to) return null;
  const P = map.provinces;
  const n = P.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const open = new Set<number>([from]);
  g[from] = 0;
  const h = (i: number) => Math.hypot(P[i].x - P[to].x, P[i].y - P[to].y) * 0.5;
  const fScore = new Float64Array(n).fill(Infinity);
  fScore[from] = h(from);
  while (open.size) {
    let cur = -1, bf = Infinity;
    for (const o of open) if (fScore[o] < bf) { bf = fScore[o]; cur = o; }
    if (cur === to) break;
    open.delete(cur);
    const curFriendly = cur === from || friendlyTo(s, c, cur);
    if (!curFriendly && cur !== to && !opts.attack) continue;
    const edges: [number, boolean][] = P[cur].neighbors.map((nb) => [nb, false]);
    if (s.provs[cur].port || (cur === from && s.provs[from].port)) for (const nb of P[cur].seaLinks) edges.push([nb, true]);
    for (const [nb, sea] of edges) {
      const fr = friendlyTo(s, c, nb);
      if (!fr && !opts.attack && nb !== to) continue;
      if (!fr && !atWar(s, c, s.provs[nb].ctrl) && nb !== to) continue;
      let cost = stepCost(map, s, cur, nb, sea);
      if (opts.stroke && opts.stroke.length > 1) {
        const mid = { x: (P[cur].x + P[nb].x) / 2, y: (P[cur].y + P[nb].y) / 2 };
        const dd = Math.min(distToPolyline(mid, opts.stroke), distToPolyline(P[nb], opts.stroke));
        cost *= 1 + (dd / 40) ** 2;
      }
      // fighting through enemy provinces is slower
      if (!fr) cost *= 1.6;
      const ng = g[cur] + cost;
      if (ng < g[nb]) {
        g[nb] = ng;
        prev[nb] = cur;
        fScore[nb] = ng + h(nb);
        open.add(nb);
      }
    }
  }
  if (prev[to] < 0) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}

export function isSeaStep(map: GameMap, a: number, b: number): boolean {
  return !map.provinces[a].neighbors.includes(b);
}

export interface Validation { ok: boolean; reason?: string }

/** Validate an order against the planning state (before resolution). */
export function validateOrder(map: GameMap, s: GameState, c: number, o: Order, pending: Order[] = []): Validation {
  const me = s.countries[c];
  const spend = pendingSpend(s, pending);
  switch (o.kind) {
    case 'serang':
    case 'gerak': {
      const src = s.provs[o.from];
      if (src.ctrl !== c) return { ok: false, reason: 'Bukan wilayahmu' };
      const us = o.units.map((id) => unitById(s, id));
      if (!us.length || us.some((u) => !u || u.owner !== c || u.prov !== o.from)) return { ok: false, reason: 'Pilih unit di provinsi ini' };
      if (pending.some((p) => (p.kind === 'serang' || p.kind === 'gerak') && p !== o && p.units.some((id) => o.units.includes(id))))
        return { ok: false, reason: 'Unit sudah punya perintah lain' };
      if (o.path.length < 2) return { ok: false, reason: 'Rute terlalu pendek' };
      if (o.kind === 'serang' && us.every((u) => u!.type === 'art') && o.path.some((b, i) => i > 0 && isSeaStep(map, o.path[i - 1], b)))
        return { ok: false, reason: 'Artileri tidak bisa mendarat sendiri' };
      for (let i = 1; i < o.path.length; i++) {
        const a = o.path[i - 1], b = o.path[i];
        if (isSeaStep(map, a, b)) {
          if (!map.provinces[a].seaLinks.includes(b)) return { ok: false, reason: 'Tidak bersebelahan' };
          if (!s.provs[a].port && a === o.from) return { ok: false, reason: 'Lewat laut butuh pelabuhan' };
          if (!s.provs[a].port && a !== o.from && !friendlyTo(s, c, a)) return { ok: false, reason: 'Lewat laut butuh pelabuhan' };
        }
        const ctrl = s.provs[b].ctrl;
        if (!allied(s, c, ctrl)) {
          if (o.kind === 'gerak') return { ok: false, reason: 'Gerak tidak bisa masuk wilayah lawan' };
          if (!atWar(s, c, ctrl) && !pending.some((p) => p.kind === 'deklarasi' && p.target === ctrl))
            return { ok: false, reason: `Belum perang dengan ${s.countries[ctrl].name}` };
        }
      }
      return { ok: true };
    }
    case 'bertahan':
      if (o.provs.length < 2) return { ok: false, reason: 'Garis terlalu pendek' };
      if (o.provs.some((p) => s.provs[p].ctrl !== c)) return { ok: false, reason: 'Garis harus di wilayahmu' };
      return { ok: true };
    case 'udara':
      if (me.treasury - spend < RULES.airCost) return { ok: false, reason: 'Kas tidak cukup' };
      return { ok: true };
    case 'bangun': {
      const p = s.provs[o.prov];
      const info = BUILD_INFO[o.what];
      const cost = o.what === 'jalan' ? info.cost * (o.path?.length ?? 1) : info.cost;
      if (p.owner !== c || p.ctrl !== c) return { ok: false, reason: 'Hanya di wilayah sendiri' };
      if (me.treasury - spend < cost) return { ok: false, reason: 'Kas tidak cukup' };
      if (o.what === 'pelabuhan' && (!map.provinces[o.prov].coastal || p.port)) return { ok: false, reason: 'Butuh pesisir tanpa pelabuhan' };
      if (o.what === 'benteng' && p.fort + p.queue.filter((q) => q.kind === 'benteng').length >= 3) return { ok: false, reason: 'Benteng maksimal' };
      if (p.queue.length >= 3) return { ok: false, reason: 'Antrean penuh' };
      return { ok: true };
    }
    case 'rekrut': {
      const p = s.provs[o.prov];
      if (p.owner !== c || p.ctrl !== c) return { ok: false, reason: 'Hanya di wilayah sendiri' };
      const info = UNIT_INFO[o.type];
      if (me.treasury - spend < info.cost) return { ok: false, reason: 'Kas tidak cukup' };
      const queued = pending.filter((x): x is Extract<Order, { kind: 'rekrut' }> => x.kind === 'rekrut' && x !== o)
        .reduce((a, x) => a + UNIT_INFO[x.type].maxStr, 0);
      if (totalTroops(s, c) + queued + info.maxStr > manpowerCap(s, c)) return { ok: false, reason: 'Tenaga kerja habis' };
      if (o.type === 'mar' && !map.provinces[o.prov].coastal) return { ok: false, reason: 'Marinir butuh provinsi pesisir' };
      if (o.type === 'arm' && !s.provs.some((q) => q.ctrl === c && q.milFactories > 0)) return { ok: false, reason: 'Butuh pabrik militer' };
      return { ok: true };
    }
    case 'hangus':
      return s.provs[o.prov].ctrl === c ? { ok: true } : { ok: false, reason: 'Hanya di wilayah sendiri' };
    case 'deklarasi': {
      const r = s.rel[c][o.target];
      if (r.status === 'perang') return { ok: false, reason: 'Sudah perang' };
      if (r.truce > 0) return { ok: false, reason: `Gencatan senjata (${r.truce} giliran)` };
      return { ok: true };
    }
    case 'usul':
      return { ok: true };
    case 'mata2':
      return me.treasury - spend >= RULES.spyCost ? { ok: true } : { ok: false, reason: 'Kas tidak cukup' };
    default:
      return { ok: true };
  }
}

export function orderCost(o: Order): number {
  switch (o.kind) {
    case 'udara': return RULES.airCost;
    case 'mata2': return RULES.spyCost;
    case 'rekrut': return UNIT_INFO[o.type].cost;
    case 'bangun': return BUILD_INFO[o.what].cost * (o.what === 'jalan' ? o.path?.length ?? 1 : 1);
    default: return 0;
  }
}

export function pendingSpend(_s: GameState, orders: Order[]): number {
  return orders.reduce((a, o) => a + orderCost(o), 0);
}

export const PROPOSAL_NAME: Record<ProposalKind, string> = {
  damai: 'Perjanjian damai', aliansi: 'Aliansi', nap: 'Pakta non-agresi', dagang: 'Perjanjian dagang',
};

/**
 * Planning-time estimate of attacker:defender strength for an attack order, including
 * other attacks this player has planned on the same target: pincer bonus, artillery,
 * armour terrain, organisation and marines. Returns null when the target is hidden by fog.
 */
export function attackOdds(
  map: GameMap, s: GameState, c: number, o: { from: number; path: number[]; units: number[] }, pending: Order[] = [],
): { target: number; ratio: number | null } | null {
  const target = o.path.find((p, i) => i > 0 && !allied(s, c, s.provs[p].ctrl));
  if (target === undefined) return null;
  if (!visibleSet(map, s, c)[target]) return { target, ratio: null };
  const sup = supplyLevels(map, s, c);
  const me = s.countries[c];
  const atk = [o, ...pending.filter((x): x is Extract<Order, { kind: 'serang' }> =>
    x.kind === 'serang' && x !== o && x.path.find((p, i) => i > 0 && !allied(s, c, s.provs[p].ctrl)) === target)];
  const seen = new Set<number>();
  const froms = new Set<number>();
  let a = 0;
  for (const x of atk) {
    const last = x.path[x.path.indexOf(target) - 1] ?? x.from;
    froms.add(last);
    const us = x.units.map((id) => unitById(s, id)).filter((u): u is Unit => !!u && !seen.has(u.id));
    us.forEach((u) => seen.add(u.id));
    a += columnAttack(map, s, us, target, isSeaStep(map, last, target)) * supplyCombat(sup[x.from]);
  }
  a *= me.quality * (froms.size >= 2 ? RULES.pincerBonus : 1) * artillerySupport(map, s, c, target);
  const tp = s.provs[target];
  const def = s.countries[tp.ctrl];
  const defUnits = unitsIn(s, target);
  const dRaw = defUnits.reduce((q, u) => q + u.str * unitDefense(map, s, u), 0);
  const d = Math.max(1, dRaw) * (def?.quality ?? 1) * defenseMultiplier(map, s, target) * artilleryDefense(defUnits);
  return { target, ratio: a / d };
}

/** Raw attack value of a set of units into `target` (marines cancel the amphibious penalty pro rata). */
export function columnAttack(map: GameMap, s: GameState, us: Unit[], target: number, amphibious: boolean): number {
  const tot = us.reduce((q, u) => q + u.str, 0);
  if (!tot) return 0;
  const marShare = us.filter((u) => u.type === 'mar').reduce((q, u) => q + u.str, 0) / tot;
  const amph = amphibious ? 1 - (1 - RULES.amphibPenalty) * (1 - marShare) : 1;
  return us.reduce((q, u) => q + u.str * unitAttack(map, s, u, target), 0) * amph;
}

/** Rough military strength near a border, used by AI and UI hints. */
export function localStrength(map: GameMap, s: GameState, c: number, around: number): number {
  let t = s.provs[around].ctrl === c ? s.provs[around].troops : 0;
  for (const n of map.provinces[around].neighbors) if (s.provs[n].ctrl === c) t += s.provs[n].troops;
  return t * s.countries[c].quality;
}
