import { clamp, easeInOut, lerp, type Pt } from '../core/geom';
import type { GameMap } from '../map/types';
import type { ColSnap, GameState, Resolution, SimEvent } from '../sim/types';
import type { AnnexAnim, ColView, DetachView, Renderer } from './renderer';

export interface DirectorFrame {
  troops: number[];
  ctrl: number[];
  cols: ColView[];
  dets: DetachView[];
  annex: AnnexAnim[];
  flash: Map<number, number>;
  spotlight: { x: number; y: number; t0: number } | null;
  day: number;
  done: boolean;
}

interface Scheduled { time: number; ev: SimEvent; day: number }

/** Front speed when ground changes hands, in world units per (virtual) ms. */
const FRONT_SPEED = 0.05;

/**
 * Replays a resolution log as a slow, progressive film: one wide locked shot, ≈4.5 s per day,
 * events staggered inside each day, territory painted in cell by cell, lingering effects.
 * All timing runs on virtual time (t), so pause / 2× / 4× scale everything consistently.
 */
export class Director {
  dayDur = 4500;
  speed = 1;
  paused = false;
  /** Off = locked wide shot with a slow push-in (reference look). On = jump to the biggest battle. */
  autoCam = false;
  t = 0;
  private lastNow = 0;
  private res!: Resolution;
  private prev!: GameState;
  private sched: Scheduled[] = [];
  private fired = 0;
  private dayFired = -1;
  private annex: AnnexAnim[] = [];
  private flash = new Map<number, number>();
  private capturedAt = new Map<number, number>();
  private battles: { x: number; y: number; size: number; until: number; atk: number }[] = [];
  private nextBoom = 0;
  private nextAmbient = 0;
  private spotlight: DirectorFrame['spotlight'] = null;
  private camFrom = { x: 0, y: 0, zoom: 1 };
  private theatre: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private camAnim: { from: { x: number; y: number; zoom: number }; to: { x: number; y: number; zoom: number }; t0: number; dur: number } | null = null;
  private routes = new Map<string, { route: Pt[]; nodes: number[]; drawn: boolean }>();
  private dets: { owner: number; from: Pt; a: number; b: number; troops: number; t0: number }[] = [];

  onMoment?: (text: string, color: string, kind: string) => void;
  onDay?: (day: number) => void;
  onSound?: (kind: 'boom' | 'capture' | 'moment' | 'plane', intensity: number) => void;

  constructor(private r: Renderer, private map: GameMap) {}

  get total() {
    return (this.res.frames.length - 1) * this.dayDur + 1800;
  }

  start(prev: GameState, res: Resolution, now: number) {
    this.prev = prev;
    this.res = res;
    // flatten and stagger every event on one timeline
    this.sched = [];
    res.frames.forEach((f, d) => {
      let lastAt = 0.5;
      f.events.forEach((ev, k) => {
        let time: number;
        if (d === 0) time = 300 + k * 450;
        else if (ev.t === 'battle' || ev.t === 'capture') { lastAt = ev.at; time = (d - 1 + ev.at) * this.dayDur; }
        else time = (d - 1 + Math.min(0.98, lastAt + 0.04)) * this.dayDur;
        this.sched.push({ time, ev, day: d });
      });
    });
    this.sched.sort((a, b) => a.time - b.time);
    // frame the theatre: everything that happens this turn (battles, captures, army routes)
    const P = this.map.provinces;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const sc of this.sched) {
      if (sc.ev.t === 'battle') grow(sc.ev.x, sc.ev.y);
      else if (sc.ev.t === 'capture') { const b = P[sc.ev.prov].bbox; grow(b.x0, b.y0); grow(b.x1, b.y1); }
    }
    for (const c of res.frames[0].cols) for (const i of c.path) grow(P[i].x, P[i].y);
    this.theatre = Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
    this.routes.clear();
    this.restart(now);
  }

  restart(now: number) {
    this.t = 0;
    this.lastNow = now;
    this.fired = 0;
    this.dayFired = -1;
    this.annex = [];
    this.flash.clear();
    this.capturedAt.clear();
    this.dets = [];
    this.battles = [];
    this.spotlight = null;
    this.camAnim = null;
    this.r.fx.clear();
    this.r.fitAll();
    if (this.theatre) {
      const th = this.theatre;
      const pad = 1.5;
      const w = Math.max(260, (th.x1 - th.x0) * pad), hgt = Math.max(200, (th.y1 - th.y0) * pad);
      const fit = this.r.cam.zoom;
      this.r.cam = { x: (th.x0 + th.x1) / 2, y: (th.y0 + th.y1) / 2, zoom: clamp(Math.min(this.r.W / w, this.r.H / hgt), fit, Math.max(fit, 1.6)) };
      this.r.clampCam();
    }
    this.camFrom = { ...this.r.cam };
    this.nextBoom = 0;
    this.nextAmbient = 0;
    this.paused = false;
  }

  skip() {
    this.t = this.total;
  }

  private focus(x: number, y: number, zoom: number, dur = 600) {
    const c = this.r.cam;
    if (Math.hypot(c.x - x, c.y - y) * c.zoom < 30 && Math.abs(c.zoom - zoom) < 0.05) return;
    this.camAnim = { from: { ...c }, to: { x, y, zoom }, t0: this.t, dur };
  }

  /** Route a column is drawn along + the stroke parameter at each province on its path. */
  private routeOf(c: ColSnap) {
    const key = c.id + ':' + c.path.join(',');
    let r = this.routes.get(key);
    if (r) return r;
    const P = this.map.provinces;
    if (c.stroke && c.stroke.length >= 2 && c.kind !== 'mundur') {
      const route = c.stroke;
      const cum = [0];
      for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
      const L = cum[cum.length - 1] || 1;
      const proj = (p: Pt) => {
        let best = 0, bd = Infinity;
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1], b = route[i];
          const dx = b.x - a.x, dy = b.y - a.y;
          const l2 = dx * dx + dy * dy || 1;
          const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
          const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
          if (d < bd) { bd = d; best = (cum[i - 1] + t * Math.sqrt(l2)) / L; }
        }
        return best;
      };
      const nodes = c.path.map((i) => proj(P[i]));
      nodes[0] = 0;
      nodes[nodes.length - 1] = 1;
      for (let i = 1; i < nodes.length; i++) nodes[i] = Math.max(nodes[i], nodes[i - 1]);
      r = { route, nodes, drawn: true };
    } else {
      const route = this.r.route(c.path);
      // route has 10 samples per segment → node i sits at sample 10·i
      const cum = [0];
      for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
      const L = cum[cum.length - 1] || 1;
      const nodes = c.path.map((_, i) => cum[Math.min(route.length - 1, i * 10)] / L);
      r = { route, nodes, drawn: false };
    }
    this.routes.set(key, r);
    return r;
  }

  private uOf(c: ColSnap): number {
    const { nodes } = this.routeOf(c);
    const i = Math.min(c.idx, nodes.length - 1);
    const j = Math.min(c.idx + 1, nodes.length - 1);
    return lerp(nodes[i], nodes[j], clamp(c.prog, 0, 1));
  }

  update(now: number): DirectorFrame {
    const dt = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const vdt = this.paused ? 0 : dt * this.speed;
    this.t = clamp(this.t + vdt, 0, this.total);
    this.r.fx.advance(vdt);
    const frames = this.res.frames;
    const nDays = frames.length - 1;
    const tt = this.t / this.dayDur;
    const d = clamp(Math.floor(tt) + 1, 1, nDays);
    const f = clamp(tt - (d - 1), 0, 1);
    const A = frames[d - 1], B = frames[d];

    if (d !== this.dayFired && this.t < this.total) {
      this.dayFired = d;
      this.onDay?.(d);
      for (let i = 0; i < B.troops.length; i++) if (B.troops[i] < A.troops[i] * 0.8 && A.troops[i] > 1000) this.flash.set(i, now);
    }
    // ---- fire scheduled events ----
    while (this.fired < this.sched.length && this.sched[this.fired].time <= this.t) {
      this.fire(this.sched[this.fired]);
      this.fired++;
    }
    // ---- ongoing battle fire (staggered small blasts + incoming missiles) ----
    this.battles = this.battles.filter((b) => b.until > this.t);
    if (this.battles.length && this.t >= this.nextBoom) {
      const b = this.battles[Math.floor(Math.random() * this.battles.length)];
      const k = clamp(Math.log10(Math.max(1000, b.size)) - 3, 0.3, 3);
      const ox = (Math.random() - 0.5) * 30, oy = (Math.random() - 0.5) * 24;
      if (Math.random() < 0.35) this.missileInto(b.atk, b.x + ox, b.y + oy, 8 + k * 4);
      else this.r.fx.explode(b.x + ox, b.y + oy, 7 + k * 5 * Math.random() + 4);
      this.onSound?.('boom', k / 3);
      this.nextBoom = this.t + 380 + Math.random() * 520;
    }
    // ---- ambient layer: patrols and ships never stop ----
    if (this.t >= this.nextAmbient) {
      this.ambient(this.prev);
      this.nextAmbient = this.t + 900 + Math.random() * 900;
    }
    // ---- camera ----
    if (this.autoCam) {
      if (this.camAnim) {
        const k = clamp((this.t - this.camAnim.t0) / this.camAnim.dur, 0, 1);
        const e = easeInOut(k);
        const { from, to } = this.camAnim;
        const nx = lerp(from.x, to.x, e), ny = lerp(from.y, to.y, e);
        this.r.motionBlur = clamp((Math.hypot(nx - this.r.cam.x, ny - this.r.cam.y) * this.r.cam.zoom) / 6, 0, 10);
        this.r.cam.x = nx;
        this.r.cam.y = ny;
        this.r.cam.zoom = lerp(from.zoom, to.zoom, e);
        this.r.clampCam();
        if (k >= 1) { this.camAnim = null; this.r.motionBlur = 0; }
      } else this.r.motionBlur = 0;
    } else {
      // locked shot on the theatre with a barely-there push-in (≈6% over the turn)
      const p = easeInOut(clamp(this.t / this.total, 0, 1));
      this.r.cam = { x: this.camFrom.x, y: this.camFrom.y, zoom: this.camFrom.zoom * (1 + 0.06 * p) };
      this.r.clampCam();
      this.r.motionBlur = 0;
    }

    // ---- interpolated state ----
    const troops = A.troops.map((a, i) => Math.round(lerp(a, B.troops[i], easeInOut(f))));
    const ctrl = A.ctrl.slice();
    this.capturedAt.forEach((to, p) => (ctrl[p] = to));
    if (this.t >= this.total - 1) for (let i = 0; i < ctrl.length; i++) ctrl[i] = frames[nDays].ctrl[i];

    const byId = new Map<number, ColSnap>();
    for (const c of A.cols) byId.set(c.id, c);
    const cols: ColView[] = [];
    for (const cb of B.cols) {
      const ca = byId.get(cb.id);
      if (ca?.gone) continue;
      const samePath = ca && ca.path.join() === cb.path.join();
      const r = this.routeOf(cb);
      const ub = this.uOf(cb);
      const ua = ca && samePath ? this.uOf(ca) : ub;
      let alpha = 1;
      if (cb.gone) alpha = 1 - clamp((f - 0.6) / 0.4, 0, 1);
      else if (!ca) alpha = Math.min(1, f * 4);
      const tr = lerp(ca?.troops ?? cb.troops, cb.troops, f);
      // formation: column while marching, line along the border when closing in / fighting,
      // then back to column once through
      const a = cb.path[cb.idx], b = cb.path[cb.idx + 1];
      const prog = ca && samePath && ca.idx === cb.idx ? lerp(ca.prog, cb.prog, f) : cb.prog;
      let lineK = 0;
      if (b !== undefined && cb.kind !== 'mundur') {
        const enemyAhead = ctrl[b] !== cb.owner;
        if (cb.fighting) lineK = ca?.fighting ? 1 : Math.min(1, 0.35 + f * 2);
        else if (enemyAhead && prog >= 0.15 && prog <= 0.5) lineK = (prog - 0.15) / 0.35;
        else if (!enemyAhead && A.ctrl[b] !== cb.owner && prog > 0.45 && prog < 0.85) lineK = 1 - (prog - 0.45) / 0.4;
      }
      cols.push({
        lineA: a,
        lineB: b ?? -1,
        lineK: clamp(lineK, 0, 1),
        owner: cb.owner,
        route: r.route,
        u: lerp(ua, ub, f),
        troops: Math.round(tr),
        fighting: cb.fighting,
        kind: cb.kind,
        alpha,
        drawn: r.drawn,
        width: clamp(4 + Math.log2(Math.max(1, tr / 4000)) * 2.2, 4, 12),
      });
    }
    this.annex = this.annex.filter((a) => this.r.fx.time < a.t0 + a.dur + 900);
    const vt = this.r.fx.time;
    const dets: DetachView[] = this.dets.map((d) => ({
      owner: d.owner, from: d.from, a: d.a, b: d.b, troops: d.troops,
      k: clamp((vt - d.t0) / 1400, 0, 1),
      alpha: this.t >= this.total - 600 ? clamp((this.total - this.t) / 600, 0, 1) : 1,
    }));
    return {
      troops, ctrl, cols, dets, annex: this.annex, flash: this.flash, spotlight: this.spotlight,
      day: Math.min(nDays, Math.floor(tt)), done: this.t >= this.total,
    };
  }

  /** A missile from the attacker's rear into (x, y). */
  private missileInto(owner: number, x: number, y: number, boom: number, delay = 0) {
    const k = this.prev.countries[owner];
    const P = this.map.provinces;
    const from = k && k.capital >= 0 ? P[k.capital] : { x: x - 120, y: y - 80 };
    // launch from a point between the rear and the target so arcs stay on screen
    const sx = lerp(from.x, x, 0.45) + (Math.random() - 0.5) * 60;
    const sy = lerp(from.y, y, 0.45) + (Math.random() - 0.5) * 60;
    this.r.fx.missile({ x: sx, y: sy }, { x, y }, delay, 900 + Math.random() * 500, boom);
  }

  private fire(sc: Scheduled) {
    const ev = sc.ev;
    const fx = this.r.fx;
    const P = this.map.provinces;
    switch (ev.t) {
      case 'battle': {
        const k = clamp(Math.log10(Math.max(1000, ev.size)) - 3, 0.3, 3);
        fx.reticle(ev.x, ev.y, 26 + k * 10, 0, this.dayDur * 1.2);
        fx.explode(ev.x, ev.y, 16 + k * 7, 0, true);
        for (let i = 0; i < 2; i++) this.missileInto(ev.atk[0], ev.x + (Math.random() - 0.5) * 20, ev.y + (Math.random() - 0.5) * 20, 10 + k * 3, 300 + i * 500);
        if (ev.size > 20000) fx.haze(ev.x, ev.y, 30 + k * 12, 400, this.dayDur * 2);
        this.battles.push({ x: ev.x, y: ev.y, size: ev.size, until: sc.day * this.dayDur, atk: ev.atk[0] });
        this.onSound?.('boom', 1);
        break;
      }
      case 'capture': {
        const bb = P[ev.prov].bbox;
        const maxR = Math.hypot(Math.max(ev.ex - bb.x0, bb.x1 - ev.ex), Math.max(ev.ey - bb.y0, bb.y1 - ev.ey));
        const dur = clamp((maxR * 1.3 + 20) / FRONT_SPEED, 1200, 4600) * (ev.how === 'serap' ? 1.15 : 1);
        this.capturedAt.set(ev.prov, ev.to);
        this.annex.push({ prov: ev.prov, from: ev.from, to: ev.to, ex: ev.ex, ey: ev.ey, t0: fx.time, dur });
        if (ev.how === 'serbu') fx.explode(ev.ex, ev.ey, 14, 0, false);
        this.onSound?.('capture', 1);
        break;
      }
      case 'moment': {
        this.onMoment?.(ev.text, this.prev.countries[ev.country]?.color ?? '#fff', ev.kind);
        this.onSound?.('moment', 1);
        if (ev.kind === 'ibukota' || ev.kind === 'dikepung') {
          this.spotlight = { x: ev.x, y: ev.y, t0: performance.now() };
          fx.explode(ev.x, ev.y, 30, 0, true);
          fx.haze(ev.x, ev.y, 50, 300, this.dayDur * 2.5);
          if (this.autoCam) this.focus(ev.x, ev.y, Math.min(2.2, this.r.cam.zoom * 1.3), 700);
        }
        break;
      }
      case 'air': {
        const k = this.prev.countries[ev.owner];
        const cap = k.capital >= 0 ? P[k.capital] : { x: ev.x, y: ev.y };
        fx.reticle(ev.x, ev.y, ev.r * 0.6, 0, this.dayDur * 7);
        for (let i = 0; i < 4; i++) fx.plane(k.color, { x: cap.x + i * 14, y: cap.y - i * 9 }, { x: ev.x, y: ev.y }, ev.r * (0.5 + i * 0.15), i * 400, this.dayDur * 6);
        for (let i = 0; i < 8; i++) this.missileInto(ev.owner, ev.x + (Math.random() - 0.5) * ev.r, ev.y + (Math.random() - 0.5) * ev.r, 12, 1500 + i * this.dayDur * 0.7);
        this.onSound?.('plane', 1);
        break;
      }
      case 'detach': {
        // the guard leaves from wherever its column is right now
        const P2 = this.map.provinces;
        let from: Pt = { x: P2[ev.prov].x, y: P2[ev.prov].y };
        const col = this.res.frames[sc.day]?.cols.find((c) => c.id === ev.col);
        if (col) {
          const r = this.routeOf(col);
          const i = Math.min(col.idx, r.nodes.length - 1);
          const u = r.nodes[i];
          let L = 0, acc = 0;
          for (let j = 1; j < r.route.length; j++) L += Math.hypot(r.route[j].x - r.route[j - 1].x, r.route[j].y - r.route[j - 1].y);
          for (let j = 1; j < r.route.length; j++) {
            const seg = Math.hypot(r.route[j].x - r.route[j - 1].x, r.route[j].y - r.route[j - 1].y);
            if (acc + seg >= u * L) { const t = seg ? (u * L - acc) / seg : 0; from = { x: lerp(r.route[j - 1].x, r.route[j].x, t), y: lerp(r.route[j - 1].y, r.route[j].y, t) }; break; }
            acc += seg;
          }
        }
        this.dets.push({ owner: ev.owner, from, a: ev.prov, b: ev.toward, troops: ev.troops, t0: this.r.fx.time });
        break;
      }
      case 'amphib': {
        // landing sequence: reticle → ships → missile trails → impact → zone label
        const k = this.prev.countries[ev.owner];
        const a = P[ev.from], b = P[ev.to];
        fx.reticle(b.x, b.y, 45, 0, this.dayDur * 4);
        fx.reticle(b.x, b.y, 25, 200, this.dayDur * 3);
        for (let i = 0; i < 5; i++) fx.ship(k.color, { x: a.x + (i - 2) * 9, y: a.y + Math.abs(i - 2) * 7 }, { x: b.x + (i - 2) * 6, y: b.y }, i * 220, this.dayDur * 1.6);
        for (let i = 0; i < 4; i++) this.missileInto(ev.owner, b.x + (Math.random() - 0.5) * 30, b.y + (Math.random() - 0.5) * 30, 14, 600 + i * 260);
        fx.explode(b.x, b.y, 26, 1600, true);
        fx.haze(b.x, b.y, 40, 1800, this.dayDur * 3);
        fx.label('ZONA PENDARATAN', b.x, b.y - 30, 900, this.total);
        break;
      }
    }
  }

  /** Background motion: patrol flights between own provinces and ships along straits. */
  ambient(state: GameState) {
    const fx = this.r.fx;
    const P = this.map.provinces;
    const majors = state.countries.filter((k) => k.alive && k.kind !== 'minor');
    if (!majors.length) return;
    const k = majors[Math.floor(Math.random() * majors.length)];
    const own = state.provs.map((p, i) => (p.ctrl === k.id ? i : -1)).filter((i) => i >= 0);
    if (own.length < 2) return;
    const a = P[own[Math.floor(Math.random() * own.length)]], b = P[own[Math.floor(Math.random() * own.length)]];
    const L = Math.hypot(a.x - b.x, a.y - b.y);
    if (L > 80) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) fx.plane(k.color, { x: a.x + i * 10, y: a.y + i * 6 }, { x: b.x + i * 10, y: b.y + i * 6 }, 0, i * 200, clamp(L / 0.035, 4000, 12000), false);
    }
    if (Math.random() < 0.5) {
      const ports = own.filter((i) => state.provs[i].port && P[i].seaLinks.length);
      if (ports.length) {
        const p = ports[Math.floor(Math.random() * ports.length)];
        const q = P[p].seaLinks[Math.floor(Math.random() * P[p].seaLinks.length)];
        const dist = Math.hypot(P[q].x - P[p].x, P[q].y - P[p].y);
        for (let i = 0; i < 3; i++) fx.ship(k.color, { x: P[p].x + i * 7, y: P[p].y + i * 5 }, { x: P[q].x + i * 7, y: P[q].y + i * 5 }, i * 350, clamp(dist / 0.02, 5000, 14000));
      }
    }
  }
}
