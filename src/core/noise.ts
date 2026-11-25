import { Rng } from './rng';

/** 2D simplex noise, seeded. */
export class Simplex {
  private perm = new Uint8Array(512);
  private static grad = [
    [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  constructor(rng: Rng) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noise(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const g = Simplex.grad;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = g[this.perm[ii + this.perm[jj]] & 7];
      t0 *= t0;
      n += t0 * t0 * (gi[0] * x0 + gi[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = g[this.perm[ii + i1 + this.perm[jj + j1]] & 7];
      t1 *= t1;
      n += t1 * t1 * (gi[0] * x1 + gi[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = g[this.perm[ii + 1 + this.perm[jj + 1]] & 7];
      t2 *= t2;
      n += t2 * t2 * (gi[0] * x2 + gi[1] * y2);
    }
    return 70 * n; // ~[-1, 1]
  }
  fbm(x: number, y: number, oct = 5, lac = 2, gain = 0.5): number {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * this.noise(x * f, y * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return sum / norm;
  }
}
