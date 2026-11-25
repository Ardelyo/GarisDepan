import { Rng } from '../core/rng';
import type { GameMap } from '../map/types';
import { TERRAINS } from '../map/types';
import type { Theme } from '../sim/types';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const SAT: Record<string, RGB> = {
  dataran: hex('#55633d'), hutan: hex('#2c4127'), bukit: hex('#5f5c49'), gunung: hex('#7b776e'),
  gurun: hex('#8f7f57'), rawa: hex('#3b4a37'), hutanHujan: hex('#21381e'), tundra: hex('#8e9397'),
};
const TOON: Record<string, RGB> = {
  dataran: hex('#a9d860'), hutan: hex('#3f8f3b'), bukit: hex('#93bd55'), gunung: hex('#8e8e8e'),
  gurun: hex('#ecd58d'), rawa: hex('#76a868'), hutanHujan: hex('#2e7b33'), tundra: hex('#e9eef0'),
};

/** Cheap tileable value noise. */
function valueNoise(rng: Rng, n = 64) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % n) + n) % n, j0 = ((yi % n) + n) % n;
    const i1 = (i0 + 1) % n, j1 = (j0 + 1) % n;
    const a = g[j0 * n + i0], b = g[j0 * n + i1], c = g[j1 * n + i0], d = g[j1 * n + i1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export interface BaseLayers {
  canvas: HTMLCanvasElement;
  grain: CanvasPattern | null;
  /** Tileable detail texture for the screen-space soft-light overlay. */
  detail: HTMLCanvasElement;
}

/**
 * Pre-render the static terrain layer for a theme. Land texture is clipped by the
 * union of province polygons so the coastline matches the vector borders exactly.
 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Land texture resolution: sharper where memory allows. */
export function defaultLandScale(): number {
  // The land colour field is smooth (built from 5-unit cells), so 1 px/unit loses nothing visible;
  // crispness at high zoom comes from the screen-space detail tile instead.
  return 1;
}

/** Tileable multi-octave noise tile, grey-centred, used as a screen-space soft-light detail layer. */
function makeDetailTile(seed: number, theme: Theme): HTMLCanvasElement {
  const N = 256;
  const rng = new Rng(seed ^ 0x5eed);
  const octaves = [16, 32, 64, 128].map((n) => valueNoise(rng, n));
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  const img = x.createImageData(N, N);
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    let v = 0, a = 1, norm = 0;
    for (let o = 0; o < octaves.length; o++) {
      const cells = [16, 32, 64, 128][o];
      v += a * octaves[o]((px / N) * cells, (py / N) * cells);
      norm += a;
      a *= 0.55;
    }
    v = v / norm; // 0..1
    const g = Math.round(128 + (v - 0.5) * (theme === 'satelit' ? 190 : 110));
    const i = (py * N + px) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/**
 * Async: the land pass runs in slices so the UI (lobby, gestures) stays responsive.
 * Returns null if `abort()` turns true (the map was replaced while building).
 */
export async function buildBase(map: GameMap, theme: Theme, landScale = defaultLandScale(), abort: () => boolean = () => false): Promise<BaseLayers | null> {
  const scale = landScale; // pixels per world unit for the land texture (sea is smooth: 0.5 is plenty)
  const seaScale = 0.5;
  const W = Math.round(map.w * scale), H = Math.round(map.h * scale);
  const Ws = Math.round(map.w * seaScale), Hs = Math.round(map.h * seaScale);
  const rng = new Rng(map.params.seed ^ 0xabc);
  const vn = valueNoise(rng, 64);
  const vn2 = valueNoise(rng, 64);
  const { gw, gh, cell, height, terrainGrid } = map;

  // distance from coast (cells) for shallow water
  const N = gw * gh;
  const seaD = new Float32Array(N).fill(1e9);
  const q: number[] = [];
  for (let i = 0; i < N; i++) if (height[i] >= 0) { seaD[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % gw, y = (i / gw) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]) {
      if (j >= 0 && seaD[j] > seaD[i] + 1) { seaD[j] = seaD[i] + 1; q.push(j); }
    }
  }
  const sampleF = (arr: Float32Array, px: number, py: number) => {
    const gx = Math.min(gw - 1.001, Math.max(0, px / cell - 0.5));
    const gy = Math.min(gh - 1.001, Math.max(0, py / cell - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const i = y0 * gw + x0;
    return arr[i] * (1 - fx) * (1 - fy) + arr[i + 1] * fx * (1 - fy) + arr[i + gw] * (1 - fx) * fy + arr[i + gw + 1] * fx * fy;
  };

  const sea = new ImageData(Ws, Hs);
  const land = new ImageData(W, H);
  const pal = theme === 'satelit' ? SAT : TOON;
  const palArr = TERRAINS.map((t) => pal[t]);
  const sd = sea.data, ld = land.data;
  for (let py = 0; py < Hs; py++) {
    for (let px = 0; px < Ws; px++) {
      const o = (py * Ws + px) * 4;
      const wx = px / seaScale, wy = py / seaScale;
      // ---- sea ----
      const dc = sampleF(seaD, wx, wy);
      const n1 = vn(wx / 37, wy / 37) * 0.6 + vn2(wx / 9, wy / 9) * 0.4;
      if (theme === 'satelit') {
        const shallow = Math.exp(-dc / 4);
        sd[o] = 6 + 14 * shallow + n1 * 5;
        sd[o + 1] = 12 + 30 * shallow + n1 * 7;
        sd[o + 2] = 24 + 44 * shallow + n1 * 10;
      } else {
        const t = Math.min(1, Math.max(0, (3.8 - dc) / 2.6));
        const band = t * t * (3 - 2 * t); // soft shallow-water tint (the sea layer is upscaled, so no hard steps)
        sd[o] = 58 + 30 * band + n1 * 6;
        sd[o + 1] = 152 + 26 * band + n1 * 6;
        sd[o + 2] = 232 + 10 * band;
      }
      sd[o + 3] = 255;
    }
  }
  // per-cell precompute: palette colour, height and hillshade gradients (bilinear-sampled per pixel)
  const NC = gw * gh;
  const CR = new Float32Array(NC), CG = new Float32Array(NC), CB = new Float32Array(NC);
  const CH = new Float32Array(NC), CX = new Float32Array(NC), CY = new Float32Array(NC);
  for (let i = 0; i < NC; i++) {
    const c = palArr[terrainGrid[i]];
    CR[i] = c[0]; CG[i] = c[1]; CB[i] = c[2];
    const x = i % gw, y = (i / gw) | 0;
    CH[i] = height[i];
    const hl = height[x > 0 ? i - 1 : i], hr = height[x < gw - 1 ? i + 1 : i];
    const hu = height[y > 0 ? i - gw : i], hd = height[y < gh - 1 ? i + gw : i];
    CX[i] = (hr - hl) * 0.6;
    CY[i] = (hd - hu) * 0.6;
  }
  // low-frequency noise fields are computed once at half resolution and bilinearly sampled
  const FS = 0.5, Wf = Math.round(map.w * FS) + 2, Hf = Math.round(map.h * FS) + 2;
  const FN = new Float32Array(Wf * Hf), FWX = new Float32Array(Wf * Hf), FWY = new Float32Array(Wf * Hf);
  for (let y = 0; y < Hf; y++) for (let x = 0; x < Wf; x++) {
    const wx = x / FS, wy = y / FS, i = y * Wf + x;
    FN[i] = vn(wx / 37, wy / 37) * 0.6 + vn2(wx / 9, wy / 9) * 0.4;
    FWX[i] = (vn(wx / 23 + 11, wy / 23) - 0.5) * 18;
    FWY[i] = (vn(wx / 23, wy / 23 + 7) - 0.5) * 18;
  }
  const fbil = (a: Float32Array, wx: number, wy: number) => {
    const fx = wx * FS, fy = wy * FS;
    const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, i = y0 * Wf + x0;
    return a[i] * (1 - ax) * (1 - ay) + a[i + 1] * ax * (1 - ay) + a[i + Wf] * (1 - ax) * ay + a[i + Wf + 1] * ax * ay;
  };
  for (let py = 0; py < H; py++) {
    if ((py & 31) === 31) { await tick(); if (abort()) return null; }
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4;
      const wx = px / scale, wy = py / scale;
      const n1 = fbil(FN, wx, wy);
      // ---- land ----
      const warpX = fbil(FWX, wx, wy);
      const warpY = fbil(FWY, wx, wy);
      let r: number, g: number, b: number;
      if (theme === 'kartun') {
        // smooth class boundaries: bilinear vote between the 4 surrounding cells
        const fxw = Math.min(gw - 1.001, Math.max(0, (wx + warpX) / cell - 0.5));
        const fyw = Math.min(gh - 1.001, Math.max(0, (wy + warpY) / cell - 0.5));
        const x0 = Math.floor(fxw), y0 = Math.floor(fyw);
        const ax = fxw - x0, ay = fyw - y0;
        const i0 = y0 * gw + x0;
        const ids = [terrainGrid[i0], terrainGrid[i0 + 1], terrainGrid[i0 + gw], terrainGrid[i0 + gw + 1]];
        const wts = [(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay];
        let bestId = ids[0], bestW = -1;
        for (let a = 0; a < 4; a++) {
          let sum = 0;
          for (let b2 = 0; b2 < 4; b2++) if (ids[b2] === ids[a]) sum += wts[b2];
          if (sum > bestW) { bestW = sum; bestId = ids[a]; }
        }
        const c = palArr[bestId];
        const t = TERRAINS[bestId];
        let k = 1;
        if (t === 'gunung' || t === 'bukit') k = 0.86 + 0.28 * vn2(wx / 6, wy / 6);
        else k = 0.97 + 0.05 * n1;
        r = c[0] * k; g = c[1] * k; b = c[2] * k;
      } else {
        // bilinear blend of neighbour terrain colours + hillshade (one index computation, six arrays)
        const gx = Math.min(gw - 1.001, Math.max(0, (wx + warpX * 0.5) / cell - 0.5));
        const gy = Math.min(gh - 1.001, Math.max(0, (wy + warpY * 0.5) / cell - 0.5));
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const i = y0 * gw + x0;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        r = CR[i] * w00 + CR[i + 1] * w10 + CR[i + gw] * w01 + CR[i + gw + 1] * w11;
        g = CG[i] * w00 + CG[i + 1] * w10 + CG[i + gw] * w01 + CG[i + gw + 1] * w11;
        b = CB[i] * w00 + CB[i + 1] * w10 + CB[i + gw] * w01 + CB[i + gw + 1] * w11;
        const hC = CH[i] * w00 + CH[i + 1] * w10 + CH[i + gw] * w01 + CH[i + gw + 1] * w11;
        const hx = CX[i] * w00 + CX[i + 1] * w10 + CX[i + gw] * w01 + CX[i + gw + 1] * w11;
        const hy = CY[i] * w00 + CY[i + 1] * w10 + CY[i + gw] * w01 + CY[i + gw + 1] * w11;
        const shade = Math.max(0.45, Math.min(1.5, 1 + (-hx * 0.7 - hy * 0.7) * 9));
        const snow = hC > 0.78 ? Math.min(1, (hC - 0.78) * 6) : 0;
        const grain = 0.82 + 0.3 * vn2(wx / 2.3, wy / 2.3) * 0.6 + 0.2 * n1;
        r = (r * (1 - snow) + 205 * snow) * shade * grain * 0.95;
        g = (g * (1 - snow) + 208 * snow) * shade * grain * 0.95;
        b = (b * (1 - snow) + 212 * snow) * shade * grain * 0.95;
      }
      ld[o] = r; ld[o + 1] = g; ld[o + 2] = b; ld[o + 3] = 255;
    }
  }
  const seaC = document.createElement('canvas');
  seaC.width = Ws;
  seaC.height = Hs;
  seaC.getContext('2d')!.putImageData(sea, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(seaC, 0, 0, W, H);
  const landC = document.createElement('canvas');
  landC.width = W;
  landC.height = H;
  landC.getContext('2d')!.putImageData(land, 0, 0);

  // land mask = union of province polygons
  const mask = new Path2D();
  for (const p of map.provinces) for (const loop of p.loops) {
    loop.forEach((pt, i) => (i ? mask.lineTo(pt.x * scale, pt.y * scale) : mask.moveTo(pt.x * scale, pt.y * scale)));
    mask.closePath();
  }
  ctx.save();
  if (theme === 'satelit') {
    ctx.shadowColor = 'rgba(120,170,255,0.35)';
    ctx.shadowBlur = 10;
  }
  ctx.clip(mask);
  ctx.drawImage(landC, 0, 0);
  ctx.restore();
  if (theme === 'kartun') {
    ctx.strokeStyle = 'rgba(25,70,120,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke(mask);
  }
  // fine grain pattern for zoomed-in detail
  const gc = document.createElement('canvas');
  gc.width = gc.height = 128;
  const gctx = gc.getContext('2d')!;
  const gd = gctx.createImageData(128, 128);
  for (let i = 0; i < gd.data.length; i += 4) {
    const v = rng.next() * 255;
    gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v;
    gd.data[i + 3] = theme === 'satelit' ? 22 : 8;
  }
  gctx.putImageData(gd, 0, 0);
  const grain = ctx.createPattern(gc, 'repeat');
  return { canvas, grain, detail: makeDetailTile(map.params.seed, theme) };
}
