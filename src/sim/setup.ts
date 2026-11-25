import { Rng } from '../core/rng';
import type { GameMap } from '../map/types';
import { stackCap } from './rules';
import type {
  Country, CountryKind, FlagSpec, GameState, Personality, ProvState, Relation, Settings,
} from './types';

export const PLAYER_COLORS = [
  '#e3342f', '#2f62e3', '#f5b800', '#10a37f', '#8e44ad', '#f07818', '#22b8e8', '#e8439a',
];
export const COLOR_NAMES = ['Merah', 'Biru', 'Kuning', 'Hijau', 'Ungu', 'Oranye', 'Biru Muda', 'Magenta'];
const MINOR_COLORS = ['#9aa0a6', '#b8a98a', '#8fa58f', '#a99bb5', '#a7b4bf', '#c2a49a'];

const NAME_A = ['Arvena', 'Belkara', 'Cendravia', 'Dorasta', 'Elmaria', 'Fernhold', 'Galindra', 'Harvesk', 'Istrava',
  'Jorvania', 'Kalvenia', 'Lumeria', 'Morvath', 'Nordessa', 'Ostravia', 'Pelagora', 'Qasrin', 'Rivania', 'Solvara',
  'Tarvos', 'Umbria Baru', 'Valdoria', 'Westmark', 'Zentara'];
const NAME_PREFIX = ['Republik', 'Kerajaan', 'Federasi', 'Persatuan', 'Kesultanan', 'Konfederasi', 'Dominion', 'Negara'];

export interface PlayerSlot {
  name: string;
  kind: 'manusia' | 'ai';
  color: number; // index into PLAYER_COLORS
  pin?: string;
}

export function randomFlag(rng: Rng, main: string): FlagSpec {
  const pool = ['#ffffff', '#111111', '#f5c400', '#1b4fd8', '#d62828', '#0b8a3e', '#7b2cbf', '#f77f00', '#00a6d6'];
  const others = pool.filter((c) => c.toLowerCase() !== main.toLowerCase());
  rng.shuffle(others);
  const layouts: FlagSpec['layout'][] = ['triV', 'triH', 'biH', 'cross', 'canton', 'circle', 'diag', 'chevron'];
  const emblems: FlagSpec['emblem'][] = ['none', 'star', 'circle', 'stars3', 'none'];
  return { layout: rng.pick(layouts), colors: [main, others[0], others[1]], emblem: rng.pick(emblems) };
}

function makeCountry(id: number, name: string, color: string, kind: CountryKind, rng: Rng, pattern: number): Country {
  const personalities: Personality[] = ['netral', 'oportunis', 'agresif', 'pasifis'];
  return {
    id, name, color, pattern, kind,
    flag: randomFlag(rng, color),
    personality: kind === 'minor' ? rng.pick(['netral', 'pasifis', 'oportunis'] as Personality[]) : rng.pick(personalities),
    gov: rng.chance(0.5) ? 'demokrasi' : 'otoriter',
    capital: -1, homeCapital: -1, treasury: 300, stability: 65, weariness: 0, quality: 1, researchPts: 0,
    budget: { mil: 40, civ: 40, res: 20 },
    pin: null, alive: true, exiled: false, econStreak: 0, reputation: 0, casualties: 0, lastIncome: 0,
    pendingEvent: null,
  };
}

export function newGame(map: GameMap, slots: PlayerSlot[], minors: number, settings: Settings): GameState {
  const rng = new Rng(map.params.seed ^ 0x51ed27);
  const P = map.provinces;
  const nP = P.length;

  const usedNames = new Set<string>();
  const randName = () => {
    let n = '';
    for (let k = 0; k < 50; k++) {
      n = `${rng.pick(NAME_PREFIX)} ${rng.pick(NAME_A)}`;
      if (!usedNames.has(n.split(' ').slice(1).join(' '))) break;
    }
    usedNames.add(n.split(' ').slice(1).join(' '));
    return n;
  };

  const countries: Country[] = [];
  slots.forEach((s, i) => {
    const c = makeCountry(i, s.name.trim() || randName(), PLAYER_COLORS[s.color % 8], s.kind, rng, i);
    usedNames.add(c.name);
    c.pin = settings.usePin && s.pin ? s.pin : null;
    countries.push(c);
  });
  for (let k = 0; k < minors; k++) {
    countries.push(makeCountry(countries.length, randName(), MINOR_COLORS[k % MINOR_COLORS.length], 'minor', rng, 8 + k));
  }
  const nC = countries.length;

  // ---- capitals: farthest-point sampling on the largest landmasses, weighted by population ----
  const landSize = new Map<number, number>();
  for (const p of P) landSize.set(p.landmass, (landSize.get(p.landmass) ?? 0) + p.area);
  const cand = P.filter((p) => (landSize.get(p.landmass) ?? 0) > 2500 && p.terrain !== 'gunung');
  const caps: number[] = [];
  const first = cand.reduce((a, b) => (b.basePop > a.basePop ? b : a), cand[0]);
  // start from a random high-pop province for variety
  const sortedPop = cand.slice().sort((a, b) => b.basePop - a.basePop);
  caps.push(sortedPop[Math.floor(rng.next() * Math.min(10, sortedPop.length))]?.id ?? first.id);
  while (caps.length < nC) {
    let best = -1, bestScore = -1;
    for (const p of cand) {
      if (caps.includes(p.id)) continue;
      let md = Infinity;
      for (const c of caps) md = Math.min(md, Math.hypot(P[c].x - p.x, P[c].y - p.y));
      const score = md * (0.75 + 0.25 * Math.min(1, p.basePop / 3000));
      if (score > bestScore) { bestScore = score; best = p.id; }
    }
    if (best < 0) break;
    caps.push(best);
  }
  // players get the capitals that are most spread out (first ones), minors fill the rest
  countries.forEach((c, i) => (c.capital = c.homeCapital = caps[i % caps.length]));

  // ---- territory growth: balanced flood fill ----
  const owner = new Int32Array(nP).fill(-1);
  const popOf = new Float64Array(nC);
  const share = countries.map((c) => (c.kind === 'minor' ? 0.3 : 1));
  countries.forEach((c) => { owner[c.capital] = c.id; popOf[c.id] += P[c.capital].basePop; });
  let progress = true;
  while (progress) {
    progress = false;
    const order = countries.map((c) => c.id).sort((a, b) => popOf[a] / share[a] - popOf[b] / share[b]);
    for (const cid of order) {
      // frontier: unowned neighbours of owned provinces, closest to capital
      let best = -1, bd = Infinity;
      const cap = P[countries[cid].capital];
      for (let p = 0; p < nP; p++) {
        if (owner[p] !== cid) continue;
        for (const n of P[p].neighbors) {
          if (owner[n] >= 0) continue;
          const d = Math.hypot(P[n].x - cap.x, P[n].y - cap.y) * (0.85 + 0.3 * rng.next());
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best >= 0) {
        owner[best] = cid;
        popOf[cid] += P[best].basePop;
        progress = true;
        break; // re-sort after each grab → balanced
      }
    }
  }
  // unreachable provinces (other islands): nearest owned province by distance
  for (let p = 0; p < nP; p++) {
    if (owner[p] >= 0) continue;
    let best = -1, bd = Infinity;
    for (let q = 0; q < nP; q++) {
      if (owner[q] < 0) continue;
      const d = Math.hypot(P[q].x - P[p].x, P[q].y - P[p].y);
      if (d < bd) { bd = d; best = q; }
    }
    owner[p] = owner[best];
  }

  const provs: ProvState[] = P.map((p) => ({
    owner: owner[p.id], ctrl: owner[p.id], troops: 0, pop: p.basePop,
    fort: 0, infra: 1, factories: p.basePop > 2500 ? 1 : 0, milFactories: 0,
    port: false, urban: 0, integration: 1, queue: [], scorched: 0, entrenched: false,
  }));
  // capitals: big city, port if coastal, roads, factories
  countries.forEach((c) => {
    const ps = provs[c.capital];
    ps.urban = 2;
    ps.infra = 3;
    ps.factories += 2;
    ps.milFactories = 1;
    ps.pop = Math.round(ps.pop * 1.6);
    ps.fort = 1;
    if (P[c.capital].coastal) ps.port = true;
  });
  // a few more cities & ports per country
  for (let p = 0; p < nP; p++) {
    if (provs[p].urban === 0 && P[p].basePop > 3200) { provs[p].urban = 1; provs[p].infra = 2; }
    if (P[p].coastal && provs[p].urban > 0) provs[p].port = true;
  }

  // ---- initial troops ----
  for (const c of countries) {
    const mine = P.filter((p) => owner[p.id] === c.id);
    const pop = mine.reduce((s, p) => s + provs[p.id].pop, 0);
    const total = pop * 1000 * (c.kind === 'minor' ? 0.007 : 0.011);
    const weight = mine.map((p) => {
      const border = p.neighbors.some((n) => owner[n] !== c.id) ? 3 : 1;
      return border * (0.5 + provs[p.id].pop / 3000) + (p.id === c.capital ? 4 : 0);
    });
    const ws = weight.reduce((a, b) => a + b, 0);
    mine.forEach((p, i) => (provs[p.id].troops = Math.round((total * weight[i]) / ws / 100) * 100));
  }

  const rel: Relation[][] = Array.from({ length: nC }, (_, i) =>
    Array.from({ length: nC }, (_, j) => {
      const atWar = settings.startAtWar && i !== j && countries[i].kind !== 'minor' && countries[j].kind !== 'minor';
      return { status: atWar ? 'perang' : 'damai', value: atWar ? -50 : 0, truce: 0, trade: false } as Relation;
    }),
  );

  const state: GameState = {
    version: 1,
    map: map.params,
    turn: 1,
    startDate: '2027-03-01',
    countries,
    provs,
    rel,
    proposals: [],
    nextProposalId: 1,
    news: settings.startAtWar ? ['Perang pecah! Semua kekuatan besar saling menyatakan perang.'] : ['Dunia damai… untuk sekarang.'],
    privateNews: countries.map(() => []),
    settings,
    rng: rng.state,
    winner: null,
    intel: countries.map(() => null),
    lastOrders: countries.map(() => []),
    stats: [],
  };
  // starting garrisons: frontier provinces partly manned, interior thin, capital & cities full.
  // Leaves room to concentrate — a defended line is possible, a defended everywhere is not.
  for (const c of countries) {
    const mine = P.filter((p) => owner[p.id] === c.id).map((p) => p.id);
    for (const i of mine) {
      const cap = stackCap(map, state, i);
      const frontier = P[i].neighbors.some((n) => owner[n] !== c.id);
      const share = i === c.capital || provs[i].urban > 0 ? 1 : frontier ? 0.6 : 0.25;
      provs[i].troops = Math.min(provs[i].troops, Math.round((cap * share) / 100) * 100);
    }
  }
  return state;
}

export function dateOf(state: GameState, turn = state.turn): Date {
  const d = new Date(state.startDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (turn - 1) * 7);
  return d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
