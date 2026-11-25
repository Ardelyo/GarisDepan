import type { UnitType } from '../sim/types';

/**
 * Military unit symbols in the spirit of NATO APP-6: a frame in the nation's colour with
 * the branch mark inside (infantry ✕, armour oval, artillery dot, marines ✕ + wave) and the
 * echelon above it (XX = division, XXX = corps / stack).
 */

export const TYPE_ORDER: Record<UnitType, number> = { arm: 0, inf: 1, mar: 2, art: 3 };

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(Math.max(0, Math.min(255, v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export interface SymbolOpts {
  echelon?: string;
  selected?: boolean;
  alpha?: number;
  retreat?: boolean;
  badge?: string; // small tag at the top-right (group numeral or count)
  org?: number; // 0..1, draws a readiness bar under the frame
  shadow?: boolean;
}

/** Branch mark only, drawn inside a frame of w×h centred on (x, y). */
function mark(c: CanvasRenderingContext2D, type: UnitType, x: number, y: number, w: number, h: number, lw: number) {
  const hw = w / 2, hh = h / 2;
  c.lineWidth = lw;
  c.beginPath();
  switch (type) {
    case 'inf':
      c.moveTo(x - hw, y - hh); c.lineTo(x + hw, y + hh);
      c.moveTo(x + hw, y - hh); c.lineTo(x - hw, y + hh);
      c.stroke();
      break;
    case 'arm':
      c.ellipse(x, y, hw * 0.62, hh * 0.52, 0, 0, Math.PI * 2);
      c.stroke();
      break;
    case 'art':
      c.arc(x, y, Math.min(hw, hh) * 0.3, 0, Math.PI * 2);
      c.fill();
      break;
    case 'mar': {
      c.moveTo(x - hw, y - hh); c.lineTo(x + hw, y + hh * 0.2);
      c.moveTo(x + hw, y - hh); c.lineTo(x - hw, y + hh * 0.2);
      c.stroke();
      c.beginPath();
      const wy = y + hh * 0.62, amp = hh * 0.18;
      c.moveTo(x - hw * 0.8, wy);
      for (let i = 1; i <= 8; i++) c.lineTo(x - hw * 0.8 + (i * hw * 1.6) / 8, wy + (i % 2 ? -amp : amp));
      c.stroke();
      break;
    }
  }
}

/** Draw a unit symbol in screen space, centred on (x, y). */
export function drawUnitSymbol(
  c: CanvasRenderingContext2D, type: UnitType, color: string, x: number, y: number, w: number, h: number, o: SymbolOpts = {},
) {
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  const r = Math.max(2, h * 0.14);
  if (o.shadow !== false) {
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 6;
    c.shadowOffsetY = 1.5;
  }
  if (o.selected) {
    c.beginPath();
    c.roundRect(x - w / 2 - 3.5, y - h / 2 - 3.5, w + 7, h + 7, r + 3);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.fill();
  }
  c.beginPath();
  c.roundRect(x - w / 2, y - h / 2, w, h, r);
  c.fillStyle = shade(color, o.retreat ? 0.55 : 0.82);
  c.fill();
  c.shadowColor = 'transparent';
  c.strokeStyle = o.selected ? '#0b1118' : 'rgba(255,255,255,0.92)';
  c.lineWidth = Math.max(1.2, h * 0.08);
  c.stroke();
  c.save();
  c.beginPath();
  c.roundRect(x - w / 2, y - h / 2, w, h, r);
  c.clip();
  c.strokeStyle = '#fff';
  c.fillStyle = '#fff';
  mark(c, type, x, y, w - 2, h - 2, Math.max(1.1, h * 0.075));
  c.restore();
  if (o.echelon) {
    c.font = `800 ${Math.max(7, Math.round(h * 0.42))}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(5,8,13,0.85)';
    c.strokeText(o.echelon, x, y - h / 2 - 2);
    c.fillStyle = '#fff';
    c.fillText(o.echelon, x, y - h / 2 - 2);
  }
  if (o.badge) {
    const fs = Math.max(8, Math.round(h * 0.46));
    c.font = `800 ${fs}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    const tw = c.measureText(o.badge).width + 6;
    const bx = x + w / 2 + tw / 2 - 1, by = y + h * 0.18;
    c.beginPath();
    c.roundRect(bx - tw / 2, by - fs / 2 - 1, tw, fs + 2, (fs + 2) / 2);
    c.fillStyle = '#0b1118';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(o.badge, bx, by + 0.5);
  }
  if (o.org !== undefined) {
    const bw = w, by = y + h / 2 + 3;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(x - bw / 2, by, bw, 2.5);
    c.fillStyle = o.org > 0.6 ? '#4fd18b' : o.org > 0.3 ? '#f5b800' : '#ff5a4e';
    c.fillRect(x - bw / 2, by, bw * Math.max(0, Math.min(1, o.org)), 2.5);
  }
  c.restore();
}

/** Same symbol as an inline SVG string, for DOM panels. */
export function unitSymbolSvg(type: UnitType, color: string, w = 34, h = 22, echelon = ''): string {
  const pad = echelon ? 9 : 1;
  const W = w + 2, H = h + pad + 1;
  const x0 = 1, y0 = pad;
  const cx = x0 + w / 2, cy = y0 + h / 2, hw = (w - 2) / 2, hh = (h - 2) / 2;
  let m = '';
  switch (type) {
    case 'inf': m = `<path d="M${cx - hw} ${cy - hh}L${cx + hw} ${cy + hh}M${cx + hw} ${cy - hh}L${cx - hw} ${cy + hh}"/>`; break;
    case 'arm': m = `<ellipse cx="${cx}" cy="${cy}" rx="${hw * 0.62}" ry="${hh * 0.52}"/>`; break;
    case 'art': m = `<circle cx="${cx}" cy="${cy}" r="${Math.min(hw, hh) * 0.3}" fill="#fff"/>`; break;
    case 'mar': {
      const wy = cy + hh * 0.62, amp = hh * 0.18;
      let d = `M${cx - hw * 0.8} ${wy}`;
      for (let i = 1; i <= 8; i++) d += `L${cx - hw * 0.8 + (i * hw * 1.6) / 8} ${wy + (i % 2 ? -amp : amp)}`;
      m = `<path d="M${cx - hw} ${cy - hh}L${cx + hw} ${cy + hh * 0.2}M${cx + hw} ${cy - hh}L${cx - hw} ${cy + hh * 0.2}"/><path d="${d}"/>`;
      break;
    }
  }
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  return `<svg class="usym" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">` +
    (echelon ? `<text x="${cx}" y="${pad - 2}" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="9" fill="#fff">${echelon}</text>` : '') +
    `<clipPath id="${id}"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="3"/></clipPath>` +
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="3" fill="${shade(color, 0.82)}" stroke="#fff" stroke-width="1.6"/>` +
    `<g clip-path="url(#${id})" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round">${m}</g></svg>`;
}

/** Line icons (24×24, stroke) for buildings: used on the map and in panels. */
export const BUILD_ICON_D: Record<'pabrik' | 'pabrikMil' | 'benteng' | 'pelabuhan' | 'kota' | 'jalan', string> = {
  pabrik: 'M3 21V10l5 3v-3l5 3V6h4v15zM3 21h18',
  pabrikMil: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  benteng: 'M4 21V9h3V6h3v3h4V6h3v3h3v12zM10 21v-5h4v5',
  pelabuhan: 'M12 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 7.5V21M5 13.5a7 7 0 0 0 14 0M8.5 10.5h7',
  kota: 'M3 21V11h6v10M9 21V4h7v17M16 21v-8h5v8M12 8h1M12 12h1M12 16h1',
  jalan: 'M7 21L10 3M17 21L14 3M12 5v2.5M12 10.5V13M12 16v2.5',
};

/** Round dark badge with a line icon, screen space. */
export function drawIconBadge(c: CanvasRenderingContext2D, d: string, x: number, y: number, size = 22, ring = 'rgba(255,255,255,0.85)') {
  c.save();
  c.beginPath();
  c.arc(x, y, size / 2, 0, Math.PI * 2);
  c.fillStyle = 'rgba(11,17,24,0.92)';
  c.shadowColor = 'rgba(0,0,0,0.5)';
  c.shadowBlur = 5;
  c.fill();
  c.shadowColor = 'transparent';
  c.strokeStyle = ring;
  c.lineWidth = 1.2;
  c.stroke();
  const k = (size * 0.62) / 24;
  c.translate(x - 12 * k, y - 12 * k);
  c.scale(k, k);
  c.strokeStyle = '#fff';
  c.lineWidth = 2 / k * 0.75;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke(new Path2D(d));
  c.restore();
}
