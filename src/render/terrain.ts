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
}

/**
 * Pre-render the static terrain layer for a theme. Land texture is clipped by the
 * union of province polygons so the coastline matches the vector borders exactly.
 */
export function buildBase(map: GameMap, theme: Theme): BaseLayers {
  const scale = 1; // 1 px per world unit
  const W = Math.round(map.w * scale), H = Math.round(map.h * scale);
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

  const sea = new ImageData(W, H);
  const land = new ImageData(W, H);
  const pal = theme === 'satelit' ? SAT : TOON;
  const palArr = TERRAINS.map((t) => pal[t]);
  const sd = sea.data, ld = land.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4;
      const wx = px / scale, wy = py / scale;
      // ---- sea ----
      const dc = sampleF(seaD, wx, wy);
      const n1 = vn(wx / 37, wy / 37) * 0.6 + vn2(wx / 9, wy / 9) * 0.4;
      if (theme === 'satelit') {
        const shallow = Math.exp(-dc / 4);
        sd[o] = 6 + 14 * shallow + n1 * 5;
        sd[o + 1] = 12 + 30 * shallow + n1 * 7;
        sd[o + 2] = 24 + 44 * shallow + n1 * 10;
      } else {
        const band = dc < 2.2 ? 1 : dc < 3.4 ? 0.5 : 0;
        sd[o] = 58 + 30 * band + n1 * 6;
        sd[o + 1] = 152 + 26 * band + n1 * 6;
        sd[o + 2] = 232 + 10 * band;
      }
      sd[o + 3] = 255;
      // ---- land ----
      const warpX = (vn(wx / 23 + 11, wy / 23) - 0.5) * 18;
      const warpY = (vn(wx / 23, wy / 23 + 7) - 0.5) * 18;
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
        // bilinear blend of neighbour terrain colours + hillshade
        const gx = Math.min(gw - 1.001, Math.max(0, (wx + warpX * 0.5) / cell - 0.5));
        const gy = Math.min(gh - 1.001, Math.max(0, (wy + warpY * 0.5) / cell - 0.5));
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const i = y0 * gw + x0;
        const cs = [palArr[terrainGrid[i]], palArr[terrainGrid[i + 1]], palArr[terrainGrid[i + gw]], palArr[terrainGrid[i + gw + 1]]];
        const ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
        r = g = b = 0;
        for (let k = 0; k < 4; k++) { r += cs[k][0] * ws[k]; g += cs[k][1] * ws[k]; b += cs[k][2] * ws[k]; }
        const hC = sampleF(height, wx, wy);
        const hx = sampleF(height, wx + 3, wy) - sampleF(height, wx - 3, wy);
        const hy = sampleF(height, wx, wy + 3) - sampleF(height, wx, wy - 3);
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
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(sea, 0, 0);
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
  return { canvas, grain };
}
