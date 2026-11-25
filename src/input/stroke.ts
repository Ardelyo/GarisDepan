import { catmullRom, dist, polyLength, simplify, type Pt } from '../core/geom';

export type StrokeShape = 'line' | 'loop' | 'tap';

export interface Recognized {
  shape: StrokeShape;
  pts: Pt[]; // smoothed (world)
  start: Pt;
  end: Pt;
}

/**
 * Turn a rough finger stroke into a clean shape: Douglas–Peucker → Catmull–Rom,
 * then classify open line vs closed loop.
 */
export function recognize(raw: Pt[], zoom: number): Recognized {
  const start = raw[0], end = raw[raw.length - 1];
  const len = polyLength(raw);
  if (raw.length < 3 || len * zoom < 14) return { shape: 'tap', pts: raw, start, end };
  const simp = simplify(raw, 2.5 / zoom);
  const pts = catmullRom(simp, 6);
  const closeD = dist(start, end);
  const isLoop = len * zoom > 110 && closeD < Math.max(28 / zoom, len * 0.2);
  return { shape: isLoop ? 'loop' : 'line', pts, start, end };
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function boundingCircle(pts: Pt[]): { x: number; y: number; r: number } {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  x /= pts.length;
  y /= pts.length;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - x, p.y - y));
  return { x, y, r: r * 0.9 };
}
