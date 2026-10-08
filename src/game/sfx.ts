export type SoundId = 'coin' | 'jump' | 'roll' | 'powerUp' | 'stumble' | 'crash';

export class Sfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  played = 0;
  last: SoundId | null = null;

  unlock(): void {
    if (!this.context) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  play(id: SoundId): void {
    this.played++;
    this.last = id;
    const ctx = this.context;
    const out = this.master;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    switch (id) {
      case 'jump':
        this.tone(ctx, out, 'square', t, 0.16, [260, 620], 0.25);
        break;
      case 'roll':
        this.noise(ctx, out, t, 0.22, 1800, 400, 0.5);
        break;
      case 'coin':
        this.tone(ctx, out, 'sine', t, 0.07, [1320, 1320], 0.3);
        this.tone(ctx, out, 'sine', t + 0.06, 0.12, [1980, 1980], 0.3);
        break;
      case 'powerUp':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, out, 'triangle', t + i * 0.06, 0.1, [f, f], 0.3));
        break;
      case 'stumble':
        this.tone(ctx, out, 'sawtooth', t, 0.2, [180, 70], 0.3);
        break;
      case 'crash':
        this.noise(ctx, out, t, 0.45, 900, 120, 0.8);
        this.tone(ctx, out, 'square', t, 0.4, [120, 40], 0.35);
        break;
    }
  }

  private tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, t: number, length: number, [from, to]: [number, number], level: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  private noise(ctx: AudioContext, out: AudioNode, t: number, length: number, fromHz: number, toHz: number, level: number): void {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(fromHz, t);
    filter.frequency.exponentialRampToValueAtTime(toHz, t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    source.connect(filter).connect(gain).connect(out);
    source.start(t);
  }
}
