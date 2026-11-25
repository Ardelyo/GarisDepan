import type { Pt } from '../core/geom';

export type Terrain = 'dataran' | 'hutan' | 'bukit' | 'gunung' | 'gurun' | 'rawa' | 'hutanHujan' | 'tundra';
export type Resource = 'pangan' | 'baja' | 'minyak' | 'logam' | 'energi';
export type MapShape = 'benua' | 'semenanjung' | 'kepulauan' | 'duaBenua';
export type MapSize = 'kecil' | 'sedang' | 'besar';

export interface Province {
  id: number;
  /** Label / counter anchor (pole of inaccessibility). */
  x: number;
  y: number;
  area: number;
  terrain: Terrain;
  coastal: boolean;
  landmass: number;
  basePop: number; // thousands of people
  resource: Resource;
  neighbors: number[];
  /** Amphibious links across narrow straits. */
  seaLinks: number[];
  /** Closed polygons (outer + holes), consistent orientation, fill with nonzero. */
  loops: Pt[][];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface Arc {
  /** Province ids on both sides; -1 = sea. a < b. */
  a: number;
  b: number;
  pts: Pt[];
}

export interface MapParams {
  seed: number;
  shape: MapShape;
  size: MapSize;
}

export interface GameMap {
  params: MapParams;
  w: number;
  h: number;
  cell: number;
  gw: number;
  gh: number;
  /** Elevation per grid cell, sea < 0. */
  height: Float32Array;
  moist: Float32Array;
  terrainGrid: Uint8Array;
  cellProv: Int32Array;
  provinces: Province[];
  arcs: Arc[];
  /** Arc indices per province. */
  provArcs: number[][];
}

export const TERRAINS: Terrain[] = ['dataran', 'hutan', 'bukit', 'gunung', 'gurun', 'rawa', 'hutanHujan', 'tundra'];

export const TERRAIN_INFO: Record<Terrain, { name: string; defense: number; speed: number; fertility: number }> = {
  dataran: { name: 'Dataran', defense: 1.0, speed: 1.0, fertility: 1.0 },
  hutan: { name: 'Hutan', defense: 1.25, speed: 0.75, fertility: 0.6 },
  bukit: { name: 'Perbukitan', defense: 1.3, speed: 0.7, fertility: 0.55 },
  gunung: { name: 'Pegunungan', defense: 1.5, speed: 0.5, fertility: 0.25 },
  gurun: { name: 'Gurun', defense: 1.0, speed: 0.8, fertility: 0.15 },
  rawa: { name: 'Rawa', defense: 1.2, speed: 0.5, fertility: 0.4 },
  hutanHujan: { name: 'Hutan Hujan', defense: 1.3, speed: 0.6, fertility: 0.5 },
  tundra: { name: 'Tundra', defense: 1.1, speed: 0.7, fertility: 0.2 },
};

export const RESOURCE_NAME: Record<Resource, string> = {
  pangan: 'Pangan', baja: 'Baja', minyak: 'Minyak', logam: 'Logam langka', energi: 'Energi',
};
