import { catmullRom, clamp, pointAlong, polyLength, subPath, type Pt } from '../core/geom';
import { Rng } from '../core/rng';
import type { GameMap } from '../map/types';
import { atWar } from '../sim/rules';
import type { GameState, Order, Theme, UnitType } from '../sim/types';
import { BUILD_ICON_D, TYPE_ORDER, drawIconBadge, drawUnitSymbol } from './symbols';
import { Effects } from './effects';
import { buildBase, type BaseLayers } from './terrain';

/** odds: undefined = not an attack, null = target hidden by fog, number = attacker:defender estimate. */
export interface DrawnOrder { order: Order; valid: boolean; reason?: string; selected?: boolean; odds?: number | null }
export interface ColView {
  owner: number;
  route: Pt[];
  u: number;
  troops: number;
  fighting: boolean;
  kind: 'serang' | 'gerak' | 'mundur';
  alpha: number;
  types: UnitType[];
}
export interface UnitView { id: number; owner: number; type: UnitType; prov: number; str: number; org: number; group: number }
/**
 * A province being taken. k runs 0→1 while the attacker's colour spreads from the entry point
 * along the column's route (u0 → u), then 1→1.35 for the closing border pulse.
 */
export interface AnnexAnim { prov: number; from: number; to: number; ex: number; ey: number; k: number; route?: Pt[]; u0?: number; u?: number }
/** A route polyline plus the arc fraction (0..1) of every province node on it. */
export interface RouteInfo { pts: Pt[]; knots: number[] }

export interface View {
  state: GameState;
  viewer: number; // -1 = public
  visible: Uint8Array | null;
  troops: number[];
  ctrl: number[];
  orders: DrawnOrder[];
  orderOwner: number;
  intel: { orders: Order[]; owner: number } | null;
  draft: { pts: Pt[]; color: string; dashed: boolean; width: number; odds?: number | null } | null;
  cols: ColView[];
  units: UnitView[];
  selectedUnits: Set<number>;
  annex: AnnexAnim[];
  flash: Map<number, number>;
  selectedProv: number;
  mode: 'plan' | 'play' | 'idle' | 'curtain';
  spotlight: { x: number; y: number; t0: number } | null;
  colorblind: boolean;
}

export interface Camera { x: number; y: number; zoom: number }

/** Odds thresholds for the planning badge (attacker:defender, before losses). */
export const ODDS_GOOD = 2.0;
export const ODDS_EVEN = 1.3;

const COUNTER_FONT = "'Barlow Condensed', 'Oswald', 'Arial Narrow', 'Roboto Condensed', sans-serif";

export function fmtCompact(n: number): string {
  n = Math.round(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2).replace('.', ',') + ' jt';
  if (n >= 10_000) return Math.round(n / 1000) + ' rb';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + ' rb';
  return String(n);
}

export function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex: string, k: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const f = (v: number) => Math.round(clamp(k > 0 ? v + (255 - v) * k : v * (1 + k), 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function cumulative(pts: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return out;
}

/** Arc fraction at the given sample indices of a polyline. */
function arcKnots(pts: Pt[], idx: number[]): number[] {
  const cum = cumulative(pts);
  const total = cum[cum.length - 1] || 1;
  return idx.map((i) => cum[i] / total);
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: GameMap;
  theme: Theme = 'satelit';
  cam: Camera = { x: 0, y: 0, zoom: 1 };
  fx = new Effects();
  dpr = 1;
  W = 0;
  H = 0;
  motionBlur = 0;
  private bases = new Map<Theme, BaseLayers>();
  private provPath: Path2D[] = [];
  private internalPath = new Path2D();
  private coastPath = new Path2D();
  private wobbly: Pt[][] = [];
  private patterns = new Map<string, CanvasPattern>();
  private borderKey = '';
  private nationalPath = new Path2D();
  private frontArcs: number[] = [];
  private labels: { c: number; x: number; y: number; size: number; text: string }[] = [];
  private routeCache = new Map<string, Pt[]>();
  private infoCache = new Map<string, RouteInfo>();
  private unitHits: { id: number; prov: number; x: number; y: number; w: number; h: number }[] = [];

  constructor(canvas: HTMLCanvasElement, map: GameMap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.map = map;
    for (const p of map.provinces) {
      const path = new Path2D();
      for (const loop of p.loops) {
        loop.forEach((pt, i) => (i ? path.lineTo(pt.x, pt.y) : path.moveTo(pt.x, pt.y)));
        path.closePath();
      }
      this.provPath.push(path);
    }
    const rng = new Rng(map.params.seed ^ 0x77);
    map.arcs.forEach((arc) => {
      const target = arc.a < 0 ? this.coastPath : this.internalPath;
      arc.pts.forEach((pt, i) => (i ? target.lineTo(pt.x, pt.y) : target.moveTo(pt.x, pt.y)));
      // hand-drawn wobble for front lines
      const ph = rng.next() * 100;
      this.wobbly.push(arc.pts.map((pt, i) => {
        const prev = arc.pts[Math.max(0, i - 1)], next = arc.pts[Math.min(arc.pts.length - 1, i + 1)];
        const dx = next.x - prev.x, dy = next.y - prev.y;
        const l = Math.hypot(dx, dy) || 1;
        const end = i === 0 || i === arc.pts.length - 1 ? 0 : 1;
        const w = Math.sin(i * 0.7 + ph) * 1.6 * end;
        return { x: pt.x - (dy / l) * w, y: pt.y + (dx / l) * w };
      }));
    });
    this.cam = { x: map.w / 2, y: map.h / 2, zoom: 0.5 };
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    if (!this.bases.has(theme)) this.bases.set(theme, buildBase(this.map, theme));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  fitAll() {
    const z = Math.min(this.W / this.map.w, this.H / this.map.h) * 1.02;
    this.cam = { x: this.map.w / 2, y: this.map.h / 2, zoom: z };
  }

  minZoom() {
    return Math.min(this.W / this.map.w, this.H / this.map.h) * 0.8;
  }

  /** Keep the viewport inside the world where possible (no void beyond the map edge). */
  clampCam() {
    this.cam.zoom = clamp(this.cam.zoom, this.minZoom(), 6);
    const hw = this.W / 2 / this.cam.zoom, hh = this.H / 2 / this.cam.zoom;
    this.cam.x = hw * 2 >= this.map.w ? this.map.w / 2 : clamp(this.cam.x, hw, this.map.w - hw);
    this.cam.y = hh * 2 >= this.map.h ? this.map.h / 2 : clamp(this.cam.y, hh, this.map.h - hh);
  }

  screenToWorld(sx: number, sy: number): Pt {
    return { x: (sx - this.W / 2) / this.cam.zoom + this.cam.x, y: (sy - this.H / 2) / this.cam.zoom + this.cam.y };
  }
  worldToScreen(wx: number, wy: number): Pt {
    return { x: (wx - this.cam.x) * this.cam.zoom + this.W / 2, y: (wy - this.cam.y) * this.cam.zoom + this.H / 2 };
  }

  provinceAt(wx: number, wy: number): number {
    const m = this.map;
    const gx = Math.floor(wx / m.cell), gy = Math.floor(wy / m.cell);
    if (gx < 0 || gy < 0 || gx >= m.gw || gy >= m.gh) return -1;
    return m.cellProv[gy * m.gw + gx];
  }

  /** Smooth route polyline through province anchors. */
  route(path: number[]): Pt[] {
    const key = path.join(',');
    let r = this.routeCache.get(key);
    if (!r) {
      const pts = path.map((i) => ({ x: this.map.provinces[i].x, y: this.map.provinces[i].y }));
      r = catmullRom(pts, 10);
      if (this.routeCache.size > 2000) this.routeCache.clear();
      this.routeCache.set(key, r);
    }
    return r;
  }

  /**
   * Route for a column/order. With the player's stroke, the column follows the drawn line:
   * the stroke is pinned to the source and target province anchors and each province on the
   * path is mapped to its nearest position along it. Falls back to the province route when
   * the pathfinder had to leave the drawn line (e.g. around a sea).
   */
  routeInfo(path: number[], stroke?: Pt[]): RouteInfo {
    const key = path.join(',') + (stroke ? '|' + stroke.length + ':' + Math.round(stroke[0].x) + ',' + Math.round(stroke[stroke.length - 1].y) : '');
    const hit = this.infoCache.get(key);
    if (hit) return hit;
    const P = this.map.provinces;
    const fromCentres = (): RouteInfo => {
      const pts = this.route(path);
      return { pts, knots: arcKnots(pts, path.map((_, i) => Math.min(pts.length - 1, i * 10))) };
    };
    let info: RouteInfo;
    if (!stroke || stroke.length < 2 || path.length < 2) info = fromCentres();
    else {
      const raw = stroke.map((p) => ({ x: p.x, y: p.y }));
      raw[0] = { x: P[path[0]].x, y: P[path[0]].y };
      const end = P[path[path.length - 1]];
      if (Math.hypot(raw[raw.length - 1].x - end.x, raw[raw.length - 1].y - end.y) > 4) raw.push({ x: end.x, y: end.y });
      else raw[raw.length - 1] = { x: end.x, y: end.y };
      const pts = catmullRom(raw, 4);
      const cum = cumulative(pts);
      const total = cum[cum.length - 1] || 1;
      let ok = true;
      const knots: number[] = [];
      path.forEach((id, i) => {
        if (i === 0) { knots.push(0); return; }
        if (i === path.length - 1) { knots.push(1); return; }
        let bd = Infinity, bu = 0;
        for (let j = 0; j < pts.length; j++) {
          const d = Math.hypot(pts[j].x - P[id].x, pts[j].y - P[id].y);
          if (d < bd) { bd = d; bu = cum[j] / total; }
        }
        if (bd > Math.sqrt(P[id].area) * 0.9 + 12) ok = false;
        knots.push(Math.max(bu, knots[i - 1] + 0.002));
      });
      info = ok && knots.every((k, i) => i === 0 || k > knots[i - 1]) && knots[knots.length - 2] < 1
        ? { pts, knots } : fromCentres();
    }
    if (this.infoCache.size > 1500) this.infoCache.clear();
    this.infoCache.set(key, info);
    return info;
  }

  /** Arc fraction for a column at segment idx with progress prog. */
  uAt(info: RouteInfo, idx: number, prog: number): number {
    const a = info.knots[Math.min(idx, info.knots.length - 1)] ?? 1;
    const b = info.knots[Math.min(idx + 1, info.knots.length - 1)] ?? 1;
    return clamp(a + (b - a) * clamp(prog, 0, 1), 0, 1);
  }

  private dotPattern(color: string, dense = false): CanvasPattern {
    const key = color + dense;
    let p = this.patterns.get(key);
    if (p) return p;
    const c = document.createElement('canvas');
    const s = dense ? 6 : 9;
    c.width = c.height = s;
    const x = c.getContext('2d')!;
    x.fillStyle = color;
    x.beginPath();
    x.arc(s / 2, s / 2, dense ? 1.5 : 1.7, 0, Math.PI * 2);
    x.fill();
    p = this.ctx.createPattern(c, 'repeat')!;
    this.patterns.set(key, p);
    return p;
  }

  private hatchPattern(kind: number, color: string): CanvasPattern {
    const key = 'h' + kind + color;
    let p = this.patterns.get(key);
    if (p) return p;
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const x = c.getContext('2d')!;
    x.strokeStyle = color;
    x.lineWidth = 1.6;
    x.beginPath();
    const k = kind % 7;
    if (k === 0 || k === 5) { x.moveTo(0, 12); x.lineTo(12, 0); }
    if (k === 1 || k === 5) { x.moveTo(0, 0); x.lineTo(12, 12); }
    if (k === 2 || k === 6) { x.moveTo(0, 6); x.lineTo(12, 6); }
    if (k === 3 || k === 6) { x.moveTo(6, 0); x.lineTo(6, 12); }
    x.stroke();
    if (k === 4) { x.fillStyle = color; x.fillRect(4, 4, 3, 3); }
    p = this.ctx.createPattern(c, 'repeat')!;
    this.patterns.set(key, p);
    return p;
  }

  private rebuildBorders(state: GameState, ctrl: number[]) {
    const key = ctrl.join(',') + '|' + state.rel.map((r) => r.map((x) => x.status[0]).join('')).join('');
    if (key === this.borderKey) return;
    this.borderKey = key;
    this.nationalPath = new Path2D();
    this.frontArcs = [];
    this.map.arcs.forEach((arc, i) => {
      if (arc.a < 0) return;
      const ca = ctrl[arc.a], cb = ctrl[arc.b];
      if (ca === cb) return;
      arc.pts.forEach((pt, k) => (k ? this.nationalPath.lineTo(pt.x, pt.y) : this.nationalPath.moveTo(pt.x, pt.y)));
      if (atWar(state, ca, cb)) this.frontArcs.push(i);
    });
    // country labels on largest connected blob
    const P = this.map.provinces;
    const seen = new Uint8Array(P.length);
    const best = new Map<number, { area: number; x: number; y: number }>();
    for (let i = 0; i < P.length; i++) {
      if (seen[i]) continue;
      const c = ctrl[i];
      let area = 0, sx = 0, sy = 0;
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const j = st.pop()!;
        area += P[j].area;
        sx += P[j].x * P[j].area;
        sy += P[j].y * P[j].area;
        for (const n of P[j].neighbors) if (!seen[n] && ctrl[n] === c) { seen[n] = 1; st.push(n); }
      }
      const b = best.get(c);
      if (!b || area > b.area) best.set(c, { area, x: sx / area, y: sy / area });
    }
    this.labels = [];
    best.forEach((b, c) => {
      const k = state.countries[c];
      if (!k) return;
      const words = k.name.split(' ');
      const text = (k.name.length <= 12 ? k.name : words[words.length - 1]).toUpperCase();
      this.labels.push({ c, x: b.x, y: b.y, size: clamp((Math.sqrt(b.area) * 0.55 * 7) / Math.max(5, text.length), 9, 46), text });
    });
  }

  private layer: HTMLCanvasElement | null = null;
  private layerKey = '';

  /**
   * Static map layers (terrain, political fill, borders, front lines, fog) are
   * cached in an offscreen canvas and rebuilt only when something changes.
   */
  private ensureLayer(v: View, now: number, z: number, S: number, annexFrom: Map<number, number>) {
    const s = v.state;
    let occ = '';
    for (let i = 0; i < s.provs.length; i++) {
      const ps = s.provs[i];
      occ += annexFrom.has(i) ? '0' : v.ctrl[i] !== ps.owner || (ps.integration < 1 && v.ctrl[i] === ps.ctrl) ? '1' : '0';
    }
    let vis = '';
    if (v.visible) for (let i = 0; i < v.visible.length; i++) vis += v.visible[i];
    const urban = s.provs.map((p) => p.urban).join('');
    // provinces mid-annexation still show their previous owner → no rebuild until the wipe ends
    const eff = v.ctrl.map((c, i) => annexFrom.get(i) ?? c);
    const key = [this.theme, S, Math.round(Math.log2(z) * 3), eff.join(','), occ, vis, urban, v.colorblind,
      s.rel.map((r) => r.map((x) => x.status[0]).join('')).join('')].join('|');
    if (key === this.layerKey && this.layer) return;
    this.layerKey = key;
    const W = Math.round(this.map.w * S), H = Math.round(this.map.h * S);
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) {
      this.layer = document.createElement('canvas');
      this.layer.width = W;
      this.layer.height = H;
    }
    const lctx = this.layer.getContext('2d')!;
    lctx.setTransform(S, 0, 0, S, 0, 0);
    lctx.clearRect(0, 0, this.map.w, this.map.h);
    const base = this.bases.get(this.theme)!;
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(base.canvas, 0, 0, this.map.w, this.map.h);
    const main = this.ctx;
    this.ctx = lctx;
    try { this.drawLayers(v, now, z, annexFrom); } finally { this.ctx = main; }
  }

  private drawLayers(v: View, _now: number, z: number, annexFrom: Map<number, number>) {
    const { ctx, map } = this;
    const sat = this.theme === 'satelit';
    const s = v.state;
    const P = map.provinces;
    const fillA = sat ? 0.4 : 0.3;
    // ---- political fill ----
    for (let i = 0; i < P.length; i++) {
      const from = annexFrom.get(i);
      const c = from ?? v.ctrl[i];
      const k = s.countries[c];
      if (!k) continue;
      ctx.fillStyle = hexA(k.color, fillA);
      ctx.fill(this.provPath[i]);
      if (v.colorblind) {
        ctx.fillStyle = this.hatchPattern(k.pattern, sat ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)');
        ctx.fill(this.provPath[i]);
      }
      const ps = s.provs[i];
      if (from === undefined && (c !== ps.owner || (ps.integration < 1 && c === ps.ctrl))) {
        // occupied / being integrated: stipple like an advancing zone
        ctx.fillStyle = this.dotPattern(hexA(k.color, sat ? 0.95 : 0.8), true);
        ctx.fill(this.provPath[i]);
      }
    }
    // ---- borders ----
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = sat ? 'rgba(255,255,255,0.13)' : 'rgba(30,50,20,0.16)';
    ctx.lineWidth = 0.9 / z;
    ctx.stroke(this.internalPath);
    if (sat) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 4.5 / z;
      ctx.stroke(this.nationalPath);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2 / z;
      ctx.stroke(this.nationalPath);
      ctx.strokeStyle = 'rgba(150,200,255,0.28)';
      ctx.lineWidth = 1.4 / z;
      ctx.stroke(this.coastPath);
    } else {
      ctx.strokeStyle = 'rgba(40,40,40,0.45)';
      ctx.setLineDash([5 / z, 4 / z]);
      ctx.lineWidth = 1.3 / z;
      ctx.stroke(this.nationalPath);
      ctx.setLineDash([]);
    }
    // ---- front lines ----
    for (const ai of this.frontArcs) {
      const arc = map.arcs[ai];
      if (sat) {
        for (const side of [arc.a, arc.b]) {
          const k = s.countries[v.ctrl[side]];
          if (!k) continue;
          ctx.save();
          ctx.clip(this.provPath[side]);
          ctx.strokeStyle = this.dotPattern(hexA(shade(k.color, 0.25), 1), true);
          ctx.lineWidth = 16 / z;
          this.strokePts(arc.pts);
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,60,60,0.35)';
        ctx.lineWidth = 6 / z;
        this.strokePts(arc.pts);
        ctx.strokeStyle = 'rgba(255,240,230,0.95)';
        ctx.lineWidth = 1.8 / z;
        this.strokePts(arc.pts);
      } else {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 4.2 / z;
        this.strokePts(this.wobbly[ai]);
      }
    }
    // ---- city lights ----
    if (sat) for (let i = 0; i < P.length; i++) {
      const ps = s.provs[i];
      if (ps.urban <= 0) continue;
      const r = (5 + ps.urban * 4) / Math.sqrt(z);
      const g = ctx.createRadialGradient(P[i].x, P[i].y, 0, P[i].x, P[i].y, r);
      g.addColorStop(0, 'rgba(255,225,160,0.55)');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(P[i].x, P[i].y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // ---- fog of war ----
    if (v.visible) {
      ctx.fillStyle = sat ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.32)';
      for (let i = 0; i < P.length; i++) if (!v.visible[i]) ctx.fill(this.provPath[i]);
      ctx.fillStyle = this.hatchPattern(0, sat ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)');
      for (let i = 0; i < P.length; i++) if (!v.visible[i]) ctx.fill(this.provPath[i]);
    }
  }

  draw(v: View, now: number) {
    const { ctx, map } = this;
    const z = this.cam.zoom;
    const dpr = this.dpr;
    const sat = this.theme === 'satelit';
    const s = v.state;
    const shake = this.fx.shake(now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = sat ? '#060c16' : '#3a98e6';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const tx = dpr * (this.W / 2 - this.cam.x * z + shake.x);
    const ty = dpr * (this.H / 2 - this.cam.y * z + shake.y);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, tx, ty);
    const base = this.bases.get(this.theme)!;
    ctx.imageSmoothingEnabled = true;
    if (v.mode === 'curtain') {
      ctx.drawImage(base.canvas, 0, 0, map.w, map.h);
      return;
    }
    this.rebuildBorders(s, v.ctrl);
    const P = map.provinces;
    const fillA = sat ? 0.4 : 0.3;
    const annexFrom = new Map<number, number>();
    for (const a of v.annex) if (a.k < 1) annexFrom.set(a.prov, a.from);
    const px = z * dpr;
    if (px <= 1.7) {
      const S = px <= 0.8 ? 0.8 : px <= 1.15 ? 1.15 : 1.7;
      this.ensureLayer(v, now, z, S, annexFrom);
      ctx.drawImage(this.layer!, 0, 0, map.w, map.h);
    } else {
      // zoomed in: draw vectors directly for crispness
      ctx.drawImage(base.canvas, 0, 0, map.w, map.h);
      if (base.grain) { ctx.fillStyle = base.grain; ctx.fillRect(0, 0, map.w, map.h); }
      this.drawLayers(v, now, z, annexFrom);
    }

    // ---- annexation: the attacker's colour spreads along the column's route ----
    for (const an of v.annex) {
      if (an.k <= 0 || an.k >= 1) continue;
      const i = an.prov;
      const k = s.countries[an.to];
      if (!k) continue;
      const t = an.k;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const bb = P[i].bbox;
      const diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0);
      ctx.save();
      ctx.clip(this.provPath[i]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let tongue: Pt[] | null = null;
      if (an.route && an.u0 !== undefined) {
        const u1 = Math.max(an.u ?? an.u0, an.u0 + 0.001);
        tongue = subPath(an.route, an.u0, u1);
      }
      const width = 10 / z + diag * 2.3 * e;
      const paint = (lw: number, style: string | CanvasPattern) => {
        ctx.strokeStyle = style;
        ctx.fillStyle = style;
        if (tongue && tongue.length > 1) {
          ctx.lineWidth = lw;
          this.strokePts(tongue);
        } else {
          ctx.beginPath();
          ctx.arc(an.ex, an.ey, lw / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      // advancing stipple band, bright leading edge, then the solid fill
      paint(width + 26 / z, this.dotPattern(hexA(k.color, 0.95), true));
      paint(width + 4 / z, hexA(sat ? '#ffffff' : '#111111', 0.55 * (1 - e * 0.6)));
      paint(width, hexA(k.color, fillA + 0.12));
      ctx.restore();
    }
    for (const an of v.annex) {
      const t = (an.k - 1) / 0.35;
      if (t <= 0 || t > 1) continue;
      ctx.strokeStyle = sat ? `rgba(255,255,255,${0.9 * (1 - t)})` : `rgba(0,0,0,${0.7 * (1 - t)})`;
      ctx.lineWidth = (2.5 + 4 * t) / z;
      ctx.stroke(this.provPath[an.prov]);
    }

    // ---- country labels ----
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, shake.x * dpr, shake.y * dpr);
    for (const l of this.labels) {
      const sp = this.worldToScreen(l.x, l.y);
      const size = l.size * Math.min(1.6, Math.max(0.6, z * 1.2));
      if (size < 10) continue;
      ctx.font = `800 ${size}px ${COUNTER_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${size * 0.18}px`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = sat ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
      ctx.fillStyle = sat ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)';
      ctx.strokeText(l.text, sp.x, sp.y);
      ctx.fillText(l.text, sp.x, sp.y);
    }
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    ctx.restore();

    // ---- selection ----
    if (v.selectedProv >= 0) {
      ctx.strokeStyle = sat ? '#fff' : '#000';
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.lineDashOffset = -now / 60 / z;
      ctx.stroke(this.provPath[v.selectedProv]);
      ctx.setLineDash([]);
    }

    // ---- orders ----
    if (v.intel) for (const o of v.intel.orders) this.drawOrder({ order: o, valid: true }, s.countries[v.intel.owner].color, now, 0.45);
    for (const d of v.orders) this.drawOrder(d, s.countries[v.orderOwner]?.color ?? '#fff', now, 1);

    // ---- effects (world) ----
    this.fx.draw(ctx, now, z, this.theme);

    // ---- units (screen space) ----
    ctx.setTransform(dpr, 0, 0, dpr, shake.x * dpr, shake.y * dpr);
    if (v.mode !== 'idle') this.drawStacks(v, now);
    this.drawColumns(v, now);
    this.drawCapitals(v);

    // ---- draft stroke ----
    if (v.draft && v.draft.pts.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = v.draft.width + 3;
      if (v.draft.dashed) ctx.setLineDash([12, 9]);
      this.strokeScreen(v.draft.pts);
      ctx.strokeStyle = v.draft.color;
      ctx.lineWidth = v.draft.width;
      this.strokeScreen(v.draft.pts);
      ctx.restore();
      if (v.draft.odds !== undefined) {
        const end = v.draft.pts[v.draft.pts.length - 1];
        this.oddsBadge(v.draft.odds, end.x, end.y - 34 / z, true);
      }
    }

    // ---- screen-space vignette / spotlight ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sat) {
      const g = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (v.spotlight) {
      const t = (now - v.spotlight.t0) / 1400;
      if (t >= 0 && t <= 1) {
        const a = Math.sin(Math.PI * t) * 0.75;
        const sp = this.worldToScreen(v.spotlight.x, v.spotlight.y);
        const r = Math.min(this.W, this.H) * 0.22;
        const g = ctx.createRadialGradient(sp.x, sp.y, r * 0.6, sp.x, sp.y, r * 2.4);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${a})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.W, this.H);
      }
    }
  }

  private strokePts(pts: Pt[]) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.stroke();
  }
  private strokeScreen(pts: Pt[]) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => {
      const s = this.worldToScreen(p.x, p.y);
      if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y);
    });
    c.stroke();
  }

  /** Marker-style arrow along a world polyline. */
  drawArrow(pts: Pt[], color: string, width: number, opts: { dashed?: boolean; invalid?: boolean; alpha?: number; head?: boolean }) {
    const c = this.ctx;
    const z = this.cam.zoom;
    if (pts.length < 2) return;
    const total = polyLength(pts);
    const headLen = Math.min(total * 0.45, (width * 2.4 + 10) / z);
    const body = subPath(pts, 0, Math.max(0, 1 - headLen / total), 30);
    const tip = pointAlong(pts, 1);
    const baseP = pointAlong(pts, Math.max(0, 1 - headLen / total));
    c.save();
    c.globalAlpha = opts.alpha ?? 1;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const col = opts.invalid ? '#ff3b30' : color;
    if (opts.dashed || opts.invalid) c.setLineDash([12 / z, 8 / z]);
    // outline
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.lineWidth = (width + 3.5) / z;
    this.strokePts(body);
    c.strokeStyle = col;
    c.lineWidth = width / z;
    this.strokePts(body);
    c.setLineDash([]);
    // marker sheen
    if (!opts.dashed && !opts.invalid) {
      c.strokeStyle = 'rgba(255,255,255,0.28)';
      c.lineWidth = Math.max(1, width * 0.28) / z;
      this.strokePts(body.map((p) => ({ x: p.x - 0.6 / z, y: p.y - 0.8 / z })));
    }
    if (opts.head !== false) {
      const a = Math.atan2(tip.y - baseP.y, tip.x - baseP.x);
      const hw = (width * 1.35 + 7) / z;
      c.beginPath();
      c.moveTo(tip.x + Math.cos(a) * 2 / z, tip.y + Math.sin(a) * 2 / z);
      c.lineTo(baseP.x + Math.cos(a + Math.PI / 2) * hw, baseP.y + Math.sin(a + Math.PI / 2) * hw);
      c.lineTo(baseP.x + Math.cos(a - Math.PI / 2) * hw, baseP.y + Math.sin(a - Math.PI / 2) * hw);
      c.closePath();
      c.fillStyle = col;
      c.strokeStyle = 'rgba(0,0,0,0.75)';
      c.lineWidth = 1.8 / z;
      c.fill();
      c.stroke();
    }
    c.restore();
  }

  private drawOrder(d: DrawnOrder, color: string, now: number, alpha: number) {
    const o = d.order;
    const c = this.ctx;
    const z = this.cam.zoom;
    const P = this.map.provinces;
    const invalid = !d.valid;
    const pop = d.selected ? 1 + 0.08 * Math.sin(now / 120) : 1;
    switch (o.kind) {
      case 'serang':
      case 'gerak': {
        const route = this.routeInfo(o.path, o.stroke).pts;
        const w = Math.min(13, 5 + 2.2 * o.units.length) * pop;
        this.drawArrow(route, color, w, { dashed: o.kind === 'gerak', invalid, alpha });
        const tip = pointAlong(route, 1);
        if (o.kind === 'serang' && d.odds !== undefined && d.valid) this.oddsBadge(d.odds, tip.x, tip.y + 20 / z, !!d.selected);
        break;
      }
      case 'bertahan': {
        const pts = o.stroke && o.stroke.length > 1 ? o.stroke : o.provs.map((p) => ({ x: P[p].x, y: P[p].y }));
        c.save();
        c.globalAlpha = alpha;
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(0,0,0,0.8)';
        c.lineWidth = 9 / z;
        this.strokePts(pts);
        c.strokeStyle = invalid ? '#ff3b30' : color;
        c.lineWidth = 5.5 / z;
        this.strokePts(pts);
        // defensive ticks
        const L = polyLength(pts);
        const n = Math.max(2, Math.floor((L * z) / 18));
        c.strokeStyle = invalid ? '#ff3b30' : color;
        c.lineWidth = 3 / z;
        for (let i = 0; i <= n; i++) {
          const p = pointAlong(pts, i / n);
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(p.x + Math.cos(p.a + Math.PI / 2) * 9 / z, p.y + Math.sin(p.a + Math.PI / 2) * 9 / z);
          c.stroke();
        }
        c.restore();
        break;
      }
      case 'udara': {
        c.save();
        c.globalAlpha = alpha;
        c.beginPath();
        c.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        c.fillStyle = this.hatchPattern(0, hexA(color, 0.55));
        c.fill();
        c.setLineDash([8 / z, 6 / z]);
        c.strokeStyle = color;
        c.lineWidth = 2.5 / z;
        c.stroke();
        c.restore();
        this.label('✈ UDARA', o.x, o.y, color);
        break;
      }
      case 'bangun': {

        if (o.what === 'jalan' && o.path && o.path.length > 1) {
          c.save();
          c.globalAlpha = alpha;
          c.strokeStyle = 'rgba(0,0,0,0.8)';
          c.lineWidth = 5 / z;
          this.strokePts(this.route(o.path));
          c.strokeStyle = '#f0e6c8';
          c.setLineDash([7 / z, 5 / z]);
          c.lineWidth = 3 / z;
          this.strokePts(this.route(o.path));
          c.restore();
        }
        {
          const sp = this.worldToScreen(P[o.prov].x + 22 / z, P[o.prov].y - 22 / z);
          c.save();
          c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
          drawIconBadge(c, BUILD_ICON_D[o.what], sp.x, sp.y, 22, color);
          c.restore();
        }
        break;
      }
      case 'rekrut':
        {
          const sp = this.worldToScreen(P[o.prov].x, P[o.prov].y);
          c.save();
          c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
          drawUnitSymbol(c, o.type, color, sp.x + 26, sp.y - 26, 20, 13, { alpha: 0.85, badge: '+' });
          c.restore();
        }
        break;
      case 'hangus': {
        const p = P[o.prov];
        c.save();
        c.strokeStyle = '#000';
        c.lineWidth = 7 / z;
        const r = 16 / z;
        c.beginPath();
        c.moveTo(p.x - r, p.y - r); c.lineTo(p.x + r, p.y + r);
        c.moveTo(p.x + r, p.y - r); c.lineTo(p.x - r, p.y + r);
        c.stroke();
        c.strokeStyle = '#ff3b30';
        c.lineWidth = 4 / z;
        c.stroke();
        c.restore();
        break;
      }
    }
    if (invalid && d.reason && (o.kind === 'serang' || o.kind === 'gerak')) {
      const t = pointAlong(this.routeInfo(o.path, o.stroke).pts, 0.5);
      this.label('⚠ ' + d.reason, t.x, t.y - 14 / z, '#ff6b5e', 12);
    }
  }

  /**
   * Strength estimate pill at an arrow tip: green = likely breakthrough,
   * amber = costly/uncertain, red = likely to fail, grey = target hidden by fog.
   */
  private oddsBadge(odds: number | null, wx: number, wy: number, big: boolean) {
    const c = this.ctx;
    const sp = this.worldToScreen(wx, wy);
    const ratio = odds === null ? '?' : odds >= 10 ? '10+ : 1' : `${odds.toFixed(1).replace('.', ',')} : 1`;
    const word = odds === null ? 'tak terlihat' : odds >= ODDS_GOOD ? 'unggul' : odds >= ODDS_EVEN ? 'alot' : 'berat';
    const bg = odds === null ? '#5b6472' : odds >= ODDS_GOOD ? '#1f9d55' : odds >= ODDS_EVEN ? '#d99a00' : '#d64236';
    const text = big ? `${ratio} · ${word}` : ratio;
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const size = big ? 14 : 12;
    c.font = `800 ${size}px ${COUNTER_FONT}`;
    const w = c.measureText(text).width + 14, hgt = size + 8;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.beginPath();
    c.roundRect(sp.x - w / 2, sp.y - hgt / 2 + 1.5, w, hgt, hgt / 2);
    c.fill();
    c.fillStyle = bg;
    c.beginPath();
    c.roundRect(sp.x - w / 2, sp.y - hgt / 2, w, hgt, hgt / 2);
    c.fill();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, sp.x, sp.y + 0.5);
    c.restore();
  }

  /** Text label at world position, constant screen size. */
  private label(text: string, wx: number, wy: number, color: string, size = 12) {
    const c = this.ctx;
    c.save();
    const sp = this.worldToScreen(wx, wy);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.font = `700 ${size}px ${COUNTER_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(text, sp.x, sp.y);
    c.fillStyle = color;
    c.fillText(text, sp.x, sp.y);
    c.restore();
  }

  /**
   * Division stacks per province. Close up every division is shown with its echelon,
   * organisation bar and group tag; further out a province collapses to one symbol
   * with a count; far out to a small marker.
   */
  private drawStacks(v: View, now: number) {
    const c = this.ctx;
    const z = this.cam.zoom;
    const P = this.map.provinces;
    const byProv = new Map<number, UnitView[]>();
    for (const u of v.units) {
      if (u.prov < 0) continue;
      if (v.visible && !v.visible[u.prov]) continue;
      let l = byProv.get(u.prov);
      if (!l) byProv.set(u.prov, (l = []));
      l.push(u);
    }
    this.unitHits = [];
    const close = z >= 1.35, mid = z >= 0.42;
    c.textAlign = 'center';
    byProv.forEach((list, prov) => {
      const sp = this.worldToScreen(P[prov].x, P[prov].y);
      if (sp.x < -60 || sp.y < -60 || sp.x > this.W + 60 || sp.y > this.H + 60) return;
      list.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.str - a.str);
      const k = v.state.countries[list[0].owner];
      if (!k) return;
      const total = list.reduce((a, u) => a + u.str, 0);
      const flash = v.flash.get(prov);
      const hit = flash !== undefined && now - flash < 450;
      const own = list[0].owner === v.viewer;
      if (close) {
        const n = Math.min(list.length, 3);
        const w = 24, h = 16, gap = 4;
        const rowW = n * w + (n - 1) * gap;
        list.slice(0, n).forEach((u, i) => {
          const x = sp.x - rowW / 2 + w / 2 + i * (w + gap);
          const sel = v.selectedUnits.has(u.id);
          const y = sp.y - (sel ? 3 : 0);
          const grp = u.group ? v.state.groups.find((g) => g.id === u.group) : undefined;
          drawUnitSymbol(c, u.type, k.color, x, y, w, h, {
            echelon: 'XX', selected: sel, badge: own && grp ? grp.name.replace(/^Korps\s+/, '') : undefined,
            org: own ? u.org : undefined,
          });
          this.unitHits.push({ id: u.id, prov, x, y, w: w + 4, h: h + 10 });
        });
        if (list.length > n) this.pill(`+${list.length - n}`, sp.x + rowW / 2 + 14, sp.y, 11);
        this.strength(total, sp.x, sp.y + h / 2 + (own ? 15 : 12), hit);
      } else if (mid) {
        // a small deck: the strongest branch on top, the rest peeking out behind it
        const top = list[0];
        const sel = list.some((u) => v.selectedUnits.has(u.id));
        for (let i = Math.min(2, list.length - 1); i >= 1; i--) {
          drawUnitSymbol(c, list[i].type, k.color, sp.x + i * 3, sp.y - i * 3, 22, 14, { shadow: false, alpha: 0.9 });
        }
        drawUnitSymbol(c, top.type, k.color, sp.x, sp.y, 22, 14, {
          echelon: list.length > 1 ? 'XXX' : 'XX', selected: sel, badge: list.length > 1 ? String(list.length) : undefined,
        });
        for (const u of list) this.unitHits.push({ id: u.id, prov, x: sp.x, y: sp.y, w: 30, h: 26 });
        this.strength(total, sp.x, sp.y + 17, hit, 12);
      } else {
        drawUnitSymbol(c, list[0].type, k.color, sp.x, sp.y, 13, 9, { shadow: false, selected: list.some((u) => v.selectedUnits.has(u.id)) });
      }
    });
  }

  /** Strength label under a stack; flashes red when it just took heavy losses. */
  private strength(n: number, x: number, y: number, hit: boolean, size = 13) {
    const c = this.ctx;
    c.font = `800 ${size}px ${COUNTER_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(5,8,13,0.9)';
    const t = fmtCompact(n);
    c.strokeText(t, x, y);
    c.fillStyle = hit ? '#ff5a4e' : '#fff';
    c.fillText(t, x, y);
  }

  private pill(text: string, x: number, y: number, size: number) {
    const c = this.ctx;
    c.font = `800 ${size}px ${COUNTER_FONT}`;
    const w = c.measureText(text).width + 8;
    c.beginPath();
    c.roundRect(x - w / 2, y - size / 2 - 2, w, size + 4, (size + 4) / 2);
    c.fillStyle = 'rgba(11,17,24,0.92)';
    c.fill();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, y + 0.5);
  }

  /** Unit symbols under a screen point (planning hit-test). */
  unitsAt(sx: number, sy: number): { ids: number[]; prov: number } | null {
    let best: { ids: number[]; prov: number } | null = null;
    let bd = Infinity;
    for (const h of this.unitHits) {
      if (Math.abs(sx - h.x) > h.w / 2 || Math.abs(sy - h.y) > h.h / 2) continue;
      const d = Math.hypot(sx - h.x, sy - h.y);
      if (d < bd - 0.5) { bd = d; best = { ids: [h.id], prov: h.prov }; }
      else if (Math.abs(d - bd) <= 0.5 && best) best.ids.push(h.id);
    }
    return best;
  }

  private drawCapitals(v: View) {
    const c = this.ctx;
    const P = this.map.provinces;
    for (const k of v.state.countries) {
      if (!k.alive || k.capital < 0) continue;
      const p = P[k.capital];
      const sp = this.worldToScreen(p.x, p.y);
      const x = sp.x, y = sp.y - (this.cam.zoom >= 0.8 ? 30 : this.cam.zoom >= 0.42 ? 26 : 12);
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 2.6 : 6;
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      c.closePath();
      c.fillStyle = '#ffd34d';
      c.strokeStyle = 'rgba(5,8,13,0.9)';
      c.lineWidth = 1.4;
      c.fill();
      c.stroke();
    }
  }

  /** Moving columns: one symbol per division marching along the drawn route. */
  private drawColumns(v: View, now: number) {
    const c = this.ctx;
    const z = this.cam.zoom;
    const s = v.state;
    const w = z >= 0.6 ? 22 : 16, h = z >= 0.6 ? 14 : 10;
    for (const col of v.cols) {
      const k = s.countries[col.owner];
      if (!k || col.alpha <= 0.01) continue;
      const L = polyLength(col.route);
      const types = col.types.length ? col.types.slice().sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b]) : ['inf' as UnitType];
      const spacing = (w + 6) / z / Math.max(1, L);
      c.globalAlpha = col.alpha;
      for (let i = types.length - 1; i >= 0; i--) {
        const u = col.u - i * spacing;
        if (u < 0) continue;
        const p = pointAlong(col.route, u);
        let sp = this.worldToScreen(p.x, p.y);
        if (col.fighting) sp = { x: sp.x + Math.sin(now / 40 + i * 2) * 1.8, y: sp.y + Math.cos(now / 33 + i) * 1.3 };
        drawUnitSymbol(c, types[i], k.color, sp.x, sp.y, w, h, { retreat: col.kind === 'mundur', echelon: i === 0 && z >= 0.6 ? 'XX' : undefined });
      }
      const head = pointAlong(col.route, col.u);
      const hs = this.worldToScreen(head.x, head.y);
      this.strength(col.troops, hs.x, hs.y + h / 2 + 10, false, 12);
      c.globalAlpha = 1;
    }
  }
}
