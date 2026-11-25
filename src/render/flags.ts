import type { FlagSpec } from '../sim/types';

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** Draw a procedural flag into the rect (x, y, w, h). */
export function drawFlag(ctx: CanvasRenderingContext2D, f: FlagSpec, x: number, y: number, w: number, h: number) {
  const [a, b, c] = f.colors;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  switch (f.layout) {
    case 'triV':
      ctx.fillStyle = b; ctx.fillRect(x, y, w / 3, h);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + w / 3, y, w / 3, h);
      ctx.fillStyle = a; ctx.fillRect(x + (2 * w) / 3, y, w / 3 + 1, h);
      break;
    case 'triH':
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h / 3);
      ctx.fillStyle = b; ctx.fillRect(x, y + h / 3, w, h / 3);
      ctx.fillStyle = c; ctx.fillRect(x, y + (2 * h) / 3, w, h / 3 + 1);
      break;
    case 'biH':
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h / 2);
      ctx.fillStyle = b; ctx.fillRect(x, y + h / 2, w, h / 2 + 1);
      break;
    case 'cross':
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = b;
      ctx.fillRect(x + w * 0.3, y, w * 0.16, h);
      ctx.fillRect(x, y + h * 0.42, w, h * 0.16);
      break;
    case 'canton':
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h);
      for (let i = 1; i < 5; i += 2) { ctx.fillStyle = c; ctx.fillRect(x, y + (i * h) / 5, w, h / 5); }
      ctx.fillStyle = b; ctx.fillRect(x, y, w * 0.42, h * 0.6);
      break;
    case 'circle':
      ctx.fillStyle = b === '#111111' ? '#ffffff' : b; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = a; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.3, 0, Math.PI * 2); ctx.fill();
      break;
    case 'diag':
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = h * 0.18; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y); ctx.stroke();
      break;
    case 'chevron':
      ctx.fillStyle = a; ctx.fillRect(x, y, w, h / 2);
      ctx.fillStyle = c; ctx.fillRect(x, y + h / 2, w, h / 2 + 1);
      ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.45, y + h / 2); ctx.lineTo(x, y + h); ctx.fill();
      break;
  }
  const emb = f.emblem;
  if (emb !== 'none') {
    ctx.fillStyle = f.layout === 'circle' ? b : '#ffffff';
    if (f.layout === 'triV' || f.layout === 'canton' || f.layout === 'chevron') ctx.fillStyle = f.layout === 'triV' ? a : '#ffffff';
    const ex = f.layout === 'canton' ? x + w * 0.21 : f.layout === 'chevron' ? x + w * 0.16 : x + w / 2;
    const ey = f.layout === 'canton' ? y + h * 0.3 : y + h / 2;
    const r = h * (f.layout === 'canton' || f.layout === 'chevron' ? 0.17 : 0.24);
    if (emb === 'star') star(ctx, ex, ey, r);
    else if (emb === 'circle') { ctx.beginPath(); ctx.arc(ex, ey, r * 0.8, 0, Math.PI * 2); ctx.fill(); }
    else { star(ctx, ex - r * 1.2, ey, r * 0.6); star(ctx, ex, ey, r * 0.6); star(ctx, ex + r * 1.2, ey, r * 0.6); }
  }
  ctx.restore();
}

const cache = new Map<string, HTMLCanvasElement>();

/** Cached flag bitmap at given CSS size, rendered at 2× for crispness. */
export function flagBitmap(f: FlagSpec, w: number, h: number): HTMLCanvasElement {
  const key = JSON.stringify(f) + w + 'x' + h;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w * 2 + 4;
  c.height = h * 2 + 4;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0.5, 0.5, w + 1, h + 1);
  drawFlag(ctx, f, 1, 1, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(1, 1, w, h);
  cache.set(key, c);
  return c;
}

/** Flag as data URL for DOM usage. */
export function flagDataUrl(f: FlagSpec, w = 36, h = 24): string {
  return flagBitmap(f, w, h).toDataURL();
}
