// Synthesized sound effects and a light music loop (Web Audio, no audio files).
// Browsers start audio suspended until a user gesture, so unlock() runs on the
// first remote key press or click.

type Ctx = AudioContext;

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export class Sound {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private musicNext = 0;

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    } catch (_e) {
      this.ctx = null;
    }
  }

  /** Sound can play (the browser allowed audio). */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): OscillatorNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return null;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    return osc;
  }

  private noise(at: number, dur: number, filter: BiquadFilterType, freq: number, vol: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(gain);
    gain.connect(this.master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime + 0.01 : 0;
  }

  pop(): void {
    const t = this.now;
    this.noise(t, 0.08, 'highpass', 1800, 0.5);
    this.tone(900, t, 0.1, 'sine', 0.35, 180);
  }

  /** "Hee-hee": more notes and higher pitch for each giggle stage. */
  giggle(stage: number, voice = 0): void {
    const t = this.now;
    const base = 620 + stage * 90 + (voice % 3) * 70;
    for (let i = 0; i <= stage; i++) {
      const at = t + i * 0.11;
      const osc = this.tone(base * (1 - i * 0.06), at, 0.08, 'triangle', 0.22, base * 0.8);
      if (osc && this.ctx) {
        // a quick wobble makes the tone sound like a giggle
        const lfo = this.ctx.createOscillator();
        const depth = this.ctx.createGain();
        lfo.frequency.value = 28;
        depth.gain.value = 45;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(at);
        lfo.stop(at + 0.1);
      }
    }
  }

  whoosh(): void {
    this.noise(this.now, 0.45, 'bandpass', 400, 0.25, 2200);
  }

  achoo(): void {
    const t = this.now;
    this.tone(300, t, 0.28, 'sawtooth', 0.08, 420);
    this.noise(t + 0.3, 0.25, 'highpass', 2500, 0.45);
  }

  yawn(): void {
    this.tone(420, this.now, 0.6, 'triangle', 0.15, 220);
  }

  select(): void {
    const t = this.now;
    this.tone(880, t, 0.12, 'sine', 0.3);
    this.tone(1320, t + 0.1, 0.18, 'sine', 0.3);
  }

  cheer(): void {
    const t = this.now;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, t + i * 0.09, 0.25, 'triangle', 0.28));
  }

  /** Light bouncy loop (pentatonic, so random notes always sound nice). */
  startMusic(seed = 1): void {
    if (this.musicTimer || !this.ctx) return;
    let s = seed;
    const pattern: number[] = [];
    for (let i = 0; i < 16; i++) {
      s = (s * 9301 + 49297) % 233280;
      pattern.push(i % 4 === 3 && s % 3 === 0 ? -1 : s % PENTATONIC.length);
    }
    const stepSec = 60 / 112 / 2;
    this.musicStep = 0;
    this.musicNext = 0;
    this.musicTimer = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      if (this.musicNext < ctx.currentTime) this.musicNext = ctx.currentTime + 0.05;
      while (this.musicNext < ctx.currentTime + 0.25) {
        const step = this.musicStep % 16;
        const note = pattern[step];
        if (note >= 0) this.tone(PENTATONIC[note], this.musicNext, stepSec * 0.9, 'square', 0.035);
        if (step % 4 === 0) this.tone(PENTATONIC[[0, 3, 4, 2][Math.floor(step / 4)]] / 4, this.musicNext, stepSec * 1.8, 'triangle', 0.12);
        this.musicNext += stepSec;
        this.musicStep++;
      }
    }, 60);
  }

  stopMusic(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
