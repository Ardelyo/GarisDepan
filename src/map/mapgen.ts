import { Rng } from '../core/rng';
import { Simplex } from '../core/noise';
import { chaikin, simplify, type Pt } from '../core/geom';
import {
  TERRAINS, TERRAIN_INFO,
  type Arc, type GameMap, type MapParams, type Province, type Resource, type Terrain,
} from './types';

const W = 1800;
const H = 1300;
const CELL = 5;

const SIZE_TARGET = { kecil: 55, sedang: 100, besar: 170 } as const;

/**
 * Procedural map: heightmap (simplex + domain warp) → coastlines → biomes →
 * weighted Voronoi-like provinces (Dijkstra flood) → shared smoothed border arcs.
 */
export function generateMap(params: MapParams): GameMap {
  const rng = new Rng(params.seed);
  const gw = Math.floor(W / CELL);
  const gh = Math.floor(H / CELL);
  const N = gw * gh;
  const nH = new Simplex(rng);
  const nW = new Simplex(rng);
  const nM = new Simplex(rng);

  // ---------- 1. heightmap ----------
  const raw = new Float32Array(N);
  const shapeFn = makeShape(params.shape, rng);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const u = x / gw, v = y / gh;
      const wx = u + 0.18 * nW.fbm(u * 2.2, v * 2.2, 3);
      const wy = v + 0.18 * nW.fbm(u * 2.2 + 31.7, v * 2.2 + 7.3, 3);
      const n = nH.fbm(wx * 3.2, wy * 3.2, 6);
      raw[y * gw + x] = n * 0.55 + shapeFn(wx, wy);
    }
  }
  // sea level chosen as a quantile → stable land fraction
  const landFrac = params.shape === 'kepulauan' ? 0.36 : 0.47;
  const sorted = Float32Array.from(raw).sort();
  const sea = sorted[Math.floor((1 - landFrac) * N)];
  const maxH = sorted[N - 1];
  const height = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % gw, y = (i / gw) | 0;
    const border = x < 3 || y < 3 || x >= gw - 3 || y >= gh - 3;
    height[i] = border ? -0.5 : raw[i] >= sea ? (raw[i] - sea) / (maxH - sea) : (raw[i] - sea) / (sea - sorted[0]);
  }

  // ---------- 2. landmasses (remove specks, fill lakes) ----------
  cleanupLand(height, gw, gh);
  const landmass = new Int32Array(N).fill(-1);
  const masses: number[][] = [];
  for (let i = 0; i < N; i++) {
    if (height[i] < 0 || landmass[i] >= 0) continue;
    const id = masses.length;
    const cells = floodCells(i, gw, gh, (j) => height[j] >= 0 && landmass[j] < 0, (j) => (landmass[j] = id));
    masses.push(cells);
  }

  // distance to sea (cells), for moisture & swamps
  const seaDist = bfsDistance(gw, gh, (i) => height[i] < 0);

  // ---------- 3. climate & biome ----------
  const moist = new Float32Array(N);
  const terrainGrid = new Uint8Array(N);
  const latMode = params.shape === 'semenanjung' ? 1 : 0;
  for (let i = 0; i < N; i++) {
    const x = i % gw, y = (i / gw) | 0;
    const u = x / gw, v = y / gh;
    const m = 0.5 + 0.45 * nM.fbm(u * 4, v * 4, 4) + 0.25 * Math.exp(-seaDist[i] / 25) - 0.1;
    moist[i] = m;
    if (height[i] < 0) continue;
    const e = height[i];
    // temperature: north cold, south warm (north = top)
    const temp = latMode ? 0.35 + 0.6 * v - e * 0.5 : 0.2 + 0.9 * Math.sin(Math.PI * v) - e * 0.6 + 0.1 * nM.noise(u * 9, v * 9);
    let t: Terrain;
    if (e > 0.6) t = 'gunung';
    else if (e > 0.4) t = 'bukit';
    else if (temp < 0.25) t = 'tundra';
    else if (temp > 0.82 && m < 0.42) t = 'gurun';
    else if (temp > 0.78 && m > 0.62) t = 'hutanHujan';
    else if (e < 0.06 && m > 0.62 && seaDist[i] < 10) t = 'rawa';
    else if (m > 0.56) t = 'hutan';
    else t = 'dataran';
    terrainGrid[i] = TERRAINS.indexOf(t);
  }

  // ---------- 4. province seeds ----------
  const totalLand = masses.reduce((s, c) => s + c.length, 0);
  const target = SIZE_TARGET[params.size];
  const baseR = Math.sqrt(totalLand / target / Math.PI) * 1.55; // in cells
  const seeds: number[] = [];
  const seedGrid = new Map<number, number[]>();
  const bucket = Math.max(4, Math.ceil(baseR));
  const keyOf = (x: number, y: number) => Math.floor(x / bucket) * 10000 + Math.floor(y / bucket);
  const density = (i: number) => {
    const t = TERRAINS[terrainGrid[i]];
    const f = TERRAIN_INFO[t].fertility;
    return 1.25 - 0.55 * f; // fertile → smaller provinces
  };
  const tryAdd = (i: number): boolean => {
    const x = i % gw, y = (i / gw) | 0;
    const r = baseR * density(i);
    const bx = Math.floor(x / bucket), by = Math.floor(y / bucket);
    const span = Math.ceil((baseR * 1.3) / bucket);
    for (let dx = -span; dx <= span; dx++)
      for (let dy = -span; dy <= span; dy++) {
        const list = seedGrid.get((bx + dx) * 10000 + (by + dy));
        if (!list) continue;
        for (const s of list) {
          const sx = s % gw, sy = (s / gw) | 0;
          const rr = Math.max(r, baseR * density(s));
          if ((sx - x) ** 2 + (sy - y) ** 2 < rr * rr) return false;
        }
      }
    seeds.push(i);
    const k = keyOf(x, y);
    if (!seedGrid.has(k)) seedGrid.set(k, []);
    seedGrid.get(k)!.push(i);
    return true;
  };
  // every landmass big enough gets a seed at its interior-most cell
  for (const cells of masses) {
    let best = cells[0];
    for (const c of cells) if (seaDist[c] > seaDist[best]) best = c;
    tryAdd(best);
  }
  const landCells = masses.flat();
  for (let k = 0; k < target * 60; k++) {
    tryAdd(landCells[Math.floor(rng.next() * landCells.length)]);
  }

  // ---------- 5. Dijkstra flood → provinces ----------
  const cellProv = new Int32Array(N).fill(-1);
  const cost = new Float32Array(N).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((s, id) => {
    cost[s] = 0;
    cellProv[s] = id;
    heap.push(s, 0);
  });
  const nx8 = [1, -1, 0, 0, 1, 1, -1, -1];
  const ny8 = [0, 0, 1, -1, 1, -1, 1, -1];
  const jitter = new Simplex(rng);
  while (heap.size) {
    const [i, c] = heap.pop();
    if (c > cost[i]) continue;
    const x = i % gw, y = (i / gw) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = x + nx8[k], yy = y + ny8[k];
      if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
      const j = yy * gw + xx;
      if (height[j] < 0) continue;
      const tj = TERRAINS[terrainGrid[j]];
      const ridge = tj === 'gunung' ? 1.8 : tj === 'bukit' ? 1.25 : 1;
      const step = (k < 4 ? 1 : 1.4142) * ridge * (1 + 0.45 * jitter.noise(xx * 0.09, yy * 0.09));
      const nc = c + Math.max(0.2, step);
      if (nc < cost[j]) {
        cost[j] = nc;
        cellProv[j] = cellProv[i];
        heap.push(j, nc);
      }
    }
  }
  // land cells unreachable (shouldn't happen) → sea
  for (let i = 0; i < N; i++) if (height[i] >= 0 && cellProv[i] < 0) height[i] = -0.05;

  enforceConnectivity(cellProv, gw, gh, seeds.length);
  // compact ids (some provinces may have vanished)
  const remap = new Int32Array(seeds.length).fill(-1);
  let nP = 0;
  for (let i = 0; i < N; i++) {
    const p = cellProv[i];
    if (p >= 0 && remap[p] < 0) remap[p] = nP++;
  }
  for (let i = 0; i < N; i++) if (cellProv[i] >= 0) cellProv[i] = remap[cellProv[i]];

  // ---------- 6. province attributes ----------
  const inner = distanceToBoundary(cellProv, gw, gh);
  const provinces: Province[] = [];
  const terrCount: number[][] = [];
  for (let p = 0; p < nP; p++) {
    provinces.push({
      id: p, x: 0, y: 0, area: 0, terrain: 'dataran', coastal: false, landmass: 0, basePop: 0,
      resource: 'pangan', neighbors: [], seaLinks: [], loops: [],
      bbox: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    });
    terrCount.push(new Array(TERRAINS.length).fill(0));
  }
  const bestInner = new Float32Array(nP).fill(-1);
  const nbSets: Set<number>[] = provinces.map(() => new Set());
  for (let i = 0; i < N; i++) {
    const p = cellProv[i];
    if (p < 0) continue;
    const x = i % gw, y = (i / gw) | 0;
    const pr = provinces[p];
    pr.area++;
    terrCount[p][terrainGrid[i]]++;
    pr.landmass = landmass[i];
    const b = pr.bbox;
    b.x0 = Math.min(b.x0, x * CELL); b.y0 = Math.min(b.y0, y * CELL);
    b.x1 = Math.max(b.x1, (x + 1) * CELL); b.y1 = Math.max(b.y1, (y + 1) * CELL);
    if (inner[i] > bestInner[p]) {
      bestInner[p] = inner[i];
      pr.x = (x + 0.5) * CELL;
      pr.y = (y + 0.5) * CELL;
    }
    const right = x + 1 < gw ? cellProv[i + 1] : -1;
    const down = y + 1 < gh ? cellProv[i + gw] : -1;
    for (const q of [right, down]) {
      if (q === p) continue;
      if (q < 0) pr.coastal = true;
      else { nbSets[p].add(q); nbSets[q].add(p); }
    }
    if ((x > 0 && cellProv[i - 1] < 0) || (y > 0 && cellProv[i - gw] < 0)) pr.coastal = true;
  }
  const popNoise = new Simplex(rng);
  for (const pr of provinces) {
    pr.neighbors = [...nbSets[pr.id]].sort((a, b) => a - b);
    let bt = 0;
    terrCount[pr.id].forEach((c, k) => { if (c > terrCount[pr.id][bt]) bt = k; });
    pr.terrain = TERRAINS[bt];
    const fert = TERRAIN_INFO[pr.terrain].fertility;
    const pn = 0.7 + 0.6 * (0.5 + 0.5 * popNoise.noise(pr.x * 0.004, pr.y * 0.004));
    pr.basePop = Math.round(pr.area * 6 * fert * pn * (pr.coastal ? 1.35 : 1) + 40);
    pr.resource = pickResource(pr.terrain, rng);
  }

  // ---------- 7. straits (amphibious links) ----------
  computeSeaLinks(provinces, cellProv, height, gw, gh);

  // ---------- 8. border arcs ----------
  const { arcs, provArcs } = extractArcs(cellProv, gw, gh, nP);
  for (const pr of provinces) pr.loops = stitchLoops(pr.id, arcs, provArcs[pr.id]);

  return {
    params, w: W, h: H, cell: CELL, gw, gh, height, moist, terrainGrid, cellProv, provinces, arcs, provArcs,
  };
}

// ---------------------------------------------------------------------------

function makeShape(shape: MapParams['shape'], rng: Rng): (u: number, v: number) => number {
  const ell = (u: number, v: number, cx: number, cy: number, rx: number, ry: number) => {
    const d = Math.sqrt(((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2);
    return 1 - d;
  };
  switch (shape) {
    case 'semenanjung': {
      // mainland across the top, a long peninsula reaching south
      const px = rng.range(0.42, 0.58);
      return (u, v) => {
        const top = 0.9 - v * 3.2;
        const bend = px + 0.06 * Math.sin(v * 5);
        const pen = v < 0.88 ? 0.55 - Math.abs(u - bend) * 4.2 - Math.max(0, v - 0.7) * 2.5 : -1;
        return Math.max(top, pen) * 0.9;
      };
    }
    case 'kepulauan': {
      const isl = Array.from({ length: 7 }, () => ({
        x: rng.range(0.15, 0.85), y: rng.range(0.15, 0.85), r: rng.range(0.1, 0.2),
      }));
      return (u, v) => Math.max(...isl.map((c) => ell(u, v, c.x, c.y, c.r * 1.25, c.r))) * 0.9;
    }
    case 'duaBenua': {
      const a = rng.range(0.25, 0.32), b = rng.range(0.68, 0.75);
      return (u, v) =>
        Math.max(ell(u, v, a, 0.5 + rng.range(-0.0, 0.0), 0.27, 0.42), ell(u, v, b, 0.5, 0.27, 0.42)) * 0.95;
    }
    default:
      return (u, v) => ell(u, v, 0.5, 0.5, 0.48, 0.46) * 0.95;
  }
}

function pickResource(t: Terrain, rng: Rng): Resource {
  const table: Record<Terrain, Resource[]> = {
    dataran: ['pangan', 'pangan', 'pangan', 'energi'],
    hutan: ['pangan', 'energi', 'baja'],
    bukit: ['baja', 'baja', 'logam', 'energi'],
    gunung: ['logam', 'baja', 'logam'],
    gurun: ['minyak', 'minyak', 'energi'],
    rawa: ['minyak', 'pangan'],
    hutanHujan: ['pangan', 'logam', 'minyak'],
    tundra: ['minyak', 'logam', 'energi'],
  };
  return rng.pick(table[t]);
}

function floodCells(start: number, gw: number, gh: number, ok: (j: number) => boolean, mark: (j: number) => void): number[] {
  const out: number[] = [];
  const stack = [start];
  mark(start);
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % gw, y = (i / gw) | 0;
    const ns = [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1];
    for (const j of ns) if (j >= 0 && ok(j)) { mark(j); stack.push(j); }
  }
  return out;
}

function cleanupLand(height: Float32Array, gw: number, gh: number) {
  const N = gw * gh;
  const seen = new Uint8Array(N);
  // remove tiny islands
  for (let i = 0; i < N; i++) {
    if (height[i] < 0 || seen[i]) continue;
    const cells = floodCells(i, gw, gh, (j) => height[j] >= 0 && !seen[j], (j) => (seen[j] = 1));
    if (cells.length < 90) for (const c of cells) height[c] = -0.05;
  }
  // fill small lakes (sea components not touching the border)
  seen.fill(0);
  for (let i = 0; i < N; i++) {
    if (height[i] >= 0 || seen[i]) continue;
    let touches = false;
    const cells = floodCells(i, gw, gh, (j) => height[j] < 0 && !seen[j], (j) => (seen[j] = 1));
    for (const c of cells) {
      const x = c % gw, y = (c / gw) | 0;
      if (x < 4 || y < 4 || x >= gw - 4 || y >= gh - 4) { touches = true; break; }
    }
    if (!touches && cells.length < 400) for (const c of cells) height[c] = 0.02;
  }
}

function bfsDistance(gw: number, gh: number, isSource: (i: number) => boolean): Float32Array {
  const N = gw * gh;
  const d = new Float32Array(N).fill(Infinity);
  const q = new Int32Array(N);
  let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (isSource(i)) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++];
    const x = i % gw, y = (i / gw) | 0;
    const ns = [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1];
    for (const j of ns) if (j >= 0 && d[j] === Infinity) { d[j] = d[i] + 1; q[t++] = j; }
  }
  return d;
}

/** Chamfer distance from each land cell to the nearest cell with a different province id. */
function distanceToBoundary(cellProv: Int32Array, gw: number, gh: number): Float32Array {
  const N = gw * gh;
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = cellProv[i];
    if (p < 0) { d[i] = 0; continue; }
    const x = i % gw, y = (i / gw) | 0;
    const edge =
      x === 0 || y === 0 || x === gw - 1 || y === gh - 1 ||
      cellProv[i - 1] !== p || cellProv[i + 1] !== p || cellProv[i - gw] !== p || cellProv[i + gw] !== p;
    d[i] = edge ? 1 : 1e9;
  }
  for (let y = 1; y < gh; y++)
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x;
      d[i] = Math.min(d[i], d[i - 1] + 1, d[i - gw] + 1, d[i - gw - 1] + 1.414, d[i - gw + 1] + 1.414);
    }
  for (let y = gh - 2; y >= 0; y--)
    for (let x = gw - 2; x > 0; x--) {
      const i = y * gw + x;
      d[i] = Math.min(d[i], d[i + 1] + 1, d[i + gw] + 1, d[i + gw + 1] + 1.414, d[i + gw - 1] + 1.414);
    }
  return d;
}

/** Keep only each province's largest 4-connected piece; give orphans to a neighbour. */
function enforceConnectivity(cellProv: Int32Array, gw: number, gh: number, nP: number) {
  const N = gw * gh;
  for (let pass = 0; pass < 3; pass++) {
    const seen = new Uint8Array(N);
    const best: number[][] = new Array(nP).fill(null).map(() => []);
    const pieces: { p: number; cells: number[] }[] = [];
    for (let i = 0; i < N; i++) {
      const p = cellProv[i];
      if (p < 0 || seen[i]) continue;
      const cells = floodCells(i, gw, gh, (j) => cellProv[j] === p && !seen[j], (j) => (seen[j] = 1));
      pieces.push({ p, cells });
      if (cells.length > best[p].length) best[p] = cells;
    }
    let changed = false;
    for (const pc of pieces) {
      if (pc.cells === best[pc.p]) continue;
      // find most common neighbouring province
      const cnt = new Map<number, number>();
      for (const c of pc.cells) {
        const x = c % gw, y = (c / gw) | 0;
        for (const j of [x > 0 ? c - 1 : -1, x < gw - 1 ? c + 1 : -1, y > 0 ? c - gw : -1, y < gh - 1 ? c + gw : -1]) {
          if (j < 0) continue;
          const q = cellProv[j];
          if (q >= 0 && q !== pc.p) cnt.set(q, (cnt.get(q) ?? 0) + 1);
        }
      }
      let bq = -1, bc = 0;
      cnt.forEach((v, k) => { if (v > bc) { bc = v; bq = k; } });
      if (bq >= 0) { for (const c of pc.cells) cellProv[c] = bq; changed = true; }
    }
    if (!changed) break;
  }
}

function computeSeaLinks(provinces: Province[], cellProv: Int32Array, height: Float32Array, gw: number, gh: number) {
  const N = gw * gh;
  const R = 16; // cells (~80 world units)
  const owner = new Int32Array(N).fill(-1);
  const d = new Int32Array(N).fill(1 << 30);
  const q: number[] = [];
  for (let i = 0; i < N; i++) {
    if (height[i] >= 0) continue;
    const x = i % gw, y = (i / gw) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]) {
      if (j >= 0 && cellProv[j] >= 0) { owner[i] = cellProv[j]; d[i] = 1; q.push(i); break; }
    }
  }
  const pairs = new Map<string, number>();
  let h = 0;
  while (h < q.length) {
    const i = q[h++];
    const x = i % gw, y = (i / gw) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]) {
      if (j < 0 || height[j] >= 0) continue;
      if (owner[j] < 0) {
        if (d[i] + 1 > R) continue;
        owner[j] = owner[i];
        d[j] = d[i] + 1;
        q.push(j);
      } else if (owner[j] !== owner[i] && d[i] + d[j] <= R) {
        const a = Math.min(owner[i], owner[j]), b = Math.max(owner[i], owner[j]);
        pairs.set(a + ',' + b, 1);
      }
    }
  }
  // land hop distance to filter out trivial coastal neighbours
  const hops = (a: number, b: number, max: number) => {
    const seen = new Map<number, number>([[a, 0]]);
    const qq = [a];
    while (qq.length) {
      const c = qq.shift()!;
      const dc = seen.get(c)!;
      if (c === b) return dc;
      if (dc >= max) continue;
      for (const n of provinces[c].neighbors) if (!seen.has(n)) { seen.set(n, dc + 1); qq.push(n); }
    }
    return Infinity;
  };
  pairs.forEach((_, k) => {
    const [a, b] = k.split(',').map(Number);
    const pa = provinces[a], pb = provinces[b];
    if (pa.landmass !== pb.landmass || hops(a, b, 4) >= 4) {
      pa.seaLinks.push(b);
      pb.seaLinks.push(a);
    }
  });
}

/**
 * Extract shared border arcs between regions on the cell grid. Each arc is the
 * maximal chain of unit edges separating the same pair of regions, broken at
 * junction vertices; arcs are simplified + smoothed with fixed endpoints so
 * neighbouring province polygons stay watertight.
 */
function extractArcs(cellProv: Int32Array, gw: number, gh: number, nP: number) {
  const VW = gw + 1;
  const id = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? -1 : cellProv[y * gw + x]);
  const sv0: number[] = [], sv1: number[] = [], sa: number[] = [], sb: number[] = [];
  const vertSegs = new Map<number, number[]>();
  const addSeg = (x0: number, y0: number, x1: number, y1: number, p: number, q: number) => {
    const s = sv0.length;
    const v0 = y0 * VW + x0, v1 = y1 * VW + x1;
    sv0.push(v0); sv1.push(v1); sa.push(Math.min(p, q)); sb.push(Math.max(p, q));
    for (const v of [v0, v1]) {
      let l = vertSegs.get(v);
      if (!l) vertSegs.set(v, (l = []));
      l.push(s);
    }
  };
  for (let y = -1; y < gh; y++)
    for (let x = -1; x < gw; x++) {
      const p = id(x, y);
      const r = id(x + 1, y);
      const d = id(x, y + 1);
      if (p !== r && y >= 0) addSeg(x + 1, y, x + 1, y + 1, p, r);
      if (p !== d && x >= 0) addSeg(x, y + 1, x + 1, y + 1, p, d);
    }
  const visited = new Uint8Array(sv0.length);
  const arcs: Arc[] = [];
  const arcEnds: [number, number][] = [];
  const isStop = (v: number) => vertSegs.get(v)!.length !== 2;
  const other = (s: number, v: number) => (sv0[s] === v ? sv1[s] : sv0[s]);
  const walk = (startV: number, s0: number) => {
    const verts = [startV];
    let s = s0, v = startV;
    for (;;) {
      visited[s] = 1;
      v = other(s, v);
      verts.push(v);
      if (v === startV || isStop(v)) break;
      const nxt = vertSegs.get(v)!.find((t) => t !== s && !visited[t]);
      if (nxt === undefined) break;
      s = nxt;
    }
    const pa = sa[s0], pb = sb[s0];
    // figure which region lies on the "left" of the first step
    const ax = startV % VW, ay = (startV / VW) | 0;
    const bx = verts[1] % VW, by = (verts[1] / VW) | 0;
    const dx = bx - ax, dy = by - ay;
    const mx = (ax + bx) / 2 + dy * 0.5, my = (ay + by) / 2 - dx * 0.5;
    const leftId = id(Math.floor(mx), Math.floor(my));
    let pts: Pt[] = verts.map((vv) => ({ x: (vv % VW) * CELL, y: ((vv / VW) | 0) * CELL }));
    // orient so that the smaller id (a) is on the left
    if (leftId !== pa) { pts.reverse(); verts.reverse(); }
    pts = smoothArc(pts);
    arcs.push({ a: pa, b: pb, pts });
    arcEnds.push([verts[0], verts[verts.length - 1]]);
  };
  vertSegs.forEach((segs, v) => {
    if (segs.length === 2) return;
    for (const s of segs) if (!visited[s]) walk(v, s);
  });
  for (let s = 0; s < sv0.length; s++) if (!visited[s]) walk(sv0[s], s);

  const provArcs: number[][] = Array.from({ length: nP }, () => []);
  arcs.forEach((a, i) => {
    if (a.a >= 0) provArcs[a.a].push(i);
    if (a.b >= 0) provArcs[a.b].push(i);
  });
  // stash vertex ids on arcs for stitching
  arcs.forEach((a, i) => ((a as Arc & { ends: [number, number] }).ends = arcEnds[i]));
  return { arcs, provArcs };
}

function smoothArc(pts: Pt[]): Pt[] {
  const closed = pts.length > 2 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y;
  let s: Pt[];
  if (closed) {
    const mid = Math.floor(pts.length / 2);
    const a = simplify(pts.slice(0, mid + 1), CELL * 0.75);
    const b = simplify(pts.slice(mid), CELL * 0.75);
    s = a.concat(b.slice(1));
  } else s = simplify(pts, CELL * 0.75);
  return chaikin(s, 3);
}

function stitchLoops(p: number, arcs: Arc[], ids: number[]): Pt[][] {
  type A = { pts: Pt[]; s: number; e: number; used: boolean };
  const list: A[] = ids.map((i) => {
    const arc = arcs[i] as Arc & { ends: [number, number] };
    const forward = arc.a === p; // a is on the left in stored orientation
    return forward
      ? { pts: arc.pts, s: arc.ends[0], e: arc.ends[1], used: false }
      : { pts: arc.pts.slice().reverse(), s: arc.ends[1], e: arc.ends[0], used: false };
  });
  const byStart = new Map<number, A[]>();
  for (const a of list) {
    if (!byStart.has(a.s)) byStart.set(a.s, []);
    byStart.get(a.s)!.push(a);
  }
  const loops: Pt[][] = [];
  for (const first of list) {
    if (first.used) continue;
    first.used = true;
    const loop = first.pts.slice();
    let cur = first.e;
    let guard = 0;
    while (cur !== first.s && guard++ < 10000) {
      const nxt = byStart.get(cur)?.find((a) => !a.used);
      if (!nxt) break;
      nxt.used = true;
      for (let k = 1; k < nxt.pts.length; k++) loop.push(nxt.pts[k]);
      cur = nxt.e;
    }
    loops.push(loop);
  }
  return loops;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const a = this.ids, k = this.keys;
    a.push(id); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.ids, k = this.keys;
    const top: [number, number] = [a[0], k[0]];
    const lid = a.pop()!, lk = k.pop()!;
    if (a.length) {
      a[0] = lid; k[0] = lk;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
