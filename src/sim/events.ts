import type { Rng } from '../core/rng';
import type { GameMap } from '../map/types';
import type { GameState } from './types';
import { RULES, countryProvs } from './rules';

interface EventDef {
  id: string;
  title: string;
  text: (s: GameState, c: number) => string;
  cond: (map: GameMap, s: GameState, c: number) => boolean;
  weight: number;
  choices: { label: string; apply: (s: GameState, c: number, rng: Rng) => string }[];
}

const clampStab = (v: number) => Math.max(0, Math.min(100, v));

export const EVENTS: EventDef[] = [
  {
    id: 'pangan',
    title: 'Krisis Pangan',
    text: () => 'Gagal panen melanda beberapa provinsi. Harga beras melonjak dan antrean mengular.',
    cond: (map, s, c) => countryProvs(s, c).filter((p) => map.provinces[p].resource === 'pangan').length < 3,
    weight: 1,
    choices: [
      { label: 'Impor pangan (−80 kas, +6 stabilitas)', apply: (s, c) => { s.countries[c].treasury -= 80; s.countries[c].stability = clampStab(s.countries[c].stability + 6); return 'Pangan impor tiba.'; } },
      { label: 'Jatah ketat (−8 stabilitas)', apply: (s, c) => { s.countries[c].stability = clampStab(s.countries[c].stability - 8); return 'Rakyat menggerutu soal jatah.'; } },
    ],
  },
  {
    id: 'demo',
    title: 'Demo Besar',
    text: () => 'Ratusan ribu orang turun ke jalan menuntut perubahan.',
    cond: (_m, s, c) => s.countries[c].stability < 38,
    weight: 2,
    choices: [
      { label: 'Beri konsesi (−100 kas, +12 stabilitas)', apply: (s, c) => { s.countries[c].treasury -= 100; s.countries[c].stability = clampStab(s.countries[c].stability + 12); return 'Demonstran membubarkan diri.'; } },
      { label: 'Bubarkan paksa (+5 stabilitas, +10 kelelahan)', apply: (s, c) => { const k = s.countries[c]; k.stability = clampStab(k.stability + 5); k.weariness = Math.min(100, k.weariness + 10); k.reputation -= 10; return 'Jalanan sepi, tapi dendam membekas.'; } },
    ],
  },
  {
    id: 'riset',
    title: 'Terobosan Riset',
    text: () => 'Para ilmuwan melaporkan terobosan besar. Ke mana hasilnya diarahkan?',
    cond: (_m, s, c) => s.countries[c].budget.res >= 25,
    weight: 1,
    choices: [
      { label: 'Militer (+5% kualitas peralatan)', apply: (s, c) => { const k = s.countries[c]; if (k.quality >= RULES.qualityCap) return 'Peralatan sudah di batas teknologi saat ini.'; k.quality = Math.min(RULES.qualityCap, Math.round((k.quality + 0.05) * 100) / 100); return 'Peralatan baru dikirim ke garis depan.'; } },
      { label: 'Industri (+1 pabrik di ibu kota)', apply: (s, c) => { const k = s.countries[c]; if (k.capital >= 0) s.provs[k.capital].factories++; return 'Pabrik baru mulai berproduksi.'; } },
    ],
  },
  {
    id: 'bencana',
    title: 'Bencana Alam',
    text: () => 'Banjir besar merendam sebuah provinsi. Ribuan warga mengungsi.',
    cond: () => true,
    weight: 0.6,
    choices: [
      { label: 'Bantuan penuh (−120 kas, +6 stabilitas)', apply: (s, c) => { s.countries[c].treasury -= 120; s.countries[c].stability = clampStab(s.countries[c].stability + 6); return 'Bantuan menjangkau korban.'; } },
      { label: 'Serahkan ke daerah (−10 stabilitas)', apply: (s, c, rng) => { const ps = countryProvs(s, c); const p = ps[Math.floor(rng.next() * ps.length)]; if (p !== undefined) s.provs[p].pop = Math.round(s.provs[p].pop * 0.95); s.countries[c].stability = clampStab(s.countries[c].stability - 10); return 'Korban menumpuk; pemerintah dikritik.'; } },
    ],
  },
  {
    id: 'skandal',
    title: 'Skandal Kabinet',
    text: () => 'Media membongkar korupsi di kementerian pertahanan.',
    cond: (_m, s, c) => s.countries[c].gov === 'demokrasi',
    weight: 0.7,
    choices: [
      { label: 'Copot menteri (−5 stabilitas)', apply: (s, c) => { s.countries[c].stability = clampStab(s.countries[c].stability - 5); return 'Menteri mundur.'; } },
      { label: 'Tutupi (untung-untungan)', apply: (s, c, rng) => { if (rng.chance(0.5)) return 'Skandal mereda.'; s.countries[c].stability = clampStab(s.countries[c].stability - 15); return 'Penutupan bocor — kemarahan publik meledak!'; } },
    ],
  },
  {
    id: 'relawan',
    title: 'Gelombang Relawan',
    text: () => 'Semangat perang membara; pemuda berbondong-bondong mendaftar.',
    cond: (_m, s, c) => s.countries[c].weariness < 30 && s.rel[c].some((r) => r.status === 'perang'),
    weight: 1,
    choices: [
      { label: 'Terima (+15.000 pasukan di ibu kota)', apply: (s, c) => { const k = s.countries[c]; if (k.capital >= 0) s.provs[k.capital].troops += 15000; return 'Divisi relawan dibentuk.'; } },
      { label: 'Kirim ke pabrik (+40 kas)', apply: (s, c) => { s.countries[c].treasury += 40; return 'Produksi meningkat.'; } },
    ],
  },
];

export function rollEvent(map: GameMap, s: GameState, c: number, rng: Rng) {
  const ok = EVENTS.filter((e) => e.cond(map, s, c));
  const total = ok.reduce((a, e) => a + e.weight, 0);
  let r = rng.next() * total;
  for (const e of ok) {
    r -= e.weight;
    if (r <= 0) return { id: e.id, title: e.title, text: e.text(s, c), choices: e.choices.map((ch) => ch.label) };
  }
  return null;
}

export function applyEventChoice(s: GameState, c: number, choice: number, rng: Rng): string | null {
  const pe = s.countries[c].pendingEvent;
  if (!pe) return null;
  const def = EVENTS.find((e) => e.id === pe.id);
  s.countries[c].pendingEvent = null;
  if (!def) return null;
  const ch = def.choices[Math.max(0, Math.min(def.choices.length - 1, choice))];
  return `${pe.title}: ${ch.apply(s, c, rng)}`;
}
