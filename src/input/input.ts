import type { Pt } from '../core/geom';
import type { Renderer } from '../render/renderer';

export interface InputHandlers {
  /** Return true to treat this drag as a drawing stroke (else it pans). */
  strokeStart(sx: number, sy: number): boolean;
  strokeMove(sx: number, sy: number): void;
  strokeEnd(pts: Pt[]): void;
  strokeCancel(): void;
  tap(sx: number, sy: number): void;
  longPress(sx: number, sy: number): void;
  wheelDuringStroke(dir: number): void;
  threeFingerSwipe(dir: number): void;
  onCameraMove(): void;
}

/** Touch-first input: 1 finger draws, 2 fingers pan/pinch, long-press = context, mouse right-drag pans. */
export class Input {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private mode: 'none' | 'pending' | 'draw' | 'pan' | 'pinch' = 'none';
  private stroke: Pt[] = [];
  private lpTimer = 0;
  private downT = 0;
  private pinch = { d: 0, cx: 0, cy: 0, zoom: 1, wx: 0, wy: 0 };
  private three: { x: number; t: number } | null = null;
  keys = new Set<string>();

  constructor(private el: HTMLCanvasElement, private r: Renderer, private h: InputHandlers) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', this.wheel, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private local(e: PointerEvent | WheelEvent) {
    const b = this.el.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  private down = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (this.pointers.size === 1) {
      this.downT = performance.now();
      if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1)) {
        this.mode = 'pan';
        return;
      }
      this.mode = 'pending';
      this.stroke = [this.r.screenToWorld(p.x, p.y)];
      clearTimeout(this.lpTimer);
      this.lpTimer = window.setTimeout(() => {
        if (this.mode === 'pending') {
          this.mode = 'none';
          this.h.longPress(p.x, p.y);
        }
      }, 520);
    } else if (this.pointers.size === 2) {
      if (this.mode === 'draw') this.h.strokeCancel();
      clearTimeout(this.lpTimer);
      this.mode = 'pinch';
      this.startPinch();
    } else if (this.pointers.size === 3) {
      if (this.mode === 'draw') this.h.strokeCancel();
      this.mode = 'none';
      const xs = [...this.pointers.values()].map((q) => q.x);
      this.three = { x: xs.reduce((a, b) => a + b, 0) / 3, t: performance.now() };
    }
  };

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const w = this.r.screenToWorld(cx, cy);
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx, cy, zoom: this.r.cam.zoom, wx: w.x, wy: w.y };
  }

  private move = (e: PointerEvent) => {
    const q = this.pointers.get(e.pointerId);
    if (!q) return;
    const p = this.local(e);
    const dx = p.x - q.x, dy = p.y - q.y;
    q.x = p.x;
    q.y = p.y;
    if (this.mode === 'pending') {
      if (Math.hypot(p.x - q.sx, p.y - q.sy) > 7) {
        clearTimeout(this.lpTimer);
        if (this.h.strokeStart(q.sx, q.sy)) {
          this.mode = 'draw';
          this.h.strokeMove(p.x, p.y);
          this.stroke.push(this.r.screenToWorld(p.x, p.y));
        } else this.mode = 'pan';
      }
    } else if (this.mode === 'draw') {
      this.stroke.push(this.r.screenToWorld(p.x, p.y));
      this.h.strokeMove(p.x, p.y);
    } else if (this.mode === 'pan') {
      this.r.cam.x -= dx / this.r.cam.zoom;
      this.r.cam.y -= dy / this.r.cam.zoom;
      this.r.clampCam();
      this.h.onCameraMove();
    } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.r.cam.zoom = this.pinch.zoom * (d / Math.max(10, this.pinch.d));
      this.r.clampCam();
      // keep the pinch centre anchored
      this.r.cam.x = this.pinch.wx - (cx - this.r.W / 2) / this.r.cam.zoom;
      this.r.cam.y = this.pinch.wy - (cy - this.r.H / 2) / this.r.cam.zoom;
      this.r.clampCam();
      this.h.onCameraMove();
    }
  };

  private up = (e: PointerEvent) => {
    const q = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    clearTimeout(this.lpTimer);
    if (this.three && this.pointers.size === 2 && q) {
      const dx = q.x - q.sx;
      if (Math.abs(dx) > 50 && performance.now() - this.three.t < 900) this.h.threeFingerSwipe(Math.sign(dx));
      this.three = null;
    }
    if (this.mode === 'pending' && q && this.pointers.size === 0) {
      if (performance.now() - this.downT < 500) this.h.tap(q.x, q.y);
      this.mode = 'none';
    } else if (this.mode === 'draw' && this.pointers.size === 0) {
      this.h.strokeEnd(this.stroke);
      this.mode = 'none';
    } else if (this.mode === 'pinch' && this.pointers.size === 1) {
      this.mode = 'pan';
    } else if (this.pointers.size === 0) this.mode = 'none';
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'draw') this.h.strokeCancel();
    this.mode = 'none';
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.mode === 'draw') {
      this.h.wheelDuringStroke(Math.sign(e.deltaY));
      return;
    }
    const p = this.local(e);
    const before = this.r.screenToWorld(p.x, p.y);
    this.r.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
    this.r.clampCam();
    const after = this.r.screenToWorld(p.x, p.y);
    this.r.cam.x += before.x - after.x;
    this.r.cam.y += before.y - after.y;
    this.r.clampCam();
    this.h.onCameraMove();
  };

  /** Keyboard panning (WASD / arrows); call each frame. */
  tick(dt: number) {
    const k = this.keys;
    const sp = (600 * dt) / 1000 / this.r.cam.zoom;
    let moved = false;
    if (k.has('a') || k.has('arrowleft')) { this.r.cam.x -= sp; moved = true; }
    if (k.has('d') || k.has('arrowright')) { this.r.cam.x += sp; moved = true; }
    if (k.has('w') || k.has('arrowup')) { this.r.cam.y -= sp; moved = true; }
    if (k.has('s') || k.has('arrowdown')) { this.r.cam.y += sp; moved = true; }
    if (moved) { this.r.clampCam(); this.h.onCameraMove(); }
  }
}
