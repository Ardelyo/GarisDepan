import type { Pt } from '../core/geom';

interface Explosion { x: number; y: number; t0: number; size: number; seed: number; big: boolean }
interface Haze { x: number; y: number; r: number; t0: number; dur: number; seed: number }
interface Plane { color: string; from: Pt; to: Pt; r: number; t0: number; dur: number; seed: number; orbit: boolean }
interface Ship { color: string; from: Pt; to: Pt; t0: number; dur: number }
interface Missile { from: Pt; to: Pt; t0: number; dur: number; h: number; boom: number; done: boolean }
interface Reticle { x: number; y: number; r: number; t0: number; dur: number }
interface Label { text: string; x: number; y: number; t0: number; dur: number }

const EXPLOSION_LIFE = 5500;

/** Tiny deterministic hash → 0..1 for per-effect variation. */
const h01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * World-space effects on their own clock (`time`), which the game advances by
 * playback speed — pausing the replay freezes smoke mid-air.
 * Sizes are in screen pixels and divided by zoom when drawn.
 */
export class Effects {
  time = 0;
  /** 0..1: scales puff counts and haze so weak devices stay smooth. */
  density = 1;
  explosions: Explosion[] = [];
  hazes: Haze[] = [];
  planes: Plane[] = [];
  ships: Ship[] = [];
  missiles: Missile[] = [];
  reticles: Reticle[] = [];
  labels: Label[] = [];
  private shakeUntil = 0;
  private shakeAmp = 0;
  private seq = 0;

  advance(dt: number) {
    this.time += dt;
  }

  /** Multi-stage explosion: shockwave → fireball → browning top → black smoke → drift (≈5.5 s). */
  explode(x: number, y: number, size: number, delay = 0, big = false) {
    this.explosions.push({ x, y, t0: this.time + delay, size, seed: ++this.seq, big });
    if (big && delay === 0) { this.shakeUntil = this.time + 260; this.shakeAmp = 2.5; }
  }
  /** Lingering grey smoke over heavy fighting. */
  haze(x: number, y: number, r: number, delay = 0, dur = 9000) {
    this.hazes.push({ x, y, r, t0: this.time + delay, dur, seed: ++this.seq });
  }
  plane(color: string, from: Pt, to: Pt, r: number, delay = 0, dur = 9000, orbit = true) {
    this.planes.push({ color, from, to, r, t0: this.time + delay, dur, seed: (++this.seq % 628) / 100, orbit });
  }
  ship(color: string, from: Pt, to: Pt, delay = 0, dur = 7000) {
    this.ships.push({ color, from, to, t0: this.time + delay, dur });
  }
  /** Bright-headed missile/air trail along an arc; optional explosion of `boom` px on arrival. */
  missile(from: Pt, to: Pt, delay = 0, dur = 1100, boom = 0) {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    this.missiles.push({ from, to, t0: this.time + delay, dur, h: d * (0.25 + 0.2 * h01(++this.seq)), boom, done: false });
  }
  reticle(x: number, y: number, r: number, delay = 0, dur = 6000) {
    this.reticles.push({ x, y, r, t0: this.time + delay, dur });
  }
  label(text: string, x: number, y: number, delay = 0, dur = 8000) {
    this.labels.push({ text, x, y, t0: this.time + delay, dur });
  }
  clear() {
    this.explosions = [];
    this.hazes = [];
    this.planes = [];
    this.ships = [];
    this.missiles = [];
    this.reticles = [];
    this.labels = [];
  }
  get busy() {
    return this.explosions.length + this.missiles.length;
  }
  shake(): Pt {
    if (this.time > this.shakeUntil) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * 2 * this.shakeAmp, y: (Math.random() - 0.5) * 2 * this.shakeAmp };
  }

  /** ctx must have the world transform applied; z = zoom. */
  draw(ctx: CanvasRenderingContext2D, z: number, theme: 'satelit' | 'kartun') {
    const now = this.time;
    const px = 1 / z;
    const sat = theme === 'satelit';
    const live = <T extends { t0: number; dur: number }>(a: T[]) => a.filter((e) => now < e.t0 + e.dur);
    this.hazes = live(this.hazes);
    this.ships = live(this.ships);
    this.planes = live(this.planes);
    this.reticles = live(this.reticles);
    this.labels = live(this.labels);
    this.explosions = this.explosions.filter((e) => now < e.t0 + EXPLOSION_LIFE);

    // ---- haze (under everything) ----
    for (const hz of this.hazes) {
      const t = (now - hz.t0) / hz.dur;
      if (t < 0) continue;
      const a = Math.min(1, t * 5) * (1 - t) * (sat ? 0.32 : 0.26);
      for (let k = 0, nk = Math.max(2, Math.round(5 * this.density)); k < nk; k++) {
        const ang = hz.seed + k * 1.3;
        const rr = hz.r * px * (0.55 + 0.25 * h01(hz.seed + k)) * (1 + 0.5 * t);
        const cx = hz.x + Math.cos(ang) * hz.r * px * 0.45 + t * 6 * px;
        const cy = hz.y + Math.sin(ang) * hz.r * px * 0.3 - t * 10 * px;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, `rgba(${sat ? '120,120,124' : '90,90,90'},${a})`);
        g.addColorStop(1, 'rgba(90,90,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- reticles ----
    ctx.save();
    for (const r of this.reticles) {
      const t = (now - r.t0) / r.dur;
      if (t < 0) continue;
      const a = Math.min(1, t * 4) * Math.min(1, (1 - t) * 4);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * a})`;
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * px * (1 + 0.25 * t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([4 * px, 6 * px]);
      ctx.lineDashOffset = -now / 80 * px;
      ctx.strokeStyle = `rgba(255,255,255,${0.25 * a})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * px * (1.5 + 0.35 * t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // ---- ships with wake ----
    for (const s of this.ships) {
      const a = Math.min(1, Math.max(0, (now - s.t0) / (s.dur * 0.85)));
      if (now < s.t0) continue;
      const ang = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);
      const x = s.from.x + (s.to.x - s.from.x) * a, y = s.from.y + (s.to.y - s.from.y) * a;
      const fade = Math.min(1, (s.t0 + s.dur - now) / 600);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = sat ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(ang - 0.18) * 22 * px, y - Math.sin(ang - 0.18) * 22 * px);
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(ang + 0.18) * 22 * px, y - Math.sin(ang + 0.18) * 22 * px);
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // elongated hull with glowing stern, like the reference
      ctx.fillStyle = sat ? 'rgba(236,240,246,0.95)' : s.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 9 * px, 2.4 * px, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,220,150,0.8)';
      ctx.beginPath();
      ctx.arc(-8 * px, 0, 1.6 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ---- planes with contrails ----
    for (const p of this.planes) {
      if (now < p.t0) continue;
      const pos = (t: number) => {
        const tt = Math.max(0, (t - p.t0) / p.dur);
        if (!p.orbit) {
          // gentle curve from → to
          const mx = (p.from.x + p.to.x) / 2 + Math.cos(p.seed) * 40, my = (p.from.y + p.to.y) / 2 + Math.sin(p.seed) * 40;
          const u = tt, v = 1 - u;
          return { x: v * v * p.from.x + 2 * u * v * mx + u * u * p.to.x, y: v * v * p.from.y + 2 * u * v * my + u * u * p.to.y };
        }
        const approach = 0.3;
        if (tt < approach) {
          const f = tt / approach;
          const ex = p.to.x + Math.cos(p.seed) * p.r, ey = p.to.y + Math.sin(p.seed) * p.r;
          return { x: p.from.x + (ex - p.from.x) * f, y: p.from.y + (ey - p.from.y) * f };
        }
        const ang = p.seed + (tt - approach) * 9;
        return { x: p.to.x + Math.cos(ang) * p.r, y: p.to.y + Math.sin(ang) * p.r };
      };
      const fade = Math.min(1, (now - p.t0) / 400, (p.t0 + p.dur - now) / 500);
      const cur = pos(now);
      const prev = pos(now - 60);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const q = pos(now - k * 80);
        if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
      const ang = Math.atan2(cur.y - prev.y, cur.x - prev.x);
      ctx.save();
      ctx.translate(cur.x, cur.y);
      ctx.rotate(ang);
      ctx.scale(px, px);
      ctx.fillStyle = sat ? '#f4f4f4' : p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(1, -1.5); ctx.lineTo(-1, -8); ctx.lineTo(-3, -8); ctx.lineTo(-2, -1.5);
      ctx.lineTo(-6, -1.2); ctx.lineTo(-8, -4); ctx.lineTo(-9, -4); ctx.lineTo(-8, 0); ctx.lineTo(-9, 4);
      ctx.lineTo(-8, 4); ctx.lineTo(-6, 1.2); ctx.lineTo(-2, 1.5); ctx.lineTo(-3, 8); ctx.lineTo(-1, 8); ctx.lineTo(1, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ---- missiles (bright head, fading tail) ----
    for (const m of this.missiles) {
      const t = (now - m.t0) / m.dur;
      if (t < 0) continue;
      const at = (u: number) => {
        const v = 1 - u;
        const cx = (m.from.x + m.to.x) / 2, cy = (m.from.y + m.to.y) / 2 - m.h;
        return { x: v * v * m.from.x + 2 * u * v * cx + u * u * m.to.x, y: v * v * m.from.y + 2 * u * v * cy + u * u * m.to.y };
      };
      if (t >= 1) {
        if (!m.done) { m.done = true; if (m.boom) this.explode(m.to.x, m.to.y, m.boom); }
        // tail lingers and fades for 0.8 s
        const ft = (t - 1) * m.dur / 800;
        if (ft > 1) continue;
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - ft)})`;
        ctx.lineWidth = 1 * px;
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) { const q = at(0.55 + 0.45 * k / 16); if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
        ctx.stroke();
        continue;
      }
      for (let k = 0; k < 14; k++) {
        const u0 = Math.max(0, t - 0.4 * (k + 1) / 14), u1 = Math.max(0, t - 0.4 * k / 14);
        const a = at(u0), b = at(u1);
        ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - k / 14)})`;
        ctx.lineWidth = (1.6 - k * 0.08) * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const hd = at(t);
      const g = ctx.createRadialGradient(hd.x, hd.y, 0, hd.x, hd.y, 6 * px);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hd.x, hd.y, 6 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    this.missiles = this.missiles.filter((m) => now < m.t0 + m.dur + 800);

    // ---- explosions ----
    for (const e of this.explosions) {
      const ms = now - e.t0;
      if (ms < 0) continue;
      this.drawExplosion(ctx, e, ms, px, sat);
    }

    // ---- labels ----
    for (const l of this.labels) {
      const t = (now - l.t0) / l.dur;
      if (t < 0) continue;
      const a = Math.min(1, t * 6) * Math.min(1, (1 - t) * 5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `800 ${13 * px}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillText(l.text, l.x, l.y);
      ctx.restore();
    }
  }

  private drawExplosion(ctx: CanvasRenderingContext2D, e: Explosion, ms: number, px: number, sat: boolean) {
    const s = e.size * px;
    // 1. shockwave ring 0–500 ms
    if (ms < 500) {
      const f = ms / 500;
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - f)})`;
      ctx.lineWidth = (2.5 - 2 * f) * px + s * 0.06 * (1 - f);
      ctx.beginPath();
      ctx.arc(e.x, e.y, s * (0.6 + 1.8 * f), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.2 * (1 - f)})`;
      ctx.lineWidth = s * 0.35 * (1 - f);
      ctx.stroke();
    }
    // 2. flash 0–250 ms
    if (ms < 260) {
      const f = ms / 260;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, s * 1.1);
      g.addColorStop(0, `rgba(255,255,255,${1 - f})`);
      g.addColorStop(0.5, `rgba(255,240,200,${0.6 * (1 - f)})`);
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.save();
      if (sat) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, s * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 3–5. fireball lobes → brown → smoke → drift
    const life = EXPLOSION_LIFE;
    const lobes = e.big ? 3 : 2;
    const fadeOut = ms > life - 1500 ? (life - ms) / 1500 : 1;
    const grow = Math.min(1, ms / 1100);
    const rise = (ms / life) * s * 1.2;
    for (let li = 0; li < lobes; li++) {
      // lobe 0 at the base, higher lobes stack upward into a mushroom
      const lx = e.x + (h01(e.seed * 7 + li) - 0.5) * s * 0.5;
      const ly = e.y - li * s * 0.55 * grow - rise * (0.5 + li * 0.3);
      const lr = s * (0.35 + 0.45 * grow) * (1 - li * 0.12) * (1 + ms / life * 0.6);
      // colour by age and height: cream → (top) brown → grey/black
      const age = ms / 1000;
      let col: [number, number, number];
      const cream: [number, number, number] = [255, 236, 170];
      const orange: [number, number, number] = [245, 170, 80];
      const brown: [number, number, number] = [110, 70, 45];
      const smoke: [number, number, number] = sat ? [62, 60, 60] : [70, 70, 72];
      const mix = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const topness = lobes > 1 ? li / (lobes - 1) : 0;
      if (age < 1) col = mix(cream, orange, age * (1 - topness * 0.5));
      else if (age < 2.5) col = mix(orange, brown, Math.min(1, (age - 1) / 1.5 * (0.5 + topness)));
      else col = mix(brown, smoke, Math.min(1, (age - 2.5) / 1.2));
      const alpha = (age < 0.15 ? age / 0.15 : 1) * fadeOut * (age > 2.5 ? 0.85 : 0.95);
      // a lobe is a cluster of puffs
      const puffs = Math.max(2, Math.round(5 * this.density));
      for (let k = 0; k < puffs; k++) {
        const ang = h01(e.seed * 13 + li * 5 + k) * Math.PI * 2;
        const off = lr * 0.45;
        const cx = lx + Math.cos(ang) * off, cy = ly + Math.sin(ang) * off * 0.7;
        const r = lr * (0.55 + 0.25 * h01(e.seed * 3 + k + li));
        const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
        g.addColorStop(0, `rgba(${Math.min(255, col[0] + 30)},${Math.min(255, col[1] + 30)},${Math.min(255, col[2] + 30)},${alpha})`);
        g.addColorStop(0.75, `rgba(${col[0]},${col[1]},${col[2]},${alpha})`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // sparks in the first 0.7 s
    if (ms < 700) {
      const f = ms / 700;
      ctx.fillStyle = `rgba(255,225,140,${1 - f})`;
      for (let k = 0; k < 8; k++) {
        const ang = h01(e.seed + k) * Math.PI * 2;
        const d = s * (0.5 + 2.2 * f) * (0.6 + h01(e.seed * 5 + k) * 0.5);
        ctx.fillRect(e.x + Math.cos(ang) * d, e.y + Math.sin(ang) * d, 1.8 * px, 1.8 * px);
      }
    }
  }
}
