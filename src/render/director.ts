import { clamp, easeInOut, lerp, type Pt } from '../core/geom';
import type { GameMap } from '../map/types';
import type { ColSnap, GameState, Resolution, SimEvent } from '../sim/types';
import type { AnnexAnim, ColView, Renderer } from './renderer';

export interface DirectorFrame {
  troops: number[];
  ctrl: number[];
  cols: ColView[];
  annex: AnnexAnim[];
  flash: Map<number, number>;
  spotlight: { x: number; y: number; t0: number } | null;
  day: number;
  done: boolean;
}

/**
 * Replays a resolution log as a cinematic: interpolates columns & counters per day,
 * fires effects, and drives an automatic "director" camera.
 */
export class Director {
  dayDur = 1700;
  speed = 1;
  paused = false;
  autoCam = true;
  t = 0;
  private lastNow = 0;
  private res!: Resolution;
  private prev!: GameState;
  private firedDay = -1;
  private firedCapture = new Set<string>();
  private firedMoment = new Set<string>();
  private annex: AnnexAnim[] = [];
  private flash = new Map<number, number>();
  private capturedAt = new Map<number, { to: number; t: number }>();
  private battles: { x: number; y: number; size: number }[] = [];
  private lastBoom = 0;
  private spotlight: DirectorFrame['spotlight'] = null;
  private camAnim: { from: { x: number; y: number; zoom: number }; to: { x: number; y: number; zoom: number }; t0: number; dur: number } | null = null;

  onMoment?: (text: string, color: string, kind: string) => void;
  onDay?: (day: number) => void;
  onSound?: (kind: 'boom' | 'capture' | 'moment' | 'plane', intensity: number) => void;

  constructor(private r: Renderer, private map: GameMap) {}

  get total() {
    return (this.res.frames.length - 1) * this.dayDur + 900;
  }

  start(prev: GameState, res: Resolution, now: number) {
    this.prev = prev;
    this.res = res;
    this.restart(now);
  }

  restart(now: number) {
    this.t = 0;
    this.lastNow = now;
    this.firedDay = -1;
    this.firedCapture.clear();
    this.firedMoment.clear();
    this.annex = [];
    this.flash.clear();
    this.capturedAt.clear();
    this.battles = [];
    this.spotlight = null;
    this.camAnim = null;
    this.r.fx.clear();
    this.paused = false;
  }

  skip() {
    this.t = this.total;
  }

  private focus(x: number, y: number, zoom: number, now: number, dur = 450) {
    const c = this.r.cam;
    const d = Math.hypot(c.x - x, c.y - y) * c.zoom;
    if (d < 30 && Math.abs(c.zoom - zoom) < 0.05) return;
    this.camAnim = { from: { ...c }, to: { x, y, zoom }, t0: now, dur };
  }

  private uOf(route: Pt[], segs: number, idx: number, prog: number): number {
    // route built with 10 samples per segment (Catmull–Rom), convert to length fraction
    const fi = clamp((idx + prog) * 10, 0, route.length - 1);
    let total = 0, upto = 0;
    for (let i = 1; i < route.length; i++) {
      const l = Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
      if (i <= Math.floor(fi)) upto += l;
      else if (i === Math.floor(fi) + 1) upto += l * (fi - Math.floor(fi));
      total += l;
    }
    void segs;
    return total ? upto / total : 0;
  }

  update(now: number): DirectorFrame {
    const dt = now - this.lastNow;
    this.lastNow = now;
    if (!this.paused) this.t = clamp(this.t + Math.max(0, dt) * this.speed, 0, this.total);
    const frames = this.res.frames;
    const nDays = frames.length - 1;
    const tt = this.t / this.dayDur;
    const d = clamp(Math.floor(tt) + 1, 1, nDays); // interval (d-1 → d)
    const f = clamp(tt - (d - 1), 0, 1);
    const A = frames[d - 1], B = frames[d];

    // ---- fire day-start events ----
    if (d !== this.firedDay && this.t < this.total) {
      this.firedDay = d;
      this.onDay?.(d);
      this.battles = [];
      if (d === 1) this.fireEvents(frames[0].events, now);
      this.fireEvents(B.events, now);
      for (let i = 0; i < B.troops.length; i++) if (B.troops[i] < A.troops[i] * 0.8 && A.troops[i] > 1000) this.flash.set(i, now);
      if (this.autoCam) {
        const big = B.events.filter((e): e is Extract<SimEvent, { t: 'battle' }> => e.t === 'battle').sort((a, b) => b.size - a.size)[0];
        const fit = Math.min(this.r.W / this.map.w, this.r.H / this.map.h);
        if (big) this.focus(big.x, big.y, clamp(fit * 2.3, fit, 1.5), now);
        else {
          const moving = B.cols.filter((c) => !c.gone);
          if (moving.length) {
            let sx = 0, sy = 0;
            for (const c of moving) { const p = this.map.provinces[c.path[Math.min(c.idx + 1, c.path.length - 1)]]; sx += p.x; sy += p.y; }
            this.focus(sx / moving.length, sy / moving.length, clamp(fit * 1.6, fit, 1.2), now);
          }
        }
      }
    }

    // ---- captures mid-day ----
    for (const e of B.events) {
      if (e.t === 'capture' && f >= 0.45) {
        const key = d + ':' + e.prov;
        if (!this.firedCapture.has(key)) {
          this.firedCapture.add(key);
          this.capturedAt.set(e.prov, { to: e.to, t: this.t });
          this.annex.push({ prov: e.prov, from: e.from, to: e.to, ex: e.ex, ey: e.ey, t0: now, dur: 750 });
          this.onSound?.('capture', 1);
        }
      }
      if (e.t === 'moment' && f >= 0.3) {
        const key = d + ':' + e.text + e.x;
        if (!this.firedMoment.has(key)) {
          this.firedMoment.add(key);
          this.onMoment?.(e.text, this.prev.countries[e.country]?.color ?? '#fff', e.kind);
          this.onSound?.('moment', 1);
          if (e.kind === 'ibukota' || e.kind === 'dikepung') {
            this.spotlight = { x: e.x, y: e.y, t0: now };
            if (this.autoCam) this.focus(e.x, e.y, Math.min(2.2, this.r.cam.zoom * 1.3), now, 500);
          }
        }
      }
    }

    // ---- ongoing battle fireworks ----
    if (!this.paused && this.battles.length && now - this.lastBoom > 110 / this.speed) {
      this.lastBoom = now;
      const b = this.battles[Math.floor(Math.random() * this.battles.length)];
      const intensity = clamp(Math.log10(Math.max(1000, b.size)) - 3, 0.3, 3);
      const spread = 18;
      this.r.fx.explode(b.x + (Math.random() - 0.5) * spread, b.y + (Math.random() - 0.5) * spread, 10 + intensity * 9 * Math.random() + 6, now);
      this.onSound?.('boom', intensity / 3);
    }

    // ---- camera ----
    if (this.camAnim) {
      const k = clamp((now - this.camAnim.t0) / this.camAnim.dur, 0, 1);
      const e = easeInOut(k);
      const { from, to } = this.camAnim;
      const nx = lerp(from.x, to.x, e), ny = lerp(from.y, to.y, e);
      const speedPx = Math.hypot(nx - this.r.cam.x, ny - this.r.cam.y) * this.r.cam.zoom;
      this.r.motionBlur = clamp(speedPx / 6, 0, 10);
      this.r.cam.x = nx;
      this.r.cam.y = ny;
      this.r.cam.zoom = lerp(from.zoom, to.zoom, e);
      this.r.clampCam();
      if (k >= 1) { this.camAnim = null; this.r.motionBlur = 0; }
    } else this.r.motionBlur = 0;

    // ---- interpolated state ----
    const troops = A.troops.map((a, i) => Math.round(lerp(a, B.troops[i], easeInOut(f))));
    const ctrl = A.ctrl.slice();
    this.capturedAt.forEach((c, p) => (ctrl[p] = c.to));
    if (this.t >= this.total - 1) for (let i = 0; i < ctrl.length; i++) ctrl[i] = B.ctrl[i];

    const byId = new Map<number, ColSnap>();
    for (const c of A.cols) byId.set(c.id, c);
    const cols: ColView[] = [];
    for (const cb of B.cols) {
      const ca = byId.get(cb.id);
      const samePath = ca && ca.path.join() === cb.path.join();
      const route = this.r.route(cb.path);
      const segs = cb.path.length - 1;
      const ub = this.uOf(route, segs, cb.idx, cb.prog);
      const ua = ca && samePath ? this.uOf(route, segs, ca.idx, ca.prog) : ub;
      if (ca?.gone) continue;
      let alpha = 1;
      if (cb.gone) alpha = 1 - f;
      else if (!ca) alpha = Math.min(1, f * 3);
      cols.push({
        owner: cb.owner,
        route,
        u: lerp(ua, ub, easeInOut(f)),
        troops: Math.round(lerp(ca?.troops ?? cb.troops, cb.troops, f)),
        fighting: cb.fighting,
        kind: cb.kind,
        alpha,
      });
    }
    this.annex = this.annex.filter((a) => now - a.t0 < a.dur + 600);
    return {
      troops, ctrl, cols, annex: this.annex, flash: this.flash, spotlight: this.spotlight,
      day: Math.min(nDays, Math.floor(tt)), done: this.t >= this.total,
    };
  }

  private fireEvents(evs: SimEvent[], now: number) {
    const P = this.map.provinces;
    for (const e of evs) {
      if (e.t === 'battle') {
        this.battles.push({ x: e.x, y: e.y, size: e.size });
        this.r.fx.explode(e.x, e.y, 22 + Math.min(18, e.size / 20000), now);
      } else if (e.t === 'air') {
        const k = this.prev.countries[e.owner];
        const cap = k.capital >= 0 ? P[k.capital] : { x: e.x, y: e.y };
        for (let i = 0; i < 3; i++) this.r.fx.plane(k.color, { x: cap.x + i * 12, y: cap.y - i * 8 }, { x: e.x, y: e.y }, e.r * (0.6 + i * 0.2), now + i * 300, this.dayDur * 7 / this.speed);
        this.onSound?.('plane', 1);
      } else if (e.t === 'amphib') {
        const k = this.prev.countries[e.owner];
        const a = P[e.from], b = P[e.to];
        for (let i = 0; i < 3; i++) this.r.fx.ship(k.color, { x: a.x + i * 6, y: a.y + i * 6 }, { x: b.x, y: b.y }, now + i * 250, this.dayDur * 3 / this.speed);
        this.r.fx.pulse(b.x, b.y, '#ffffff', now);
        this.onMoment?.('PENDARATAN', k.color, 'terobosan');
      }
    }
  }
}
