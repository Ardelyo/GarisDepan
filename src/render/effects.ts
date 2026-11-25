import type { Pt } from '../core/geom';

interface Explosion { x: number; y: number; t0: number; size: number; seed: number }
interface Plane { color: string; from: Pt; to: Pt; r: number; t0: number; dur: number; seed: number }
interface Ship { color: string; from: Pt; to: Pt; t0: number; dur: number }
interface Pulse { x: number; y: number; t0: number; color: string }

/** World-space particle effects. Sizes are given in screen pixels and divided by zoom. */
export class Effects {
  explosions: Explosion[] = [];
  planes: Plane[] = [];
  ships: Ship[] = [];
  pulses: Pulse[] = [];
  shakeUntil = 0;
  shakeAmp = 0;

  explode(x: number, y: number, size: number, now: number) {
    this.explosions.push({ x, y, t0: now, size, seed: Math.random() * 1000 });
    if (size > 26) { this.shakeUntil = now + 220; this.shakeAmp = 2.5; }
  }
  plane(color: string, from: Pt, to: Pt, r: number, now: number, dur = 9000) {
    this.planes.push({ color, from, to, r, t0: now, dur, seed: Math.random() * 6.28 });
  }
  ship(color: string, from: Pt, to: Pt, now: number, dur = 7000) {
    this.ships.push({ color, from, to, t0: now, dur });
  }
  pulse(x: number, y: number, color: string, now: number) {
    this.pulses.push({ x, y, t0: now, color });
  }
  clear() {
    this.explosions = [];
    this.planes = [];
    this.ships = [];
    this.pulses = [];
  }
  shake(now: number): Pt {
    if (now > this.shakeUntil) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * 2 * this.shakeAmp, y: (Math.random() - 0.5) * 2 * this.shakeAmp };
  }

  /** ctx must have the world transform applied; z = zoom. */
  draw(ctx: CanvasRenderingContext2D, now: number, z: number, theme: 'satelit' | 'kartun') {
    const px = 1 / z;
    // pulses (landing zone rings)
    this.pulses = this.pulses.filter((p) => now - p.t0 < 1600);
    for (const p of this.pulses) {
      const a = (now - p.t0) / 1600;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = (1 - a) * 0.9;
      ctx.lineWidth = 2.5 * px;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (10 + 50 * a) * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ships with wake
    this.ships = this.ships.filter((s) => now - s.t0 < s.dur);
    for (const s of this.ships) {
      const a = Math.min(1, (now - s.t0) / (s.dur * 0.8));
      const ang = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 9 * px;
        const ox = -Math.sin(ang) * off, oy = Math.cos(ang) * off;
        const x = s.from.x + (s.to.x - s.from.x) * Math.max(0, a - k * 0.04) + ox;
        const y = s.from.y + (s.to.y - s.from.y) * Math.max(0, a - k * 0.04) + oy;
        ctx.strokeStyle = theme === 'satelit' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(ang - 0.25) * 16 * px, y - Math.sin(ang - 0.25) * 16 * px);
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(ang + 0.25) * 16 * px, y - Math.sin(ang + 0.25) * 16 * px);
        ctx.stroke();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = s.color;
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1 * px;
        ctx.beginPath();
        ctx.moveTo(6 * px, 0);
        ctx.lineTo(2 * px, -2.6 * px);
        ctx.lineTo(-6 * px, -2.6 * px);
        ctx.lineTo(-6 * px, 2.6 * px);
        ctx.lineTo(2 * px, 2.6 * px);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // planes with trails
    this.planes = this.planes.filter((p) => now - p.t0 < p.dur);
    for (const p of this.planes) {
      const pos = (t: number) => {
        const tt = (t - p.t0) / p.dur;
        const approach = 0.3;
        if (tt < approach) {
          const f = tt / approach;
          const ex = p.to.x + Math.cos(p.seed) * p.r, ey = p.to.y + Math.sin(p.seed) * p.r;
          return { x: p.from.x + (ex - p.from.x) * f, y: p.from.y + (ey - p.from.y) * f };
        }
        const ang = p.seed + (tt - approach) * 9;
        return { x: p.to.x + Math.cos(ang) * p.r, y: p.to.y + Math.sin(ang) * p.r };
      };
      const cur = pos(now);
      const prev = pos(now - 60);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      for (let k = 0; k < 18; k++) {
        const q = pos(now - k * 70);
        if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
      const ang = Math.atan2(cur.y - prev.y, cur.x - prev.x);
      ctx.save();
      ctx.translate(cur.x, cur.y);
      ctx.rotate(ang);
      ctx.scale(px, px);
      ctx.fillStyle = theme === 'satelit' ? '#f2f2f2' : p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(1, -1.5);
      ctx.lineTo(-1, -8);
      ctx.lineTo(-3, -8);
      ctx.lineTo(-2, -1.5);
      ctx.lineTo(-6, -1.2);
      ctx.lineTo(-8, -4);
      ctx.lineTo(-9, -4);
      ctx.lineTo(-8, 0);
      ctx.lineTo(-9, 4);
      ctx.lineTo(-8, 4);
      ctx.lineTo(-6, 1.2);
      ctx.lineTo(-2, 1.5);
      ctx.lineTo(-3, 8);
      ctx.lineTo(-1, 8);
      ctx.lineTo(1, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // explosions: flash + bloom + smoke ring + sparks
    this.explosions = this.explosions.filter((e) => now - e.t0 < 900);
    ctx.save();
    for (const e of this.explosions) {
      const a = (now - e.t0) / 900;
      const s = e.size * px;
      if (a < 0.6) {
        const f = a / 0.6;
        const r = s * (0.5 + 1.4 * f);
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        g.addColorStop(0, `rgba(255,255,255,${(1 - f) * 0.95})`);
        g.addColorStop(0.25, `rgba(255,236,170,${(1 - f) * 0.9})`);
        g.addColorStop(0.6, `rgba(255,140,40,${(1 - f) * 0.5})`);
        g.addColorStop(1, 'rgba(255,90,0,0)');
        ctx.globalCompositeOperation = theme === 'satelit' ? 'lighter' : 'source-over';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // smoke ring
      ctx.strokeStyle = `rgba(${theme === 'satelit' ? '210,210,210' : '70,70,70'},${(1 - a) * 0.55})`;
      ctx.lineWidth = s * 0.25 * (1 - a) + px;
      ctx.beginPath();
      ctx.arc(e.x, e.y, s * (0.6 + 1.6 * a), 0, Math.PI * 2);
      ctx.stroke();
      // sparks
      ctx.fillStyle = `rgba(255,220,120,${1 - a})`;
      for (let k = 0; k < 7; k++) {
        const ang = e.seed + k * 0.9;
        const d = s * (0.4 + 2.2 * a) * (0.6 + ((k * 37) % 10) / 20);
        ctx.fillRect(e.x + Math.cos(ang) * d, e.y + Math.sin(ang) * d, 1.8 * px, 1.8 * px);
      }
    }
    ctx.restore();
  }
}
