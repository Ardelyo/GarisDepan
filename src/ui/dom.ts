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
  trash: '<path d="M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 21 H17 L18 7"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11 V16.5 M12 7.6 V7.5"/>',
  group: '<rect x="3" y="5" width="9" height="6" rx="1"/><rect x="12" y="13" width="9" height="6" rx="1"/><path d="M7.5 11 V16 H12"/>',
  close: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
};
