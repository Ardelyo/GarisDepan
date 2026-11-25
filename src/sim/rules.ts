import type { GameMap } from '../map/types';
import { TERRAIN_INFO } from '../map/types';
import type { Pt } from '../core/geom';
import { distToPolyline } from '../core/geom';
import type { BuildKind, GameState, Order, ProposalKind } from './types';

/** Balancing constants — starting values, not real-world data. */
export const RULES = {
  daysPerTurn: 7,
  lanchesterK: 0.09,
  breakRatio: 2.0,
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
};

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
  for (const p of s.provs) if (p.ctrl === c) t += p.troops;
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

/** Provinces connected (through own/allied control) to the capital or a port city = supplied. */
export function suppliedSet(map: GameMap, s: GameState, c: number): Uint8Array {
  const n = s.provs.length;
  const sup = new Uint8Array(n);
  const q: number[] = [];
  const country = s.countries[c];
  const sources: number[] = [];
  if (country.capital >= 0 && s.provs[country.capital].ctrl === c) sources.push(country.capital);
  s.provs.forEach((p, i) => { if (p.ctrl === c && p.owner === c && p.urban > 0) sources.push(i); });
  for (const src of sources) if (!sup[src]) { sup[src] = 1; q.push(src); }
  while (q.length) {
    const i = q.pop()!;
    const pr = map.provinces[i];
    for (const nb of pr.neighbors) if (!sup[nb] && allied(s, c, s.provs[nb].ctrl)) { sup[nb] = 1; q.push(nb); }
    if (s.provs[i].port) for (const nb of pr.seaLinks) if (!sup[nb] && s.provs[nb].ctrl === c) { sup[nb] = 1; q.push(nb); }
  }
  return sup;
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
      if (src.troops < 100) return { ok: false, reason: 'Tidak ada pasukan' };
      if (o.path.length < 2) return { ok: false, reason: 'Rute terlalu pendek' };
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
      const cost = (o.amount / 1000) * RULES.recruitCostPer1000;
      if (me.treasury - spend < cost) return { ok: false, reason: 'Kas tidak cukup' };
      if (totalTroops(s, c) + o.amount > manpowerCap(s, c)) return { ok: false, reason: 'Tenaga kerja habis' };
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
    case 'rekrut': return (o.amount / 1000) * RULES.recruitCostPer1000;
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

/** Rough military strength near a border, used by AI and UI hints. */
export function localStrength(map: GameMap, s: GameState, c: number, around: number): number {
  let t = s.provs[around].ctrl === c ? s.provs[around].troops : 0;
  for (const n of map.provinces[around].neighbors) if (s.provs[n].ctrl === c) t += s.provs[n].troops;
  return t * s.countries[c].quality;
}
