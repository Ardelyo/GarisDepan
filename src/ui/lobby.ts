import type { MapShape, MapSize } from '../map/types';
import { COLOR_NAMES, PLAYER_COLORS, type PlayerSlot } from '../sim/setup';
import type { Difficulty, Settings, Tempo, Theme } from '../sim/types';
import { h } from './dom';

export interface LobbyConfig {
  shape: MapShape;
  size: MapSize;
  seedText: string;
  theme: Theme;
  players: PlayerSlot[];
  minors: number;
  settings: Settings;
  colorblind: boolean;
  lefty: boolean;
}

const KEY = 'garisdepan.lobby';

export function defaultConfig(): LobbyConfig {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
  if (saved && saved.players) return saved as LobbyConfig;
  return {
    shape: 'semenanjung',
    size: 'sedang',
    seedText: randomSeed(),
    theme: 'satelit',
    players: [
      { name: 'Pemain 1', kind: 'manusia', color: 0 },
      { name: 'Pemain 2', kind: 'manusia', color: 1 },
      { name: '', kind: 'ai', color: 2 },
    ],
    minors: 3,
    settings: {
      theme: 'satelit', tempo: 'santai', startAtWar: true, usePin: false, difficulty: 'perwira', fog: true,
      victory: { dominasi: true, ekonomi: true, skor: true, turnLimit: 200 },
    },
    colorblind: false,
    lefty: false,
  };
}

export function randomSeed(): string {
  const w = ['GARUDA', 'BADAI', 'FAJAR', 'SAMUDRA', 'BARA', 'TOPAN', 'ELANG', 'PETIR', 'KABUT', 'MERAPI', 'KARANG', 'SENJA'];
  return `${w[Math.floor(Math.random() * w.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

export interface LobbyCallbacks {
  onPreview(cfg: LobbyConfig): void;
  onStart(cfg: LobbyConfig): void;
  onContinue: (() => void) | null;
  onHelp(): void;
}

export function buildLobby(root: HTMLElement, cb: LobbyCallbacks): HTMLElement {
  const cfg = defaultConfig();
  const el = h('div', { id: 'lobby' });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } };
  let previewTimer = 0;
  const preview = () => {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => cb.onPreview(cfg), 120);
  };

  const seg = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void, refresh = false) => {
    const wrap = h('div', { class: 'seg' });
    const draw = () => {
      wrap.replaceChildren(...opts.map(([v, label]) =>
        h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); save(); draw(); if (refresh) preview(); } }, label)));
    };
    draw();
    return wrap;
  };
  const toggle = (get: () => boolean, set: (v: boolean) => void) => {
    const b = h('button', { class: 'toggle' + (get() ? ' on' : ''), 'aria-pressed': String(get()) });
    b.onclick = () => { set(!get()); b.classList.toggle('on', get()); save(); };
    return b;
  };
  const field = (label: string, ctl: HTMLElement, hint = '') =>
    h('div', { class: 'field' }, h('div', null, label, hint ? h('div', { class: 'muted', style: 'font-size:12px' }, hint) : null), ctl);

  const seedIn = h('input', { type: 'text', value: cfg.seedText, maxlength: 24 }) as HTMLInputElement;
  seedIn.oninput = () => { cfg.seedText = seedIn.value.toUpperCase(); save(); preview(); };
  const dice = h('button', { class: 'btn small', onclick: () => { cfg.seedText = randomSeed(); seedIn.value = cfg.seedText; save(); preview(); } }, '🎲');

  const playersBox = h('div');
  const drawPlayers = () => {
    playersBox.replaceChildren(...cfg.players.map((p, i) => {
      const sw = h('button', { class: 'swatch', style: `background:${PLAYER_COLORS[p.color]}`, title: COLOR_NAMES[p.color] });
      sw.onclick = () => {
        const used = new Set(cfg.players.map((q) => q.color));
        let c = p.color;
        for (let k = 0; k < 8; k++) { c = (c + 1) % 8; if (!used.has(c)) break; }
        p.color = c; save(); drawPlayers(); preview();
      };
      const name = h('input', { type: 'text', value: p.name, placeholder: p.kind === 'ai' ? 'Nama acak (AI)' : `Pemain ${i + 1}`, maxlength: 22 }) as HTMLInputElement;
      name.oninput = () => { p.name = name.value; save(); };
      const kind = h('button', { class: 'btn small' + (p.kind === 'manusia' ? ' on' : ''), onclick: () => { p.kind = p.kind === 'manusia' ? 'ai' : 'manusia'; save(); drawPlayers(); } }, p.kind === 'manusia' ? '👤 Manusia' : '🤖 AI');
      const del = h('button', { class: 'btn small', disabled: cfg.players.length <= 2, onclick: () => { cfg.players.splice(i, 1); save(); drawPlayers(); preview(); } }, '✕');
      return h('div', { class: 'prow' }, sw, name, kind, del);
    }));
    if (cfg.players.length < 8) {
      playersBox.append(h('button', {
        class: 'btn small', onclick: () => {
          const used = new Set(cfg.players.map((q) => q.color));
          const color = [0, 1, 2, 3, 4, 5, 6, 7].find((c) => !used.has(c)) ?? 0;
          cfg.players.push({ name: '', kind: 'ai', color });
          save(); drawPlayers(); preview();
        },
      }, '+ Tambah negara'));
    }
  };
  drawPlayers();

  const minorsOut = h('b', { class: 'num', style: 'font-size:20px;min-width:24px;text-align:center' }, String(cfg.minors));
  const minors = h('div', { class: 'row' },
    h('button', { class: 'btn small', onclick: () => { cfg.minors = Math.max(0, cfg.minors - 1); minorsOut.textContent = String(cfg.minors); save(); preview(); } }, '−'),
    minorsOut,
    h('button', { class: 'btn small', onclick: () => { cfg.minors = Math.min(6, cfg.minors + 1); minorsOut.textContent = String(cfg.minors); save(); preview(); } }, '+'));

  const turnIn = h('input', { type: 'number', value: String(cfg.settings.victory.turnLimit), min: 10, max: 500 }) as HTMLInputElement;
  turnIn.oninput = () => { cfg.settings.victory.turnLimit = Math.max(10, Math.min(500, Number(turnIn.value) || 200)); save(); };

  const wrap = h('div', { class: 'wrap' },
    h('div', { class: 'logo' },
      h('h1', null, 'GARIS ', h('em', null, 'DEPAN')),
      h('p', null, 'Gambar perintah langsung di peta. Semua bergerak bersamaan. Rahasia adalah senjata.')),
    h('div', { class: 'panel lob' },
      h('h3', null, 'Peta'),
      seg<MapShape>([['semenanjung', 'Semenanjung'], ['benua', 'Benua'], ['kepulauan', 'Kepulauan'], ['duaBenua', 'Dua Benua']], () => cfg.shape, (v) => (cfg.shape = v), true),
      h('div', { style: 'height:8px' }),
      seg<MapSize>([['kecil', 'Kecil ±55'], ['sedang', 'Sedang ±100'], ['besar', 'Besar ±170']], () => cfg.size, (v) => (cfg.size = v), true),
      field('Seed peta', h('div', { class: 'row' }, seedIn, dice), 'Bagikan seed agar grup main peta yang sama'),
      field('Tema visual', seg<Theme>([['satelit', '🛰 Satelit'], ['kartun', '🖍 Kartun']], () => cfg.theme, (v) => { cfg.theme = v; cfg.settings.theme = v; }, true))),
    h('div', { class: 'panel lob' }, h('h3', null, 'Negara (2–8)'), playersBox, field('Negara kecil netral', minors)),
    h('div', { class: 'panel lob' },
      h('h3', null, 'Aturan'),
      field('Tempo', seg<Tempo>([['santai', 'Santai'], ['komando', 'Komando 90d'], ['blitz', 'Blitz 45d']], () => cfg.settings.tempo, (v) => (cfg.settings.tempo = v))),
      field('Kesulitan AI', seg<Difficulty>([['rekrut', 'Rekrut'], ['perwira', 'Perwira'], ['jenderal', 'Jenderal']], () => cfg.settings.difficulty, (v) => (cfg.settings.difficulty = v))),
      field('Mulai dalam perang', toggle(() => cfg.settings.startAtWar, (v) => (cfg.settings.startAtWar = v)), 'Semua kekuatan besar saling berperang sejak awal'),
      field('Kabut perang', toggle(() => cfg.settings.fog, (v) => (cfg.settings.fog = v))),
      field('PIN per pemain', toggle(() => cfg.settings.usePin, (v) => (cfg.settings.usePin = v)), 'Untuk grup yang kompetitif'),
      field('Pola buta warna', toggle(() => cfg.colorblind, (v) => (cfg.colorblind = v))),
      field('Mode kidal', toggle(() => cfg.lefty, (v) => (cfg.lefty = v)))),
    h('div', { class: 'panel lob' },
      h('h3', null, 'Kondisi menang'),
      field('Dominasi', toggle(() => cfg.settings.victory.dominasi, (v) => (cfg.settings.victory.dominasi = v)), '60% populasi dunia atau semua ibu kota lawan'),
      field('Ekonomi', toggle(() => cfg.settings.victory.ekonomi, (v) => (cfg.settings.victory.ekonomi = v)), '40% PDB dunia selama 12 giliran'),
      field('Skor', toggle(() => cfg.settings.victory.skor, (v) => (cfg.settings.victory.skor = v)), 'Skor tertinggi saat batas giliran'),
      field('Batas giliran', turnIn)),
    h('div', { class: 'cta' },
      cb.onContinue ? h('button', { class: 'btn', onclick: cb.onContinue }, 'LANJUTKAN') : null,
      h('button', { class: 'btn', style: 'flex:0 0 64px', onclick: cb.onHelp }, '?'),
      h('button', { class: 'btn primary', onclick: () => { save(); cb.onStart(cfg); } }, 'MULAI')));
  el.append(wrap);
  root.append(el);
  cb.onPreview(cfg);
  return el;
}
