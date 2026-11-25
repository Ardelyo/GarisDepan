import { hashSeed } from './core/rng';
import { distToPolyline, pointAlong, simplify, type Pt } from './core/geom';
import { provinceName } from './core/names';
import { generateMap } from './map/mapgen';
import { RESOURCE_NAME, TERRAIN_INFO, type GameMap } from './map/types';
import { Renderer, fmtCompact, type DrawnOrder, type View } from './render/renderer';
import { Director, type DirectorFrame } from './render/director';
import { Recorder } from './render/record';
import { flagDataUrl } from './render/flags';
import { Input } from './input/input';
import { boundingCircle, pointInPoly, recognize } from './input/stroke';
import { Audio } from './audio/audio';
import { newGame, dateOf, fmtDate } from './sim/setup';
import {
  BUILD_INFO, PROPOSAL_NAME, RULES, SUPPLY_CUT, SUPPLY_FULL, atWar, allied, attackOdds, countryGdp, findPath,
  manpowerCap, pendingSpend, stackCap, supplyLevels, totalTroops, validateOrder, visibleSet,
} from './sim/rules';
import { planAI } from './sim/ai';
import { resolveTurn, fmtInt, scoreOf } from './sim/sim';
import type { BuildKind, Frac, GameState, Order, ProposalKind, Resolution } from './sim/types';
import { buildLobby, type LobbyConfig } from './ui/lobby';
import { h, svg, ICONS } from './ui/dom';

type Tool = 'panah' | 'gerak' | 'garis' | 'udara' | 'bangun' | 'hangus';
type Phase = 'lobby' | 'curtain' | 'plan' | 'resolve' | 'report' | 'over';
type Tab = 'provinsi' | 'negara' | 'diplomasi' | 'laporan';

const SAVE_KEY = 'garisdepan.save';
const TOOLS: [Tool, string, string][] = [
  ['panah', 'Serang', '1'], ['gerak', 'Gerak', '2'], ['garis', 'Garis', '3'],
  ['udara', 'Udara', '4'], ['bangun', 'Bangun', '5'], ['hangus', 'Hangus', '6'],
];

export class Game {
  map!: GameMap;
  r!: Renderer;
  dir!: Director;
  input!: Input;
  audio = new Audio();
  rec: Recorder | null = null;
  state!: GameState;
  prevState: GameState | null = null;
  res: Resolution | null = null;
  phase: Phase = 'lobby';
  current = -1;
  queue: number[] = [];
  orders: Order[][] = [];
  undoStack: Order[][] = [];
  redoStack: Order[][] = [];
  tool: Tool = 'panah';
  frac: Frac = 0.5;
  tab: Tab = 'provinsi';
  sheetOpen = false;
  selectedProv = -1;
  selectedOrder = -1;
  draft: Pt[] | null = null;
  timerEnd = 0;
  colorblind = false;
  lastFrame: DirectorFrame | null = null;
  validity: DrawnOrder[] = [];
  previewState: GameState | null = null;
  private lastT = performance.now();
  private nextAmbient = 0;
  private lastCam = { x: 0, y: 0 };
  private ui: HTMLElement;
  private canvas: HTMLCanvasElement;
  private els: Record<string, HTMLElement> = {};
  private toastTimer = 0;

  constructor() {
    this.ui = document.getElementById('ui')!;
    this.canvas = document.getElementById('map') as HTMLCanvasElement;
    window.addEventListener('resize', () => this.r?.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    this.showLobby();
    requestAnimationFrame(this.loop);
  }

  // =====================================================================
  // setup
  // =====================================================================
  private setMap(map: GameMap, theme: GameState['settings']['theme']) {
    this.map = map;
    this.r = new Renderer(this.canvas, map);
    this.r.resize();
    this.r.setTheme(theme);
    this.r.fitAll();
    this.dir = new Director(this.r, map);
    this.dir.onMoment = (t, c, k) => this.moment(t, c, k);
    this.dir.onDay = () => this.updateStamp(true);
    this.dir.onSound = (k, i) => {
      if (k === 'boom') { if (Math.random() < 0.5) this.audio.boom(i); }
      else if (k === 'plane') this.audio.plane();
      else this.audio.sting(k === 'capture' ? 'capture' : 'moment');
    };
    this.input = new Input(this.canvas, this.r, {
      strokeStart: (x, y) => this.strokeStart(x, y),
      strokeMove: (x, y) => this.strokeMove(x, y),
      strokeEnd: (pts) => this.strokeEnd(pts),
      strokeCancel: () => { this.draft = null; this.audio.stopScribble(); },
      tap: (x, y) => this.tap(x, y),
      longPress: (x, y) => this.longPress(x, y),
      wheelDuringStroke: (d) => { this.frac = d > 0 ? (this.frac === 1 ? 0.5 : 0.25) : this.frac === 0.25 ? 0.5 : 1; this.toast(`Kekuatan panah: ${this.frac * 100}%`); },
      threeFingerSwipe: (d) => (d < 0 ? this.undo() : this.redo()),
      onCameraMove: () => this.hideFloating(),
    });
  }

  private showLobby() {
    this.phase = 'lobby';
    this.ui.replaceChildren();
    const hasSave = (() => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } })();
    buildLobby(this.ui, {
      onPreview: (cfg) => this.preview(cfg),
      onStart: (cfg) => this.start(cfg),
      onContinue: hasSave ? () => this.loadSave() : null,
      onHelp: () => this.help(),
    });
  }

  private preview(cfg: LobbyConfig) {
    const map = generateMap({ seed: hashSeed(cfg.seedText || 'GARIS'), shape: cfg.shape, size: cfg.size });
    this.setMap(map, cfg.theme);
    this.previewState = newGame(map, cfg.players, cfg.minors, { ...cfg.settings, theme: cfg.theme });
    this.r.fitAll();
  }

  private start(cfg: LobbyConfig) {
    this.audio.unlock();
    const map = generateMap({ seed: hashSeed(cfg.seedText || 'GARIS'), shape: cfg.shape, size: cfg.size });
    this.setMap(map, cfg.theme);
    this.state = newGame(map, cfg.players, cfg.minors, { ...cfg.settings, theme: cfg.theme });
    this.colorblind = cfg.colorblind;
    document.body.classList.toggle('lefty', cfg.lefty);
    this.buildHud();
    this.startTurn();
  }

  private loadSave() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY)!);
      const s = data.state as GameState;
      const map = generateMap(s.map);
      this.setMap(map, s.settings.theme);
      this.state = s;
      this.colorblind = !!data.colorblind;
      document.body.classList.toggle('lefty', !!data.lefty);
      this.buildHud();
      this.startTurn();
    } catch (e) {
      console.error(e);
      this.toast('Simpanan rusak — mulai permainan baru.');
    }
  }

  private save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state: this.state, colorblind: this.colorblind, lefty: document.body.classList.contains('lefty') }));
    } catch { /* storage full or blocked */ }
  }

  // =====================================================================
  // HUD
  // =====================================================================
  private buildHud() {
    this.ui.replaceChildren();
    const e = this.els;
    e.topbar = h('div', { id: 'topbar', class: 'panel' });
    e.dock = h('div', { id: 'dock', class: 'panel' });
    e.sheet = h('div', { id: 'sheet', class: 'panel collapsed' });
    e.playbar = h('div', { id: 'playbar', class: 'panel hidden' });
    e.stamp = h('div', { id: 'stamp', class: 'hidden' });
    e.tally = h('div', { id: 'tally', class: 'hidden' });
    e.moment = h('div', { id: 'moment' });
    e.toast = h('div', { id: 'toast', class: 'panel', style: 'opacity:0' });
    e.fracbar = h('div', { id: 'fracbar', class: 'panel hidden' });
    e.buildmenu = h('div', { id: 'buildmenu', class: 'panel hidden' });
    e.overlay = h('div', { id: 'overlay' });
    e.sheetToggle = h('button', { id: 'sheetToggle', class: 'panel hidden', onclick: () => { this.sheetOpen = true; this.renderSheet(); } }, '◂ Info');
    this.ui.append(e.stamp, e.tally, e.moment, e.topbar, e.sheet, e.sheetToggle, e.dock, e.playbar, e.fracbar, e.buildmenu, e.toast, e.overlay);

    // dock
    const tools = h('div', { class: 'tools' }, TOOLS.map(([t, label, key]) =>
      h('button', { class: 'tool', 'data-tool': t, title: `${label} (${key})`, onclick: () => this.setTool(t) }, svg(ICONS[t]), label)));
    e.dock.append(
      tools,
      h('div', { class: 'sep' }),
      h('button', { class: 'tool', title: 'Batal (Ctrl+Z)', onclick: () => this.undo() }, svg(ICONS.undo), 'Batal'),
      h('button', { class: 'tool hide-sm', title: 'Ulang (Ctrl+Y)', onclick: () => this.redo() }, svg(ICONS.redo), 'Ulang'),
      h('button', { class: 'done', onclick: () => this.finishPlan() }, 'SELESAI'));
    this.setTool('panah');

    // playbar
    const pb = e.playbar;
    const playBtn = h('button', { class: 'btn', title: 'Jeda (Spasi)', onclick: () => { this.dir.paused = !this.dir.paused; this.updatePlaybar(); } });
    const speedBtn = h('button', { class: 'btn num', title: 'Kecepatan', onclick: () => { this.dir.speed = this.dir.speed >= 4 ? 1 : this.dir.speed * 2; this.updatePlaybar(); } });
    const camBtn = h('button', { class: 'btn', title: 'Kamera sutradara', onclick: () => { this.dir.autoCam = !this.dir.autoCam; this.updatePlaybar(); } }, svg(ICONS.cam));
    const recBtn = h('button', { class: 'btn', title: 'Rekam Resolusi (video 9:16)', onclick: () => this.toggleRecord() }, svg(ICONS.rec));
    pb.append(
      h('button', { class: 'btn', title: 'Putar ulang', onclick: () => this.dir.restart(performance.now()) }, svg(ICONS.replay)),
      playBtn, speedBtn, camBtn, recBtn,
      h('button', { class: 'btn', title: 'Lewati', onclick: () => this.dir.skip() }, svg(ICONS.skip)));
    e.playBtn = playBtn; e.speedBtn = speedBtn; e.camBtn = camBtn; e.recBtn = recBtn;
    if (!Recorder.supported()) recBtn.classList.add('hidden');
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.els.dock?.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tool === t));
    this.hideFloating();
    const hints: Record<Tool, string> = {
      panah: 'Tarik dari pasukanmu ke target. Lingkari wilayah musuh untuk operasi jepit.',
      gerak: 'Tarik untuk memindahkan pasukan tanpa menyerang.',
      garis: 'Gores di sepanjang perbatasanmu untuk garis pertahanan.',
      udara: 'Lingkari area untuk misi udara (−40 kas).',
      bangun: 'Ketuk provinsimu untuk membangun; gores garis untuk jalan/rel.',
      hangus: 'Ketuk provinsimu untuk bumi hangus.',
    };
    if (this.phase === 'plan') this.toast(hints[t], 2200);
  }

  private updateTopbar() {
    const tb = this.els.topbar;
    if (!tb || this.phase !== 'plan') return;
    const k = this.state.countries[this.current];
    const spend = pendingSpend(this.state, this.orders[this.current]);
    const date = fmtDate(dateOf(this.state));
    const troops = totalTroops(this.state, this.current);
    tb.replaceChildren(
      h('div', { class: 'who' }, h('img', { class: 'flag', src: flagDataUrl(k.flag), alt: '' }), h('b', null, k.name)),
      h('div', { class: 'date hide-sm' }, date),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('small', null, 'Kas'), h('span', { style: k.treasury - spend < 0 ? 'color:#ff6b5e' : '' }, fmtInt(k.treasury - spend))),
        h('div', { class: 'stat' }, h('small', null, 'Pasukan'), h('span', null, fmtCompact(troops))),
        h('div', { class: 'stat hide-sm' }, h('small', null, 'Stabilitas'), h('span', null, Math.round(k.stability) + '%')),
        this.timerEnd ? h('div', { id: 'timer' }) : null,
        h('button', { class: 'btn small', title: 'Menu', onclick: () => this.menu() }, svg(ICONS.menu))));
    document.documentElement.style.setProperty('--pc', k.color);
  }

  private updatePlaybar() {
    const e = this.els;
    e.playBtn.replaceChildren(svg(this.dir.paused ? ICONS.play : ICONS.pause));
    e.speedBtn.textContent = `${this.dir.speed}×`;
    e.camBtn.classList.toggle('on', this.dir.autoCam);
    e.recBtn.classList.toggle('danger', !!this.rec?.active);
  }

  private updateStamp(flip = false) {
    const st = this.els.stamp;
    if (!st || !this.prevState) return;
    const day = this.lastFrame?.day ?? 0;
    const d = dateOf(this.prevState);
    d.setUTCDate(d.getUTCDate() + Math.min(6, day));
    st.replaceChildren(fmtDate(d), h('small', null, `GILIRAN ${this.prevState.turn} · HARI ${Math.min(7, day + 1)}/7`));
    if (flip) { st.classList.remove('flip'); void st.offsetWidth; st.classList.add('flip'); st.classList.toggle('ital'); }
  }

  toast(msg: string, ms = 1800) {
    const t = this.els.toast;
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.style.opacity = '0'), ms);
  }

  private moment(text: string, color: string, _kind: string) {
    const m = this.els.moment;
    if (!m) return;
    m.textContent = text;
    m.style.color = color;
    m.classList.remove('show');
    void m.offsetWidth;
    m.classList.add('show');
  }

  private hideFloating() {
    this.els.fracbar?.classList.add('hidden');
    this.els.buildmenu?.classList.add('hidden');
  }

  private modal(content: HTMLElement[], opts: { onClose?: () => void; dismiss?: boolean } = {}) {
    const bg = h('div', { class: 'modal-bg' });
    const box = h('div', { class: 'panel modal' }, ...content);
    bg.append(box);
    if (opts.dismiss !== false) bg.addEventListener('click', (e) => { if (e.target === bg) { bg.remove(); opts.onClose?.(); } });
    this.ui.append(bg);
    return bg;
  }

  // =====================================================================
  // turn flow
  // =====================================================================
  private humans(): number[] {
    return this.state.countries.filter((c) => c.kind === 'manusia' && c.alive).map((c) => c.id);
  }

  private startTurn() {
    this.save();
    this.orders = this.state.countries.map(() => []);
    const hs = this.humans();
    for (let i = hs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [hs[i], hs[j]] = [hs[j], hs[i]]; }
    this.queue = hs;
    this.els.playbar.classList.add('hidden');
    this.els.stamp.classList.add('hidden');
    this.els.tally.classList.add('hidden');
    if (!hs.length) {
      // spectator / sandbox: AI only
      this.resolve();
      return;
    }
    this.nextPlanner();
  }

  private nextPlanner() {
    this.selectedProv = -1;
    this.selectedOrder = -1;
    this.hideFloating();
    if (!this.queue.length) { this.resolve(); return; }
    this.current = this.queue.shift()!;
    const many = this.humans().length > 1;
    if (many || this.state.settings.usePin) this.curtain();
    else this.beginPlan();
  }

  private curtain() {
    this.phase = 'curtain';
    this.els.topbar.classList.add('hidden');
    this.els.dock.classList.add('hidden');
    this.els.sheet.classList.add('hidden');
    this.els.sheetToggle.classList.add('hidden');
    const k = this.state.countries[this.current];
    this.audio.sting('curtain');
    const ring = 2 * Math.PI * 60;
    const prog = h('div');
    prog.innerHTML = `<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="60" stroke="rgba(255,255,255,.15)"/><circle class="p" cx="66" cy="66" r="60" stroke="${k.color}" stroke-dasharray="${ring}" stroke-dashoffset="${ring}"/></svg>`;
    const hold = h('button', { class: 'hold' }, prog.firstElementChild as Element, h('span', { style: 'position:relative' }, 'TAHAN', h('br'), 'UNTUK BUKA'));
    const circle = hold.querySelector('circle.p') as SVGCircleElement;
    let t0 = 0, raf = 0;
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / 1000);
      circle.setAttribute('stroke-dashoffset', String(ring * (1 - f)));
      if (f >= 1) { cancelAnimationFrame(raf); unlock(); return; }
      raf = requestAnimationFrame(tick);
    };
    const reset = () => { cancelAnimationFrame(raf); circle.setAttribute('stroke-dashoffset', String(ring)); };
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); hold.setPointerCapture(e.pointerId); t0 = performance.now(); tick(); });
    hold.addEventListener('pointerup', reset);
    hold.addEventListener('pointercancel', reset);
    const cur = h('div', { id: 'curtain' },
      h('div', { class: 'handoff' }, 'Serahkan perangkat ke'),
      h('img', { class: 'flag lg', src: flagDataUrl(k.flag, 96, 64), alt: '' }),
      h('h1', { style: `color:${k.color}` }, k.name),
      h('div', { class: 'muted' }, `${fmtDate(dateOf(this.state))} · Giliran ${this.state.turn}`),
      hold);
    const unlock = () => {
      if (this.state.settings.usePin) this.pinPad(cur, k.pin, (pin) => { if (!k.pin) k.pin = pin; cur.remove(); this.beginPlan(); });
      else { cur.remove(); this.beginPlan(); }
    };
    this.ui.append(cur);
  }

  private pinPad(host: HTMLElement, pin: string | null, ok: (pin: string) => void) {
    let entry = '';
    const dots = h('div', { class: 'pindots' });
    const title = h('div', { class: 'handoff' }, pin ? 'Masukkan PIN' : 'Buat PIN 4 digit');
    const draw = () => dots.replaceChildren(...[0, 1, 2, 3].map((i) => h('i', { class: i < entry.length ? 'f' : '' })));
    draw();
    const press = (d: string) => {
      if (d === '⌫') entry = entry.slice(0, -1);
      else if (entry.length < 4) entry += d;
      draw();
      if (entry.length === 4) {
        if (!pin || entry === pin) ok(entry);
        else { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); entry = ''; setTimeout(draw, 300); }
      }
    };
    const pad = h('div', { class: 'pinpad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) =>
      d ? h('button', { onclick: () => press(d) }, d) : h('span')));
    host.querySelector('.hold')?.remove();
    host.append(title, dots, pad);
  }

  private beginPlan() {
    this.phase = 'plan';
    this.undoStack = [];
    this.redoStack = [];
    this.els.topbar.classList.remove('hidden');
    this.els.dock.classList.remove('hidden');
    this.els.sheet.classList.remove('hidden');
    const k = this.state.countries[this.current];
    if (k.capital >= 0) {
      const p = this.map.provinces[k.capital];
      const fit = Math.min(this.r.W / this.map.w, this.r.H / this.map.h);
      this.r.cam = { x: p.x, y: p.y, zoom: Math.max(fit * 1.6, 0.6) };
      this.r.clampCam();
    }
    const tempo = this.state.settings.tempo;
    this.timerEnd = tempo === 'santai' ? 0 : performance.now() + (tempo === 'komando' ? 90 : 45) * 1000;
    this.revalidate();
    this.updateTopbar();
    const inbox = this.state.proposals.filter((p) => p.to === this.current).length;
    const priv = this.state.privateNews[this.current] ?? [];
    if (this.state.turn > 1 || inbox || k.pendingEvent) {
      this.tab = k.pendingEvent || inbox ? (k.pendingEvent ? 'laporan' : 'diplomasi') : 'laporan';
      this.sheetOpen = !!(k.pendingEvent || inbox) || priv.length > 0;
    } else {
      this.tab = 'negara';
      this.sheetOpen = false;
      this.toast('Tarik panah dari angka pasukanmu ke wilayah musuh. Tekan SELESAI bila siap.', 4200);
    }
    this.renderSheet();
  }

  finishPlan() {
    if (this.phase !== 'plan') return;
    const k = this.state.countries[this.current];
    if (k.pendingEvent && !this.orders[this.current].some((o) => o.kind === 'event')) {
      this.orders[this.current].push({ kind: 'event', choice: 0 });
    }
    // drop invalid orders silently (they're shown red during planning)
    this.orders[this.current] = this.orders[this.current].filter((_, i) => this.validity[i]?.valid !== false);
    this.timerEnd = 0;
    this.audio.sting('click');
    this.nextPlanner();
  }

  private resolve() {
    const s = this.state;
    for (const k of s.countries) if (k.kind !== 'manusia' && k.alive) this.orders[k.id] = planAI(this.map, s, k.id);
    const { state, res } = resolveTurn(this.map, s, this.orders);
    this.prevState = s;
    this.state = state;
    this.res = res;
    this.phase = 'resolve';
    this.selectedProv = -1;
    this.els.topbar.classList.add('hidden');
    this.els.dock.classList.add('hidden');
    this.els.sheet.classList.add('hidden');
    this.els.sheetToggle.classList.add('hidden');
    this.els.playbar.classList.remove('hidden');
    this.els.stamp.classList.remove('hidden');
    this.els.tally.classList.remove('hidden');
    this.r.fitAll();
    this.dir.start(s, res, performance.now());
    this.updatePlaybar();
    this.updateStamp(true);
  }

  private afterResolution() {
    if (this.rec?.active) void this.stopRecord();
    this.phase = 'report';
    const s = this.state;
    const prev = this.prevState!;
    const majors = s.countries.filter((k) => k.kind !== 'minor');
    const cards: HTMLElement[] = [];
    cards.push(h('div', { class: 'card' },
      h('h3', null, 'Berita Dunia'),
      s.news.length ? s.news.map((n) => h('div', { class: 'news' }, n)) : h('div', { class: 'muted' }, 'Minggu yang tenang.')));
    cards.push(h('div', { class: 'card' },
      h('h3', null, 'Peta Politik'),
      majors.map((k) => {
        const now = s.provs.filter((p) => p.ctrl === k.id).length;
        const before = prev.provs.filter((p) => p.ctrl === k.id).length;
        const d = now - before;
        return h('div', { class: 'cty' },
          h('img', { class: 'flag', src: flagDataUrl(k.flag), alt: '' }),
          h('div', { class: 'nm', style: k.alive ? '' : 'text-decoration:line-through;opacity:.5' }, k.name),
          h('b', { class: 'num', style: 'font-size:20px' }, `${now} prov`),
          d ? h('span', { class: 'chip ' + (d > 0 ? 'ally' : 'war') }, (d > 0 ? '+' : '') + d) : null);
      })));
    const bg = this.modal([
      h('h2', null, `Laporan Minggu ${prev.turn}`),
      h('div', { class: 'muted', style: 'margin-bottom:10px' }, fmtDate(dateOf(prev)) + ' → ' + fmtDate(dateOf(s))),
      h('div', { class: 'cards' }, cards),
      h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' },
        h('button', { class: 'btn', onclick: () => { this.dir.restart(performance.now()); this.phase = 'resolve'; bg.remove(); this.els.playbar.classList.remove('hidden'); } }, 'Putar ulang'),
        h('button', { class: 'btn primary', onclick: () => { bg.remove(); s.winner ? this.victory() : this.startTurn(); } }, s.winner ? 'Lihat pemenang' : 'Lanjut ▸')),
    ], { dismiss: false });
    this.els.playbar.classList.add('hidden');
  }

  private victory() {
    this.phase = 'over';
    this.save();
    const w = this.state.winner!;
    const k = this.state.countries[w.country];
    const gdps = this.state.countries.map((_, c) => countryGdp(this.state, c));
    const ranking = this.state.countries.filter((c) => c.kind !== 'minor').sort((a, b) => scoreOf(this.state, b.id, gdps[b.id]) - scoreOf(this.state, a.id, gdps[a.id]));
    this.moment('MENANG!', k.color, 'terobosan');
    this.audio.sting('moment');
    this.modal([
      h('div', { style: 'text-align:center' },
        h('img', { class: 'flag lg', src: flagDataUrl(k.flag, 96, 64), alt: '' }),
        h('h2', { style: `color:${k.color};margin-top:10px` }, k.name),
        h('div', { class: 'big' }, 'MENANG'),
        h('p', { class: 'muted' }, w.cond)),
      h('div', { class: 'sec' }, 'Peringkat'),
      ...ranking.map((c, i) => h('div', { class: 'cty' }, h('b', { class: 'num' }, `#${i + 1}`), h('img', { class: 'flag', src: flagDataUrl(c.flag), alt: '' }), h('div', { class: 'nm' }, c.name), h('b', { class: 'num' }, String(scoreOf(this.state, c.id, gdps[c.id]))))),
      h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' },
        h('button', { class: 'btn', onclick: () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* */ } this.showLobby(); } }, 'Ke Lobi'),
        h('button', { class: 'btn primary', onclick: (e: Event) => { (e.target as HTMLElement).closest('.modal-bg')?.remove(); this.state.winner = null; this.state.settings.victory.skor = false; this.state.settings.victory.dominasi = false; this.state.settings.victory.ekonomi = false; this.startTurn(); } }, 'Main terus (sandbox)')),
    ], { dismiss: false });
  }

  // =====================================================================
  // orders
  // =====================================================================
  private myOrders(): Order[] {
    return this.orders[this.current];
  }

  private pushUndo() {
    this.undoStack.push(this.myOrders().map((o) => ({ ...o })));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private addOrder(o: Order) {
    this.pushUndo();
    this.myOrders().push(o);
    this.afterOrdersChanged();
    return this.myOrders().length - 1;
  }

  private afterOrdersChanged() {
    this.revalidate();
    this.updateTopbar();
    this.renderSheet();
  }

  undo() {
    if (this.phase !== 'plan' || !this.undoStack.length) return;
    this.redoStack.push(this.myOrders());
    this.orders[this.current] = this.undoStack.pop()!;
    this.selectedOrder = -1;
    this.hideFloating();
    this.afterOrdersChanged();
    this.toast('Dibatalkan');
  }
  redo() {
    if (this.phase !== 'plan' || !this.redoStack.length) return;
    this.undoStack.push(this.myOrders());
    this.orders[this.current] = this.redoStack.pop()!;
    this.afterOrdersChanged();
    this.toast('Diulang');
  }

  private deleteOrder(i: number) {
    this.pushUndo();
    this.myOrders().splice(i, 1);
    this.selectedOrder = -1;
    this.hideFloating();
    this.afterOrdersChanged();
  }

  private revalidate() {
    const list = this.myOrders() ?? [];
    this.validity = list.map((o, i) => {
      const v = validateOrder(this.map, this.state, this.current, o, list.slice(0, i).concat(list.filter((x) => x.kind === 'deklarasi')));
      const odds = o.kind === 'serang' && v.ok ? attackOdds(this.map, this.state, this.current, o, list)?.ratio : undefined;
      return { order: o, valid: v.ok, reason: v.reason, odds };
    });
  }

  // =====================================================================
  // drawing
  // =====================================================================
  private own(p: number) {
    return p >= 0 && this.state.provs[p].ctrl === this.current;
  }

  private strokeStart(sx: number, sy: number): boolean {
    if (this.phase !== 'plan') return false;
    const w = this.r.screenToWorld(sx, sy);
    const p = this.r.provinceAt(w.x, w.y);
    this.hideFloating();
    let ok = false;
    switch (this.tool) {
      case 'panah': ok = p >= 0 && (this.own(p) ? this.state.provs[p].troops >= 100 : true); break;
      case 'gerak': ok = this.own(p) && this.state.provs[p].troops >= 100; break;
      case 'garis': case 'bangun': ok = this.own(p); break;
      case 'udara': ok = p >= 0; break;
      default: ok = false;
    }
    if (ok) {
      this.draft = [w];
      this.audio.startScribble();
    }
    return ok;
  }

  private strokeMove(sx: number, sy: number) {
    if (!this.draft) return;
    const w = this.r.screenToWorld(sx, sy);
    const last = this.draft[this.draft.length - 1];
    this.audio.scribbleSpeed(Math.hypot(w.x - last.x, w.y - last.y) * this.r.cam.zoom);
    this.draft.push(w);
  }

  private strokeEnd(raw: Pt[]) {
    this.audio.stopScribble();
    const draft = this.draft;
    this.draft = null;
    if (!draft || this.phase !== 'plan') return;
    const rec = recognize(draft.length > raw.length ? draft : raw, this.r.cam.zoom);
    const sp = this.r.provinceAt(rec.start.x, rec.start.y);
    const ep = this.r.provinceAt(rec.end.x, rec.end.y);
    const s = this.state;
    const c = this.current;
    switch (this.tool) {
      case 'panah':
      case 'gerak': {
        if (this.tool === 'panah' && rec.shape === 'loop') { this.pincer(rec.pts); return; }
        if (!this.own(sp)) { this.toast('Mulai panah dari pasukanmu sendiri.'); return; }
        if (rec.shape === 'tap' || ep < 0 || ep === sp) return;
        const attack = this.tool === 'panah';
        const path = findPath(this.map, s, c, sp, ep, { attack: true, stroke: rec.pts })
          ?? (attack ? null : findPath(this.map, s, c, sp, ep, { attack: false, stroke: rec.pts }));
        if (!path) { this.toast('Tidak ada rute ke sana.'); return; }
        // keep the player's own line: the army will march along exactly what was drawn
        const stroke = simplify(rec.pts, 3 / this.r.cam.zoom).slice(0, 48).map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }));
        const o: Order = { kind: attack ? 'serang' : 'gerak', from: sp, path, frac: this.frac, stroke };
        const i = this.addOrder(o);
        this.selectOrder(i);
        this.audio.sting('click');
        const v = this.validity[i];
        if (v && !v.valid) this.toast('⚠ ' + v.reason, 2600);
        break;
      }
      case 'garis': {
        const provs: number[] = [];
        for (const p of rec.pts) {
          const q = this.r.provinceAt(p.x, p.y);
          if (q >= 0 && this.own(q) && provs[provs.length - 1] !== q && !provs.includes(q)) provs.push(q);
        }
        if (provs.length < 2) { this.toast('Garis pertahanan butuh minimal 2 provinsimu.'); return; }
        this.addOrder({ kind: 'bertahan', provs, stroke: simplify(rec.pts, 4 / this.r.cam.zoom).slice(0, 60) });
        this.toast(`Garis pertahanan: ${provs.length} provinsi, pasukan diratakan & menggali parit (+25%).`, 2400);
        break;
      }
      case 'udara': {
        const circ = rec.shape === 'tap' ? { x: rec.start.x, y: rec.start.y, r: 70 } : boundingCircle(rec.pts);
        circ.r = Math.max(40, Math.min(150, circ.r));
        this.addOrder({ kind: 'udara', x: circ.x, y: circ.y, r: circ.r });
        this.toast('Misi udara: +20% serangan/pertahanan di area, bom lawan.', 2200);
        break;
      }
      case 'bangun': {
        if (rec.shape === 'tap') return;
        if (ep < 0 || ep === sp) return;
        const path = findPath(this.map, s, c, sp, ep, { attack: false, stroke: rec.pts });
        if (!path || path.some((p) => s.provs[p].owner !== c)) { this.toast('Jalan hanya di wilayahmu sendiri.'); return; }
        this.addOrder({ kind: 'bangun', prov: sp, what: 'jalan', path });
        this.toast(`Jalan/rel: ${path.length} provinsi (−${BUILD_INFO.jalan.cost * path.length} kas).`);
        break;
      }
    }
  }

  private pincer(loop: Pt[]) {
    const s = this.state, c = this.current, P = this.map.provinces;
    const targets = P.filter((p) => pointInPoly(p, loop) && !allied(s, c, s.provs[p.id].ctrl)).map((p) => p.id);
    if (!targets.length) { this.toast('Lingkari wilayah lawan untuk operasi jepit.'); return; }
    const used = new Set<number>();
    const made: Order[] = [];
    for (const t of targets) {
      for (const n of P[t].neighbors) {
        if (!this.own(n) || used.has(n) || s.provs[n].troops < 1000) continue;
        used.add(n);
        made.push({ kind: 'serang', from: n, path: [n, t], frac: 0.5, group: Date.now() % 100000 });
      }
    }
    if (!made.length) { this.toast('Tidak ada pasukanmu yang bersebelahan dengan lingkaran.'); return; }
    this.pushUndo();
    this.myOrders().push(...made);
    this.afterOrdersChanged();
    this.toast(`Operasi jepit: ${made.length} panah. Serangan dari ≥2 arah dapat bonus +20%.`, 2600);
  }

  private selectOrder(i: number) {
    this.selectedOrder = i;
    const o = this.myOrders()[i];
    const fb = this.els.fracbar;
    if (!o || (o.kind !== 'serang' && o.kind !== 'gerak')) {
      fb.replaceChildren(h('button', { onclick: () => this.deleteOrder(i), title: 'Hapus' }, svg(ICONS.trash)));
    } else {
      fb.replaceChildren(
        ...([0.25, 0.5, 1] as Frac[]).map((f) => h('button', {
          class: o.frac === f ? 'on' : '',
          onclick: () => { this.pushUndo(); o.frac = f; this.frac = f; this.selectOrder(i); this.afterOrdersChanged(); },
        }, `${f * 100}%`)),
        h('button', { onclick: () => this.deleteOrder(i), title: 'Hapus' }, svg(ICONS.trash)));
    }
    const at = this.orderAnchor(o);
    const sp = this.r.worldToScreen(at.x, at.y);
    fb.style.left = `${Math.max(120, Math.min(this.r.W - 120, sp.x))}px`;
    fb.style.top = `${Math.max(110, sp.y)}px`;
    fb.classList.remove('hidden');
  }

  private orderAnchor(o: Order): Pt {
    const P = this.map.provinces;
    switch (o.kind) {
      case 'serang': case 'gerak': return pointAlong(this.r.orderLine(o), 1);
      case 'bertahan': return o.stroke?.[Math.floor(o.stroke.length / 2)] ?? P[o.provs[0]];
      case 'udara': return { x: o.x, y: o.y };
      case 'bangun': case 'rekrut': case 'hangus': return P[o.prov];
      default: return { x: 0, y: 0 };
    }
  }

  private hitOrder(w: Pt): number {
    const z = this.r.cam.zoom;
    const list = this.myOrders();
    let best = -1, bd = 14 / z;
    list.forEach((o, i) => {
      let d = Infinity;
      if (o.kind === 'serang' || o.kind === 'gerak') d = distToPolyline(w, this.r.orderLine(o));
      else if (o.kind === 'bertahan' && o.stroke) d = distToPolyline(w, o.stroke);
      else if (o.kind === 'udara') d = Math.abs(Math.hypot(w.x - o.x, w.y - o.y) - o.r);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  private tap(sx: number, sy: number) {
    if (this.phase !== 'plan') return;
    const w = this.r.screenToWorld(sx, sy);
    this.hideFloating();
    const hit = this.hitOrder(w);
    if (hit >= 0 && this.tool !== 'bangun' && this.tool !== 'hangus') { this.selectOrder(hit); return; }
    this.selectedOrder = -1;
    const p = this.r.provinceAt(w.x, w.y);
    if (this.tool === 'bangun' && this.own(p)) { this.selectedProv = p; this.buildMenu(p, sx, sy); this.renderSheet(); return; }
    if (this.tool === 'hangus' && this.own(p)) {
      const i = this.myOrders().findIndex((o) => o.kind === 'hangus' && o.prov === p);
      if (i >= 0) this.deleteOrder(i);
      else { this.addOrder({ kind: 'hangus', prov: p }); this.toast('Bumi hangus: musuh melambat, tapi infrastrukturmu rusak.', 2400); }
      return;
    }
    if (this.tool === 'udara' && p >= 0) {
      this.addOrder({ kind: 'udara', x: w.x, y: w.y, r: 70 });
      return;
    }
    this.selectedProv = p;
    if (p >= 0) { this.tab = 'provinsi'; this.sheetOpen = true; }
    this.renderSheet();
  }

  private longPress(sx: number, sy: number) {
    if (this.phase !== 'plan') return;
    const w = this.r.screenToWorld(sx, sy);
    const p = this.r.provinceAt(w.x, w.y);
    if (p < 0) return;
    this.selectedProv = p;
    if (this.own(p)) this.buildMenu(p, sx, sy);
    this.tab = 'provinsi';
    this.sheetOpen = true;
    this.renderSheet();
  }

  private buildMenu(p: number, sx: number, sy: number) {
    const bm = this.els.buildmenu;
    const s = this.state;
    const k = s.countries[this.current];
    const avail = k.treasury - pendingSpend(s, this.myOrders());
    const icons: Record<BuildKind, string> = { pabrik: '🏭', pabrikMil: '⚙️', benteng: '🏰', pelabuhan: '⚓', kota: '🏙️', jalan: '🛤️' };
    const kinds: BuildKind[] = ['pabrik', 'pabrikMil', 'benteng', 'pelabuhan', 'kota'];
    bm.replaceChildren(...kinds.map((kind) => {
      const o: Order = { kind: 'bangun', prov: p, what: kind };
      const v = validateOrder(this.map, s, this.current, o, this.myOrders());
      const info = BUILD_INFO[kind];
      return h('button', {
        disabled: !v.ok, title: v.reason ?? info.desc,
        onclick: () => { this.addOrder(o); this.hideFloating(); this.toast(`${info.name} diantrekan (${info.turns} giliran).`); },
      }, h('span', null, icons[kind]), info.name, h('small', null, `${info.cost} · ${info.turns}g`));
    }), h('button', {
      disabled: avail < 6 * 10,
      onclick: () => { this.recruit(p, 10000); this.hideFloating(); },
    }, h('span', null, '🪖'), 'Rekrut 10rb', h('small', null, `${RULES.recruitCostPer1000 * 10} kas`)));
    bm.style.left = `${Math.max(150, Math.min(this.r.W - 150, sx))}px`;
    bm.style.top = `${Math.max(250, sy)}px`;
    bm.classList.remove('hidden');
  }

  private recruit(p: number, amount: number) {
    const o: Order = { kind: 'rekrut', prov: p, amount };
    const v = validateOrder(this.map, this.state, this.current, o, this.myOrders());
    if (!v.ok) { this.toast('⚠ ' + v.reason); return; }
    const ex = this.myOrders().find((x) => x.kind === 'rekrut' && x.prov === p) as Extract<Order, { kind: 'rekrut' }> | undefined;
    if (ex) { this.pushUndo(); ex.amount += amount; this.afterOrdersChanged(); }
    else this.addOrder(o);
    this.toast(`Rekrut +${fmtCompact(amount)} (tiba akhir giliran).`);
  }

  // =====================================================================
  // bottom sheet
  // =====================================================================
  renderSheet() {
    const sh = this.els.sheet;
    if (!sh || this.phase !== 'plan') return;
    sh.classList.toggle('collapsed', !this.sheetOpen);
    this.els.sheetToggle.classList.toggle('hidden', this.sheetOpen);
    const s = this.state;
    const inbox = s.proposals.filter((p) => p.to === this.current).length;
    const k = s.countries[this.current];
    const tabBtn = (t: Tab, label: string, badge = 0) => h('button', {
      class: this.tab === t ? 'active' : '',
      onclick: () => { this.tab = t; this.sheetOpen = true; this.renderSheet(); },
    }, label, badge ? h('span', { class: 'badge' }, String(badge)) : null);
    const tabs = h('div', { class: 'tabs' },
      tabBtn('provinsi', 'Provinsi'), tabBtn('negara', 'Negara'), tabBtn('diplomasi', 'Diplomasi', inbox),
      tabBtn('laporan', 'Laporan', (k.pendingEvent ? 1 : 0)),
      h('button', { class: 'grip', title: 'Buka/tutup', onclick: () => { this.sheetOpen = !this.sheetOpen; this.renderSheet(); } }, this.sheetOpen ? '▾' : '▴'));
    const body = h('div', { class: 'body' });
    switch (this.tab) {
      case 'provinsi': this.sheetProvince(body); break;
      case 'negara': this.sheetCountry(body); break;
      case 'diplomasi': this.sheetDiplomacy(body); break;
      case 'laporan': this.sheetReport(body); break;
    }
    sh.replaceChildren(tabs, body);
  }

  private sheetProvince(body: HTMLElement) {
    const p = this.selectedProv;
    const s = this.state;
    if (p < 0) { body.append(h('div', { class: 'muted' }, 'Ketuk provinsi untuk melihat detail. Tekan lama provinsimu untuk membangun.')); return; }
    const pr = this.map.provinces[p];
    const ps = s.provs[p];
    const owner = s.countries[ps.owner], ctrl = s.countries[ps.ctrl];
    const vis = visibleSet(this.map, s, this.current)[p];
    const mine = ps.ctrl === this.current;
    body.append(
      h('div', { class: 'row' },
        h('img', { class: 'flag', src: flagDataUrl(ctrl.flag), alt: '' }),
        h('h2', { style: 'font-size:24px' }, provinceName(this.map.params.seed, p)),
        s.countries[ps.ctrl].capital === p ? h('span', { class: 'chip' }, '★ Ibu kota') : null,
        ps.ctrl !== ps.owner ? h('span', { class: 'chip war' }, `Diduduki · milik ${owner.name}`) : null),
      h('div', { class: 'muted', style: 'margin-top:4px' }, `${ctrl.name} · ${TERRAIN_INFO[pr.terrain].name} · ${RESOURCE_NAME[pr.resource]}${pr.coastal ? ' · Pesisir' : ''}`),
      h('div', { class: 'kv' },
        h('div', null, h('small', null, 'Pasukan'), h('b', null, vis ? fmtInt(ps.troops) : '?')),
        h('div', null, h('small', null, 'Populasi'), h('b', null, fmtCompact(ps.pop * 1000))),
        h('div', null, h('small', null, 'Bertahan'), h('b', null, `×${(TERRAIN_INFO[pr.terrain].defense * (1 + 0.25 * ps.fort)).toFixed(2)}`)),
        h('div', null, h('small', null, 'Benteng'), h('b', null, '▲'.repeat(ps.fort) || '—')),
        h('div', null, h('small', null, 'Infrastruktur'), h('b', null, `${ps.infra}/5`)),
        h('div', null, h('small', null, 'Pabrik'), h('b', null, `${ps.factories} + ${ps.milFactories} mil`)),
        h('div', null, h('small', null, 'Pelabuhan'), h('b', null, ps.port ? 'Ada' : '—')),
        h('div', null, h('small', null, 'Integrasi'), h('b', null, Math.round(ps.integration * 100) + '%')),
        ...(mine ? (() => {
          const cap = stackCap(this.map, s, p);
          const lvl = supplyLevels(this.map, s, this.current)[p];
          const over = ps.troops > cap;
          return [
            h('div', { title: 'Pasukan di atas kapasitas berkurang 15% dari kelebihannya tiap giliran. Naik dengan jalan/rel dan kota.' },
              h('small', null, 'Kapasitas'), h('b', { style: over ? 'color:#ff6b5e' : '' }, `${fmtCompact(ps.troops)} / ${fmtCompact(cap)}`)),
            h('div', { title: 'Jarak dari ibu kota/kota lewat wilayahmu. Jalan/rel memperpanjang jangkauan.' },
              h('small', null, 'Suplai'), h('b', { style: lvl === SUPPLY_FULL ? '' : lvl === SUPPLY_CUT ? 'color:#ff6b5e' : 'color:#f5b800' },
                lvl === SUPPLY_FULL ? 'Penuh' : lvl === SUPPLY_CUT ? 'Terputus' : 'Menipis')),
          ];
        })() : [])),
      ps.queue.length ? h('div', { class: 'muted' }, 'Antrean: ' + ps.queue.map((q) => `${BUILD_INFO[q.kind].name} (${q.left}g)`).join(', ')) : '',
    );
    if (mine && ps.owner === this.current) {
      body.append(h('div', { class: 'sec' }, 'Rekrut'),
        h('div', { class: 'row' }, [5000, 10000, 25000, 50000].map((a) =>
          h('button', { class: 'btn small', onclick: () => this.recruit(p, a) }, `+${fmtCompact(a)} · ${RULES.recruitCostPer1000 * a / 1000}`))),
        h('div', { class: 'sec' }, 'Bangun'),
        h('div', { class: 'row' }, (['pabrik', 'pabrikMil', 'benteng', 'pelabuhan', 'kota'] as BuildKind[]).map((kind) => {
          const o: Order = { kind: 'bangun', prov: p, what: kind };
          const v = validateOrder(this.map, s, this.current, o, this.myOrders());
          return h('button', { class: 'btn small', disabled: !v.ok, title: v.reason ?? BUILD_INFO[kind].desc, onclick: () => this.addOrder(o) }, `${BUILD_INFO[kind].name} · ${BUILD_INFO[kind].cost}`);
        })));
    }
  }

  private sheetCountry(body: HTMLElement) {
    const s = this.state;
    const c = this.current;
    const k = s.countries[c];
    const troops = totalTroops(s, c);
    const cap = manpowerCap(s, c);
    const b = k.budget;
    const slider = (key: 'mil' | 'civ' | 'res', label: string) => {
      const out = h('b', { class: 'num' }, `${b[key]}%`);
      const inp = h('input', { type: 'range', min: 0, max: 100, step: 5, value: String(b[key]) }) as HTMLInputElement;
      inp.oninput = () => {
        const v = Number(inp.value);
        const others = (['mil', 'civ', 'res'] as const).filter((x) => x !== key);
        const rest = 100 - v;
        const sumO = b[others[0]] + b[others[1]] || 1;
        b[key] = v;
        b[others[0]] = Math.round((b[others[0]] / sumO) * rest / 5) * 5;
        b[others[1]] = 100 - v - b[others[0]];
        out.textContent = `${v}%`;
        clearTimeout((inp as unknown as { _t: number })._t);
        (inp as unknown as { _t: number })._t = window.setTimeout(() => this.renderSheet(), 250);
      };
      return h('div', { class: 'slider' }, h('span', null, label), inp, out);
    };
    body.append(
      h('div', { class: 'row' }, h('img', { class: 'flag', src: flagDataUrl(k.flag), alt: '' }), h('h2', { style: 'font-size:24px' }, k.name),
        h('span', { class: 'chip' }, k.gov === 'demokrasi' ? 'Demokrasi' : 'Otoriter'), k.exiled ? h('span', { class: 'chip war' }, 'Pengasingan') : null),
      h('div', { class: 'kv' },
        h('div', null, h('small', null, 'Kas'), h('b', null, fmtInt(k.treasury))),
        h('div', null, h('small', null, 'Pendapatan/gil'), h('b', null, (k.lastIncome >= 0 ? '+' : '') + fmtInt(k.lastIncome))),
        h('div', null, h('small', null, 'PDB'), h('b', null, countryGdp(s, c).toFixed(1))),
        h('div', null, h('small', null, 'Pasukan'), h('b', null, fmtCompact(troops))),
        h('div', null, h('small', null, 'Tenaga kerja'), h('b', null, `${Math.round((troops / Math.max(1, cap)) * 100)}%`)),
        h('div', null, h('small', null, 'Stabilitas'), h('b', null, `${Math.round(k.stability)}%`)),
        h('div', null, h('small', null, 'Kelelahan perang'), h('b', null, `${Math.round(k.weariness)}%`)),
        h('div', null, h('small', null, 'Kualitas alat'), h('b', null, `${Math.round(k.quality * 100)}%`)),
        h('div', null, h('small', null, 'Reputasi'), h('b', null, String(Math.round(k.reputation))))),
      h('div', { class: 'sec' }, 'Anggaran otomatis (separuh pajak)'),
      slider('mil', 'Militer'), slider('civ', 'Sipil'), slider('res', 'Riset'),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Militer = penguatan pasukan otomatis · Sipil = stabilitas & pertumbuhan · Riset = kualitas peralatan. Separuh pajak lainnya masuk kas untuk Bangun/Rekrut.'),
      h('div', { class: 'sec' }, `Perintah giliran ini (${this.myOrders().length})`),
      this.myOrders().length ? h('div', null, this.myOrders().map((o, i) => h('div', { class: 'row', style: 'justify-content:space-between' },
        h('span', { style: this.validity[i]?.valid === false ? 'color:#ff6b5e' : '' }, this.describeOrder(o) + (this.validity[i]?.valid === false ? ` — ${this.validity[i].reason}` : '')),
        h('button', { class: 'btn small', onclick: () => this.deleteOrder(i) }, '✕')))) : h('div', { class: 'muted' }, 'Belum ada perintah.'),
    );
  }

  private describeOrder(o: Order): string {
    const n = (p: number) => provinceName(this.map.params.seed, p);
    const s = this.state;
    switch (o.kind) {
      case 'serang': return `⚔ Serang ${n(o.path[o.path.length - 1])} dari ${n(o.from)} (${o.frac * 100}%)`;
      case 'gerak': return `➜ Gerak ke ${n(o.path[o.path.length - 1])} (${o.frac * 100}%)`;
      case 'bertahan': return `🛡 Garis pertahanan ${o.provs.length} provinsi`;
      case 'udara': return '✈ Misi udara';
      case 'bangun': return `🏗 ${BUILD_INFO[o.what].name} di ${n(o.prov)}`;
      case 'rekrut': return `🪖 Rekrut ${fmtCompact(o.amount)} di ${n(o.prov)}`;
      case 'hangus': return `✖ Bumi hangus ${n(o.prov)}`;
      case 'deklarasi': return `📜 Deklarasi perang ke ${s.countries[o.target].name}`;
      case 'usul': return `✉ Usul ${PROPOSAL_NAME[o.what]} ke ${s.countries[o.to].name}`;
      case 'jawab': return `✉ ${o.accept ? 'Terima' : 'Tolak'} usulan`;
      case 'mata2': return `🕵 Mata-mata ke ${s.countries[o.target].name}`;
      case 'event': return '📰 Respons peristiwa';
    }
  }

  private sheetDiplomacy(body: HTMLElement) {
    const s = this.state;
    const c = this.current;
    const my = this.myOrders();
    const inbox = s.proposals.filter((p) => p.to === c);
    if (inbox.length) {
      body.append(h('div', { class: 'sec' }, 'Kotak masuk rahasia'));
      for (const pr of inbox) {
        const from = s.countries[pr.from];
        const answered = my.find((o) => o.kind === 'jawab' && o.proposal === pr.id) as Extract<Order, { kind: 'jawab' }> | undefined;
        body.append(h('div', { class: 'cty' },
          h('img', { class: 'flag', src: flagDataUrl(from.flag), alt: '' }),
          h('div', { class: 'nm' }, `${from.name} mengusulkan ${PROPOSAL_NAME[pr.kind]}${pr.pay ? ` + ${pr.pay} kas` : ''}`),
          answered ? h('span', { class: 'chip ' + (answered.accept ? 'ally' : 'war') }, answered.accept ? 'Diterima' : 'Ditolak') : null,
          h('button', { class: 'btn small', onclick: () => this.answer(pr.id, true) }, 'Terima'),
          h('button', { class: 'btn small danger', onclick: () => this.answer(pr.id, false) }, 'Tolak')));
      }
    }
    body.append(h('div', { class: 'sec' }, 'Negara'));
    for (const k of s.countries) {
      if (k.id === c || !k.alive) continue;
      const r = s.rel[c][k.id];
      const declared = my.some((o) => o.kind === 'deklarasi' && o.target === k.id);
      const status = r.status === 'perang' ? h('span', { class: 'chip war' }, 'Perang')
        : r.status === 'aliansi' ? h('span', { class: 'chip ally' }, 'Aliansi')
        : r.status === 'nap' ? h('span', { class: 'chip nap' }, 'Non-agresi')
        : h('span', { class: 'chip' }, r.truce ? `Damai (${r.truce})` : 'Damai');
      const meter = h('div', { class: 'meter', title: `Hubungan ${Math.round(r.value)}` },
        h('i', { class: r.value < 0 ? 'neg' : '', style: r.value < 0 ? `left:${50 + r.value / 2}%;right:50%` : `left:50%;right:${50 - r.value / 2}%` }));
      const propose = (what: ProposalKind, label: string) => {
        const sent = my.some((o) => o.kind === 'usul' && o.to === k.id && o.what === what);
        return h('button', { class: 'btn small' + (sent ? ' on' : ''), onclick: () => this.propose(k.id, what) }, label);
      };
      const actions: HTMLElement[] = [];
      if (r.status === 'perang') actions.push(propose('damai', '🕊 Damai'));
      else {
        actions.push(h('button', { class: 'btn small danger' + (declared ? ' on' : ''), disabled: r.truce > 0, onclick: () => this.declare(k.id) }, declared ? 'Batal deklarasi' : '⚔ Nyatakan perang'));
        if (r.status !== 'aliansi') actions.push(propose('aliansi', 'Aliansi'));
        if (r.status === 'damai') actions.push(propose('nap', 'Non-agresi'));
        if (!r.trade) actions.push(propose('dagang', 'Dagang'));
      }
      const spied = my.some((o) => o.kind === 'mata2' && o.target === k.id);
      actions.push(h('button', { class: 'btn small' + (spied ? ' on' : ''), title: `Intel 1 giliran (−${RULES.spyCost})`, onclick: () => this.spy(k.id) }, '🕵'));
      body.append(h('div', { class: 'cty' },
        h('img', { class: 'flag', src: flagDataUrl(k.flag), alt: '' }),
        h('div', { class: 'nm' }, k.name, h('div', { class: 'muted', style: 'font-size:11px;font-weight:600' }, k.kind === 'manusia' ? 'Manusia' : k.kind === 'ai' ? `AI · ${k.personality}` : `Negara kecil · ${k.personality}`)),
        status, meter, h('div', { class: 'row' }, actions)));
    }
    const intel = s.intel[c];
    if (intel && intel.turn === s.turn) body.append(h('div', { class: 'news' }, `🕵 Intel: perintah ${s.countries[intel.target].name} giliran lalu tampil samar di peta, dan kekuatannya terlihat.`));
  }

  private toggleOrder(match: (o: Order) => boolean, make: () => Order) {
    const i = this.myOrders().findIndex(match);
    this.pushUndo();
    if (i >= 0) this.myOrders().splice(i, 1);
    else this.myOrders().push(make());
    this.afterOrdersChanged();
  }
  private declare(t: number) {
    this.toggleOrder((o) => o.kind === 'deklarasi' && o.target === t, () => ({ kind: 'deklarasi', target: t }));
  }
  private propose(t: number, what: ProposalKind) {
    this.toggleOrder((o) => o.kind === 'usul' && o.to === t && o.what === what, () => ({ kind: 'usul', to: t, what, pay: 0 }));
  }
  private spy(t: number) {
    this.toggleOrder((o) => o.kind === 'mata2' && o.target === t, () => ({ kind: 'mata2', target: t }));
  }
  private answer(id: number, accept: boolean) {
    const my = this.myOrders();
    const i = my.findIndex((o) => o.kind === 'jawab' && o.proposal === id);
    this.pushUndo();
    if (i >= 0) my.splice(i, 1);
    my.push({ kind: 'jawab', proposal: id, accept });
    this.afterOrdersChanged();
  }

  private sheetReport(body: HTMLElement) {
    const s = this.state;
    const k = s.countries[this.current];
    if (k.pendingEvent) {
      const ev = k.pendingEvent;
      const chosen = this.myOrders().find((o) => o.kind === 'event') as Extract<Order, { kind: 'event' }> | undefined;
      body.append(h('div', { class: 'event' },
        h('h3', null, ev.title), h('p', null, ev.text),
        h('div', { class: 'row' }, ev.choices.map((ch, i) => h('button', {
          class: 'btn small' + (chosen?.choice === i ? ' on' : ''),
          onclick: () => { this.toggleOrder((o) => o.kind === 'event', () => ({ kind: 'event', choice: i })); if (chosen && chosen.choice !== i) this.toggleOrder((o) => o.kind === 'event', () => ({ kind: 'event', choice: i })); },
        }, ch)))));
    }
    body.append(h('div', { class: 'sec' }, 'Laporan rahasia'));
    const priv = s.privateNews[this.current] ?? [];
    body.append(...(priv.length ? priv.map((n) => h('div', { class: 'news' }, n)) : [h('div', { class: 'muted' }, 'Tidak ada laporan.')]));
    body.append(h('div', { class: 'sec' }, 'Berita publik'));
    body.append(...(s.news.length ? s.news.map((n) => h('div', { class: 'news', style: 'border-left-color:#8f9bad' }, n)) : [h('div', { class: 'muted' }, '—')]));
    if (s.stats.length > 1) {
      body.append(h('div', { class: 'sec' }, 'Wilayah per negara'));
      const cv = h('canvas', { width: 600, height: 160, style: 'width:100%;height:120px' }) as HTMLCanvasElement;
      const ctx = cv.getContext('2d')!;
      const max = Math.max(...s.stats.flatMap((st) => st.provs));
      s.countries.forEach((cc) => {
        if (cc.kind === 'minor') return;
        ctx.strokeStyle = cc.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        s.stats.forEach((st, i) => {
          const x = (i / (s.stats.length - 1)) * 590 + 5;
          const y = 155 - (st.provs[cc.id] / max) * 145;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
      body.append(cv);
    }
  }

  // =====================================================================
  // menus
  // =====================================================================
  private menu() {
    const bg = this.modal([
      h('h2', null, 'Menu'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { const t = this.state.settings.theme === 'satelit' ? 'kartun' : 'satelit'; this.state.settings.theme = t; this.toast('Membangun tema…'); setTimeout(() => this.r.setTheme(t), 30); bg.remove(); } }, `Tema: ${this.state.settings.theme === 'satelit' ? 'Satelit' : 'Kartun'}`),
        h('button', { class: 'btn', onclick: () => { this.audio.setMuted(!this.audio.muted); bg.remove(); } }, this.audio.muted ? '🔇 Suara mati' : '🔊 Suara'),
        h('button', { class: 'btn', onclick: () => { this.colorblind = !this.colorblind; bg.remove(); } }, `Pola buta warna: ${this.colorblind ? 'on' : 'off'}`),
        h('button', { class: 'btn', onclick: () => { document.body.classList.toggle('lefty'); bg.remove(); } }, 'Mode kidal')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { bg.remove(); this.help(); } }, 'Cara main'),
        h('button', { class: 'btn danger', onclick: () => { this.save(); bg.remove(); this.showLobby(); } }, 'Simpan & ke lobi')),
      h('p', { class: 'muted', style: 'font-size:12px' }, 'Permainan tersimpan otomatis setiap awal giliran di perangkat ini.'),
    ]);
  }

  private help() {
    this.modal([
      h('h2', null, 'Cara Main'),
      h('div', { class: 'help' },
        h('p', null, h('b', null, 'Gambar = perintah. '), 'Tarik panah dari angka pasukanmu ke wilayah lawan. Tebal panah = 25/50/100% pasukan (ketuk panah untuk mengubah, atau scroll saat menggambar).'),
        h('p', null, h('b', null, 'Lingkari '), 'wilayah musuh dengan alat Serang untuk operasi jepit otomatis — serangan dari ≥2 arah dapat bonus +20%.'),
        h('p', null, h('b', null, 'Garis '), 'di sepanjang perbatasan meratakan pasukan dan menggali parit (+25% bertahan). ', h('b', null, 'Udara '), 'melingkari area untuk dukungan udara.'),
        h('p', null, h('b', null, 'WEGO: '), 'semua pemain merencanakan diam-diam bergantian, lalu semua perintah dieksekusi bersamaan selama 7 hari sebagai animasi. Dua serangan yang bertemu jadi pertempuran berjalan.'),
        h('p', null, h('b', null, 'Rasio kekuatan: '), 'saat menggambar panah serang, label di ujung panah menunjukkan perkiraan kekuatanmu dibanding pembela: ', h('b', { style: 'color:#1f9d55' }, 'hijau'), ' = kemungkinan tembus, ', h('b', { style: 'color:#d99a00' }, 'kuning'), ' = alot, ', h('b', { style: 'color:#d64236' }, 'merah'), ' = kemungkinan gagal. Gabungkan beberapa panah ke satu target untuk menaikkan rasio.'),
        h('p', null, h('b', null, 'Logistik: '), 'suplai mengalir dari ibu kota & kota lewat wilayahmu; jalan/rel memperpanjang jangkauannya. Di ujung jalur suplai pasukan melemah 4%/minggu (tempur −18%); terputus total −10%/minggu. Gunung & benteng membuat penyerang butuh rasio ±3:1.'),
        h('p', null, h('b', null, 'Kapasitas: '), 'tiap provinsi hanya sanggup menghidupi sejumlah pasukan (naik dengan jalan/rel dan kota). Kelebihannya hilang 15% per giliran, jadi sebarkan pasukan dan pakai beberapa panah daripada satu tumpukan raksasa.'),
        h('p', null, h('b', null, 'Tirai privasi: '), 'saat HP berpindah tangan, peta tertutup. Tahan tombol 1 detik untuk membuka. Panah lawan tidak pernah ditampilkan.'),
        h('p', null, h('b', null, 'Kontrol PC: '), h('kbd', null, 'klik kiri'), ' gambar · ', h('kbd', null, 'klik kanan tahan'), '/', h('kbd', null, 'WASD'), ' geser · ', h('kbd', null, 'scroll'), ' zoom · ', h('kbd', null, '1–6'), ' alat · ', h('kbd', null, 'Ctrl+Z/Y'), ' batal/ulang · ', h('kbd', null, 'Delete'), ' hapus · ', h('kbd', null, 'Enter'), ' selesai.'),
        h('p', null, h('b', null, 'HP: '), '1 jari gambar · 2 jari geser/cubit · tekan lama = bangun · geser 3 jari kiri/kanan = batal/ulang.')),
    ]);
  }

  private toggleRecord() {
    if (this.rec?.active) { void this.stopRecord(); return; }
    this.rec = new Recorder(this.canvas);
    if (this.rec.start()) {
      this.dir.restart(performance.now());
      this.toast('⏺ Merekam resolusi (9:16)…');
    }
    this.updatePlaybar();
  }

  private async stopRecord() {
    const blob = await this.rec?.stop();
    this.updatePlaybar();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `garis-depan-giliran-${this.prevState?.turn ?? 0}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.toast('Video tersimpan — siap diunggah.');
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (this.phase === 'plan') {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedOrder >= 0) this.deleteOrder(this.selectedOrder);
      else if (e.key === 'Enter') this.finishPlan();
      else if (!e.ctrlKey && /^[1-6]$/.test(e.key)) this.setTool(TOOLS[Number(e.key) - 1][0]);
      else if (e.key === 'Escape') { this.selectedOrder = -1; this.selectedProv = -1; this.hideFloating(); this.renderSheet(); }
    } else if (this.phase === 'resolve') {
      if (e.key === ' ') { e.preventDefault(); this.dir.paused = !this.dir.paused; this.updatePlaybar(); }
    }
  }

  // =====================================================================
  // main loop
  // =====================================================================
  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(100, now - this.lastT);
    this.lastT = now;
    if (!this.r) return;
    this.input?.tick(dt);
    // effects run on their own clock; during a replay the director advances it by playback speed
    if (this.phase !== 'resolve') this.r.fx.advance(dt);
    if (this.phase === 'lobby' && this.previewState && now > this.nextAmbient) {
      this.dir.ambient(this.previewState);
      this.nextAmbient = now + 1400;
    }
    let view: View | null = null;

    if (this.phase === 'lobby' && this.previewState) {
      // slow drift behind the lobby
      this.r.cam.x = this.map.w / 2 + Math.sin(now / 9000) * 60;
      this.r.cam.y = this.map.h / 2 + Math.cos(now / 11000) * 40;
      const st = this.previewState;
      view = this.baseView(st, -1);
      view.mode = 'idle';
    } else if (this.phase === 'resolve' || (this.phase === 'report' && this.prevState)) {
      const s = this.state;
      if (this.phase === 'resolve') {
        const f = this.dir.update(now);
        this.lastFrame = f;
        if (f.done) this.afterResolution();
        this.updateTally(f);
        this.audio.setIntensity(this.res?.frames[Math.min(this.res.frames.length - 1, f.day + 1)]?.events.filter((e) => e.t === 'battle').length ?? 0);
      }
      const f = this.lastFrame!;
      view = this.baseView(s, -1);
      view.troops = f.troops;
      view.ctrl = f.ctrl;
      view.cols = f.cols;
      view.dets = f.dets;
      view.annex = f.annex;
      view.flash = f.flash;
      view.spotlight = f.spotlight;
      view.mode = 'play';
      view.visible = null;
    } else if (this.phase === 'curtain') {
      view = this.baseView(this.state, -1);
      view.mode = 'curtain';
    } else if (this.state && (this.phase === 'plan' || this.phase === 'over')) {
      view = this.baseView(this.state, this.phase === 'plan' ? this.current : -1);
      if (this.phase === 'plan') {
        view.orders = this.validity.map((v, i) => ({ ...v, selected: i === this.selectedOrder }));
        view.orderOwner = this.current;
        view.selectedProv = this.selectedProv;
        const intel = this.state.intel[this.current];
        if (intel && intel.turn === this.state.turn) view.intel = { orders: intel.orders, owner: intel.target };
        if (this.draft) {
          const k = this.state.countries[this.current];
          view.draft = {
            pts: this.draft,
            color: this.tool === 'udara' ? '#9ad7ff' : this.tool === 'bangun' ? '#f0e6c8' : k.color,
            dashed: this.tool === 'gerak',
            width: this.tool === 'panah' ? (this.frac === 1 ? 10 : this.frac === 0.5 ? 7 : 4.5) : 6,
            odds: this.tool === 'panah' ? this.draftOdds() : undefined,
          };
        }
        this.updateTimer(now);
      }
    }
    if (view) this.r.draw(view, now);
    if (this.rec?.active && this.phase === 'resolve') this.recordFrame();

    // directional motion blur during director camera sweeps
    const blur = this.r.motionBlur;
    const dxs = (this.r.cam.x - this.lastCam.x) * this.r.cam.zoom, dys = (this.r.cam.y - this.lastCam.y) * this.r.cam.zoom;
    this.lastCam = { x: this.r.cam.x, y: this.r.cam.y };
    if (blur > 0.6) {
      const l = Math.hypot(dxs, dys) || 1;
      document.getElementById('mblurStd')?.setAttribute('stdDeviation', `${(Math.abs(dxs) / l * blur).toFixed(1)} ${(Math.abs(dys) / l * blur).toFixed(1)}`);
      this.canvas.classList.add('blur');
    } else this.canvas.classList.remove('blur');
  };

  private oddsCache: { key: string; odds: number | null | undefined } | null = null;

  /** Live strength estimate while an attack arrow is being drawn. */
  private draftOdds(): number | null | undefined {
    const d = this.draft;
    if (!d || d.length < 2) return undefined;
    const from = this.r.provinceAt(d[0].x, d[0].y);
    const end = d[d.length - 1];
    const to = this.r.provinceAt(end.x, end.y);
    if (!this.own(from) || to < 0 || to === from || allied(this.state, this.current, this.state.provs[to].ctrl)) return undefined;
    const key = `${from}>${to}@${this.frac}#${this.myOrders().length}`;
    if (this.oddsCache?.key === key) return this.oddsCache.odds;
    const path = findPath(this.map, this.state, this.current, from, to, { attack: true, stroke: d }) ?? [from, to];
    const odds = attackOdds(this.map, this.state, this.current, { from, path, frac: this.frac }, this.myOrders())?.ratio;
    this.oddsCache = { key, odds };
    return odds;
  }

  private baseView(s: GameState, viewer: number): View {
    return {
      state: s, viewer,
      visible: viewer >= 0 ? visibleSet(this.map, s, viewer) : null,
      troops: s.provs.map((p) => p.troops),
      ctrl: s.provs.map((p) => p.ctrl),
      orders: [], orderOwner: viewer, intel: null, draft: null, cols: [], annex: [], flash: new Map(),
      selectedProv: -1, mode: 'plan', spotlight: null, colorblind: this.colorblind,
    };
  }

  private updateTimer(now: number) {
    if (!this.timerEnd) return;
    const left = Math.max(0, Math.ceil((this.timerEnd - now) / 1000));
    const el = document.getElementById('timer');
    if (el) { el.textContent = `${left}s`; el.classList.toggle('low', left <= 10); }
    if (left <= 0) { this.toast('Waktu habis!'); this.finishPlan(); }
  }

  private updateTally(f: DirectorFrame) {
    const t = this.els.tally;
    if (!t || !this.res || !this.prevState) return;
    const prog = Math.min(1, this.dir.t / Math.max(1, this.dir.total - 900));
    const rows = this.prevState.countries
      .map((k) => ({ k, v: this.res!.casualties[k.id] * prog }))
      .filter((r) => r.v > 100 && r.k.kind !== 'minor')
      .sort((a, b) => b.v - a.v)
      .slice(0, 4);
    t.replaceChildren(rows.length ? h('small', null, 'KORBAN') : '', ...rows.map((r) => h('div', { style: `color:${r.k.color}` }, `~${fmtInt(Math.round(r.v / 100) * 100)}`)));
    void f;
  }

  private recordFrame() {
    if (!this.rec || !this.prevState || !this.res) return;
    const day = this.lastFrame?.day ?? 0;
    const d = dateOf(this.prevState);
    d.setUTCDate(d.getUTCDate() + Math.min(6, day));
    const prog = Math.min(1, this.dir.t / Math.max(1, this.dir.total - 900));
    const lines = this.prevState.countries.filter((k) => k.kind !== 'minor' && this.res!.casualties[k.id] > 100)
      .slice(0, 3).map((k) => ({ text: `${k.name.split(' ').pop()}: −${fmtInt(this.res!.casualties[k.id] * prog)}`, color: k.color }));
    this.rec.frame(fmtDate(d), lines, `GIliran ${this.prevState.turn}`.replace('GI', 'Gi'));
  }
}

// keep tree-shaking honest for helpers only used in some builds
void atWar;
