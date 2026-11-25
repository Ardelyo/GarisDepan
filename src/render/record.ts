/**
 * "Rekam Resolusi": composes the live canvas into a vertical 9:16 frame with
 * date stamp + stats and records it via MediaRecorder (WebM).
 */
export class Recorder {
  private out: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  active = false;

  constructor(private src: HTMLCanvasElement) {
    this.out = document.createElement('canvas');
    this.out.width = 720;
    this.out.height = 1280;
    this.ctx = this.out.getContext('2d')!;
  }

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  }

  start() {
    if (!Recorder.supported() || this.active) return false;
    const stream = this.out.captureStream(30);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(200);
    this.active = true;
    return true;
  }

  frame(date: string, lines: { text: string; color: string }[], title: string) {
    if (!this.active) return;
    const { ctx, out, src } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    // cover-crop source into 9:16
    const sr = src.width / src.height, dr = out.width / out.height;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sr > dr) { sw = src.height * dr; sx = (src.width - sw) / 2; } else { sh = src.width / dr; sy = (src.height - sh) / 2; }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
    ctx.textAlign = 'left';
    ctx.font = "800 54px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#fff';
    ctx.strokeText(date, 36, 92);
    ctx.fillText(date, 36, 92);
    ctx.font = "700 28px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.strokeText(title, 38, 132);
    ctx.fillText(title, 38, 132);
    ctx.font = "800 40px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    lines.forEach((l, i) => {
      const y = out.height - 60 - (lines.length - 1 - i) * 46;
      ctx.strokeText(l.text, 36, y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, 36, y);
    });
    ctx.font = "700 22px 'Barlow Condensed', sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('GARIS DEPAN', out.width - 30, out.height - 30);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.rec || !this.active) return resolve(null);
      this.rec.onstop = () => {
        this.active = false;
        resolve(new Blob(this.chunks, { type: this.rec?.mimeType || 'video/webm' }));
      };
      this.rec.stop();
    });
  }
}
