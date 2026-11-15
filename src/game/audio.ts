/**
 * Small synthesized sound effects (no audio files). The context starts on the
 * first click or key press, as browsers require.
 */
export type Sfx =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'block'
  | 'hurt'
  | 'bones'
  | 'cast'
  | 'potion'
  | 'pickup'
  | 'pillar'
  | 'rise'
  | 'door'
  | 'clear'
  | 'victory'
  | 'defeat'
  | 'click';

export class Audio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();

  constructor() {
    const unlock = (): void => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  play(name: Sfx): void {
    const ctx = this.ensure();
    if (!ctx || this.muted || ctx.state !== 'running') return;
    // Many hits in the same frame should not stack into a roar.
    const now = ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < 0.035) return;
    this.last.set(name, now);
    switch (name) {
      case 'swing':
        return this.whoosh(now, 0.16, 900, 2600, 0.18);
      case 'hit':
        this.thud(now, 150, 0.12, 0.5);
        return this.whoosh(now, 0.06, 2500, 1200, 0.18);
      case 'crit':
        this.thud(now, 110, 0.2, 0.7);
        return this.tone(now, [880, 1320], 0.18, 'triangle', 0.18);
      case 'block':
        return this.tone(now, [1900, 2400], 0.09, 'square', 0.07);
      case 'hurt':
        this.thud(now, 90, 0.18, 0.55);
        return this.tone(now, [320, 180], 0.16, 'sawtooth', 0.08);
      case 'bones':
        for (let i = 0; i < 5; i++) this.click(now + i * 0.045 + Math.random() * 0.02, 1400 + Math.random() * 1500);
        return;
      case 'cast':
        return this.tone(now, [520, 1040], 0.22, 'sine', 0.12);
      case 'potion':
        for (let i = 0; i < 4; i++) this.tone(now + i * 0.07, [400 + i * 140, 700 + i * 160], 0.09, 'sine', 0.12);
        return;
      case 'pickup':
        return this.arp(now, [784, 988, 1319], 0.07, 0.14);
      case 'pillar':
        return this.arp(now, [523, 659, 784, 1047, 1319], 0.09, 0.16, 0.6);
      case 'rise':
        return this.tone(now, [70, 140], 0.9, 'sawtooth', 0.09);
      case 'door':
        this.tone(now, [60, 48], 1.4, 'sawtooth', 0.1);
        return this.arp(now + 0.4, [392, 523, 659], 0.12, 0.1, 0.8);
      case 'clear':
        return this.arp(now, [523, 659, 784, 1047], 0.11, 0.16, 0.7);
      case 'victory':
        this.arp(now, [523, 659, 784, 1047, 784, 1047, 1319], 0.13, 0.17, 1.2);
        return this.arp(now + 0.02, [262, 330, 392, 523], 0.26, 0.09, 1.4);
      case 'defeat':
        return this.arp(now, [392, 330, 262, 196], 0.22, 0.13, 0.9);
      case 'click':
        return this.tone(now, [700, 900], 0.05, 'sine', 0.06);
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  private envelope(at: number, duration: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.012, duration / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    g.connect(this.master!);
    return g;
  }

  private tone(at: number, [from, to]: [number, number], duration: number, type: OscillatorType, peak: number): void {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + duration);
    o.connect(this.envelope(at, duration, peak));
    o.start(at);
    o.stop(at + duration + 0.02);
  }

  private arp(at: number, notes: number[], step: number, peak: number, tail = 0.3): void {
    notes.forEach((f, i) => this.tone(at + i * step, [f, f * 1.003], tail, 'triangle', peak));
  }

  private whoosh(at: number, duration: number, from: number, to: number, peak: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx!.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    src.connect(filter).connect(this.envelope(at, duration, peak));
    src.start(at, Math.random() * 0.5);
    src.stop(at + duration + 0.02);
  }

  private thud(at: number, freq: number, duration: number, peak: number): void {
    this.tone(at, [freq, freq * 0.45], duration, 'sine', peak);
  }

  private click(at: number, freq: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx!.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = freq;
    src.connect(filter).connect(this.envelope(at, 0.035, 0.22));
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.05);
  }
}
