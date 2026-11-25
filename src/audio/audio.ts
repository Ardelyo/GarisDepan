/** Tiny WebAudio synth: artillery thuds, marker scribble, plane drone, ambient pad. No asset files. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private scribble: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private pad: { gain: GainNode } | null = null;
  muted = false;
  private noiseBuf: AudioBuffer | null = null;

  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  unlock() {
    const c = this.ensure();
    if (c && c.state === 'suspended') void c.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  boom(intensity = 0.5) {
    const c = this.ensure();
    if (!c || !this.master || !this.noiseBuf || this.muted) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + intensity * 0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const og = c.createGain();
    og.gain.setValueAtTime(0.3 * intensity, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  sting(kind: 'capture' | 'moment' | 'curtain' | 'click') {
    const c = this.ensure();
    if (!c || !this.master || this.muted) return;
    const t = c.currentTime;
    const notes = kind === 'moment' ? [220, 277, 330] : kind === 'capture' ? [440, 660] : kind === 'curtain' ? [330, 247] : [880];
    notes.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = kind === 'moment' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      const st = t + i * (kind === 'moment' ? 0 : 0.07);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(kind === 'click' ? 0.05 : 0.12, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + (kind === 'moment' ? 0.9 : 0.25));
      const lp = c.createBiquadFilter();
      lp.frequency.value = 2200;
      o.connect(lp).connect(g).connect(this.master!);
      o.start(st);
      o.stop(st + 1);
    });
  }

  plane() {
    const c = this.ensure();
    if (!c || !this.master || this.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(70, t + 3);
    const lp = c.createBiquadFilter();
    lp.frequency.value = 400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 1);
    g.gain.linearRampToValueAtTime(0.0001, t + 3.2);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 3.3);
  }

  startScribble() {
    const c = this.ensure();
    if (!c || !this.master || !this.noiseBuf || this.muted || this.scribble) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(bp).connect(gain).connect(this.master);
    src.start();
    this.scribble = { src, gain };
  }
  scribbleSpeed(v: number) {
    if (this.scribble && this.ctx) this.scribble.gain.gain.setTargetAtTime(Math.min(0.12, v * 0.004), this.ctx.currentTime, 0.03);
  }
  stopScribble() {
    if (!this.scribble) return;
    this.scribble.src.stop();
    this.scribble = null;
  }

  /** Ambient drone whose intensity follows the number of active battles. */
  setIntensity(level: number) {
    const c = this.ensure();
    if (!c || !this.master) return;
    if (!this.pad) {
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      for (const f of [55, 82.4, 110, 164.8]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const lfo = c.createOscillator();
        lfo.frequency.value = 0.1 + Math.random() * 0.2;
        const lg = c.createGain();
        lg.gain.value = 2;
        lfo.connect(lg).connect(o.frequency);
        o.connect(gain);
        o.start();
        lfo.start();
      }
      this.pad = { gain };
    }
    this.pad.gain.gain.setTargetAtTime(this.muted ? 0 : 0.015 + Math.min(0.05, level * 0.012), c.currentTime, 1.2);
  }
}
