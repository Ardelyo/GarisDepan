import type { Pt } from '../core/geom';
import type { MapParams } from '../map/types';

export type CountryKind = 'manusia' | 'ai' | 'minor';
export type Personality = 'netral' | 'oportunis' | 'agresif' | 'pasifis';
export type GovType = 'demokrasi' | 'otoriter';
export type Tempo = 'santai' | 'komando' | 'blitz';
export type Theme = 'satelit' | 'kartun';
export type Difficulty = 'rekrut' | 'perwira' | 'jenderal';

export interface FlagSpec {
  layout: 'triV' | 'triH' | 'biH' | 'cross' | 'canton' | 'circle' | 'diag' | 'chevron';
  colors: [string, string, string];
  emblem: 'none' | 'star' | 'circle' | 'stars3';
}

export interface Country {
  id: number;
  name: string;
  color: string;
  pattern: number;
  flag: FlagSpec;
  kind: CountryKind;
  personality: Personality;
  gov: GovType;
  capital: number;
  homeCapital: number;
  treasury: number;
  stability: number; // 0..100
  weariness: number; // 0..100
  quality: number; // equipment multiplier, starts 1
  researchPts: number;
  budget: { mil: number; civ: number; res: number }; // sums to 100
  pin: string | null;
  alive: boolean;
  exiled: boolean;
  econStreak: number;
  reputation: number; // -100..100, betrayals lower it
  casualties: number; // cumulative
  lastIncome: number;
  pendingEvent: GameEventInstance | null;
}

export type BuildKind = 'pabrik' | 'pabrikMil' | 'benteng' | 'pelabuhan' | 'kota' | 'jalan';

export interface BuildJob {
  kind: BuildKind;
  left: number;
}

export interface ProvState {
  owner: number;
  ctrl: number;
  troops: number;
  pop: number; // thousands
  fort: number; // 0..3
  infra: number; // 0..5
  factories: number;
  milFactories: number;
  port: boolean;
  urban: number; // city level 0..3
  integration: number; // 0..1 (1 = fully integrated)
  queue: BuildJob[];
  scorched: number; // turns left
  entrenched: boolean;
}

export type RelStatus = 'damai' | 'perang' | 'nap' | 'aliansi';
export interface Relation {
  status: RelStatus;
  value: number; // -100..100
  truce: number; // turns of truce left (cannot declare)
  trade: boolean;
}

export type ProposalKind = 'damai' | 'aliansi' | 'nap' | 'dagang';
export interface Proposal {
  id: number;
  from: number;
  to: number;
  kind: ProposalKind;
  pay: number; // per turn from proposer
  turn: number;
}

export type Frac = 0.25 | 0.5 | 1;

export type Order =
  | { kind: 'serang'; from: number; path: number[]; frac: Frac; stroke?: Pt[]; group?: number }
  | { kind: 'gerak'; from: number; path: number[]; frac: Frac; stroke?: Pt[] }
  | { kind: 'bertahan'; provs: number[]; stroke?: Pt[] }
  | { kind: 'udara'; x: number; y: number; r: number }
  | { kind: 'bangun'; prov: number; what: BuildKind; path?: number[] }
  | { kind: 'rekrut'; prov: number; amount: number }
  | { kind: 'hangus'; prov: number }
  | { kind: 'deklarasi'; target: number }
  | { kind: 'usul'; to: number; what: ProposalKind; pay: number }
  | { kind: 'jawab'; proposal: number; accept: boolean }
  | { kind: 'mata2'; target: number }
  | { kind: 'event'; choice: number };

export interface VictorySettings {
  dominasi: boolean;
  ekonomi: boolean;
  skor: boolean;
  turnLimit: number;
}

export interface Settings {
  theme: Theme;
  tempo: Tempo;
  victory: VictorySettings;
  startAtWar: boolean;
  usePin: boolean;
  difficulty: Difficulty;
  fog: boolean;
}

export interface GameEventInstance {
  id: string;
  title: string;
  text: string;
  choices: string[];
}

export interface Intel {
  target: number;
  turn: number;
  orders: Order[];
}

export interface GameState {
  version: 1;
  map: MapParams;
  turn: number;
  startDate: string; // ISO date
  countries: Country[];
  provs: ProvState[];
  rel: Relation[][];
  proposals: Proposal[];
  nextProposalId: number;
  news: string[]; // public announcements from last resolution
  privateNews: string[][]; // per country
  settings: Settings;
  rng: number;
  winner: { country: number; cond: string } | null;
  /** Spy reports available during next planning. */
  intel: (Intel | null)[];
  /** Last orders of each country (for intel). */
  lastOrders: Order[][];
  stats: { turn: number; gdp: number[]; troops: number[]; provs: number[] }[];
}

// ---------- resolution log (read by the director) ----------

export interface ColSnap {
  id: number;
  owner: number;
  path: number[];
  amphib: boolean[]; // per segment
  idx: number;
  prog: number;
  troops: number;
  fighting: boolean;
  kind: 'serang' | 'gerak' | 'mundur';
  gone?: boolean;
  /** The player's drawn arrow (world coords), shared by reference across frames. */
  stroke?: Pt[];
}

export type SimEvent =
  | { t: 'battle'; prov: number; x: number; y: number; atk: number[]; def: number; size: number; lossA: number; lossD: number; at: number }
  /** at = moment inside the day (0..1) — events are staggered, never all at once. how = why it fell. */
  | { t: 'capture'; prov: number; from: number; to: number; ex: number; ey: number; at: number; how: 'serbu' | 'lindas' | 'serap' }
  | { t: 'moment'; text: string; country: number; x: number; y: number; kind: 'dikepung' | 'ibukota' | 'gagal' | 'terobosan' | 'perang' | 'damai' }
  | { t: 'air'; owner: number; x: number; y: number; r: number }
  | { t: 'amphib'; owner: number; from: number; to: number }
  /** A marching army peels off a flank guard: `troops` stay in `prov`, facing the threat in `toward`. */
  | { t: 'detach'; owner: number; col: number; prov: number; toward: number; troops: number; at: number };

export interface TickFrame {
  day: number;
  cols: ColSnap[];
  troops: number[];
  ctrl: number[];
  events: SimEvent[];
}

export interface Resolution {
  frames: TickFrame[];
  casualties: number[]; // per country this turn
  captured: { prov: number; from: number; to: number }[];
}
