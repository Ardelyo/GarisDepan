type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** Minimal hyperscript helper. on* attributes become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k in el && k !== 'style' && k !== 'class' && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k === 'class' ? 'class' : k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(path: string, vb = '0 0 24 24'): HTMLElement {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return span.firstElementChild as HTMLElement;
}

/** Wrap an icon as an inline <svg> with the given size (px). */
export function iconEl(name: keyof typeof ICONS, size = 18): HTMLElement {
  const e = svg(ICONS[name]);
  e.setAttribute('width', String(size));
  e.setAttribute('height', String(size));
  return e;
}

/** data: URL for an icon, for drawing onto a canvas. */
export function iconUrl(name: keyof typeof ICONS, color: string, sw = 2.2): string {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

export const ICONS = {
  panah: '<path d="M4 19 C8 10 13 8 19 6"/><path d="M13 4.5 L19.5 5.5 L17 11.5"/>',
  gerak: '<path d="M4 19 L19 6" stroke-dasharray="3 3.5"/><path d="M13 5 L19 6 L18 12"/>',
  garis: '<path d="M3 17 C7 12 11 15 14 11 S19 8 21 6"/><path d="M6 15.5 l1.5 3 M10 14.5 l1 3 M14 11 l2 2.4 M18 8 l2 2"/>',
  udara: '<path d="M2 13 L10 11 L13 3 L15 3 L14 11 L21 12 L21 14 L14 14 L13 20 L15 22 L9 22 L11 20 L10 15 L2 15 Z" stroke-width="1.6"/>',
  bangun: '<path d="M3 21 V10 L8 13 V10 L13 13 V6 H17 V21 Z"/><path d="M3 21 H21"/>',
  hangus: '<path d="M5 5 L19 19 M19 5 L5 19"/>',
  undo: '<path d="M9 14 L4 9 L9 4"/><path d="M4 9 H14 A6 6 0 0 1 14 21 H10"/>',
  redo: '<path d="M15 14 L20 9 L15 4"/><path d="M20 9 H10 A6 6 0 0 0 10 21 H14"/>',
  menu: '<path d="M4 7 H20 M4 12 H20 M4 17 H20"/>',
  play: '<path d="M7 4 L19 12 L7 20 Z" fill="currentColor"/>',
  pause: '<path d="M7 4 V20 M17 4 V20" stroke-width="3.5"/>',
  replay: '<path d="M4 12 A8 8 0 1 0 7 5.7"/><path d="M4 3 V8 H9"/>',
  skip: '<path d="M5 4 L15 12 L5 20 Z" fill="currentColor"/><path d="M19 4 V20" stroke-width="3"/>',
  cam: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11 L21 8 V16 L16 13"/>',
  rec: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
  geser: '<path d="M9 11 V5.5 a1.5 1.5 0 0 1 3 0 V10 M12 10 V4.5 a1.5 1.5 0 0 1 3 0 V10 M15 10 V6.5 a1.5 1.5 0 0 1 3 0 V14 c0 4 -2.5 7 -6.5 7 c-3 0 -4.5 -1.7 -6 -4.5 l-2 -3.6 a1.4 1.4 0 0 1 2.3 -1.6 L9 14 V8.5 a1.5 1.5 0 0 1 0 0"/>',
  lainnya: '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11 V17 M12 7.2 V7.4"/>',
  tutup: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
  pabrik: '<path d="M3 21 V10 L9 14 V10 L15 14 V4 H19 V21 Z"/><path d="M3 21 H21"/>',
  pabrikMil: '<circle cx="12" cy="12" r="4"/><path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7.2 7.2 M16.8 16.8 L19 19 M5 19 L7.2 16.8 M16.8 7.2 L19 5"/>',
  benteng: '<path d="M4 21 V9 H7 V12 H10 V9 H14 V12 H17 V9 H20 V21 Z"/><path d="M10 21 V16 a2 2 0 0 1 4 0 V21"/>',
  pelabuhan: '<circle cx="12" cy="5" r="2"/><path d="M12 7 V20 M7 12 H17 M5 14 a7 7 0 0 0 14 0"/>',
  kota: '<path d="M3 21 V10 H9 V21 M9 21 V4 H16 V21 M16 21 V12 H21 V21 M3 21 H21"/>',
  jalan: '<path d="M8 3 L5 21 M16 3 L19 21 M12 5 V8 M12 11 V14 M12 17 V20"/>',
  rekrut: '<path d="M5 15 a7 7 0 0 1 14 0 V17 H5 Z"/><path d="M3 17 H21 M12 8 V6"/>',
  mata2: '<path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/>',
  perang: '<circle cx="12" cy="12" r="8"/><path d="M12 2 V7 M12 17 V22 M2 12 H7 M17 12 H22"/>',
  damai: '<path d="M5 19 C5 9 12 5 20 5 C20 13 15 19 5 19 Z"/><path d="M5 19 L13 11"/>',
  pesan: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7 L12 13 L21 7"/>',
  peringatan: '<path d="M12 3 L22 20 H2 Z"/><path d="M12 10 V14 M12 17 V17.2"/>',
  suara: '<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z"/><path d="M16 9 a4 4 0 0 1 0 6 M18.5 6.5 a8 8 0 0 1 0 11"/>',
  senyap: '<path d="M4 9 H8 L13 5 V19 L8 15 H4 Z"/><path d="M17 9 L22 15 M22 9 L17 15"/>',
  dadu: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9 V9.2 M15 9 V9.2 M12 12 V12.2 M9 15 V15.2 M15 15 V15.2" stroke-width="3"/>',
  manusia: '<circle cx="12" cy="8" r="4"/><path d="M4 21 a8 8 0 0 1 16 0"/>',
  ai: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2 V6 M15 2 V6 M9 18 V22 M15 18 V22 M2 9 H6 M2 15 H6 M18 9 H22 M18 15 H22"/>',
  satelit: '<circle cx="12" cy="12" r="9"/><path d="M3 12 H21 M12 3 a14 14 0 0 1 0 18 M12 3 a14 14 0 0 0 0 18"/>',
  kartun: '<path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z"/><path d="M14 6 L18 10"/>',
  getar: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8 V16 M20 8 V16"/>',
  trash: '<path d="M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 21 H17 L18 7"/>',
};
