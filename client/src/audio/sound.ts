/* ===================================================================
 * Sistema de Áudio Procedural + Rádio Veicular + Áudio Espacial
 * (WebAudio API pura — zero dependência de arquivos externos quebrados)
 * =================================================================== */

export interface RadioStation {
  name: string;
  genre: string;
  bpm: number;
  notes: number[];
  wave: OscillatorType;
}

export const RADIO_STATIONS: RadioStation[] = [
  { name: 'Desligado', genre: 'Silêncio', bpm: 0, notes: [], wave: 'sine' },
  { name: 'Aurora Synth FM 104.7', genre: 'Synthwave Costeiro', bpm: 112, notes: [220, 261.63, 329.63, 392, 329.63, 293.66, 261.63, 196], wave: 'sawtooth' },
  { name: 'Sertão & Estrada 98.1', genre: 'Folk / Country Rock', bpm: 96, notes: [196, 246.94, 293.66, 392, 329.63, 293.66, 246.94, 220], wave: 'triangle' },
  { name: 'Porto Bass 107.9', genre: 'Electro / Club', bpm: 128, notes: [130.81, 130.81, 196, 155.56, 174.61, 130.81, 233.08, 196], wave: 'square' },
  { name: 'Mirante Jazz Lounge 91.3', genre: 'Chill / Sunset', bpm: 82, notes: [261.63, 311.13, 349.23, 392, 466.16, 392, 349.23, 293.66], wave: 'sine' },
];

export class SoundEngine {
  ctx: AudioContext | null = null;
  masterVolume = 0.8;
  sfxVolume = 0.85;
  musicVolume = 0.55;
  radioVolume = 0.65;

  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private radioTimer: number | null = null;
  private radioIdx = 1;
  private radioStep = 0;
  private inVehicle = false;
  private menuMusicTimer: number | null = null;

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private gain(val: number) {
    const ctx = this.ensure();
    if (!ctx) return null;
    const g = ctx.createGain();
    g.gain.value = val * this.masterVolume;
    g.connect(ctx.destination);
    return g;
  }

  playUiClick() {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = this.gain(0.08 * this.sfxVolume)!;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.045);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.055);
  }

  playShot(category: string, dist = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const atten = Math.max(0.05, 1 - dist / 180);
    const vol = 0.24 * this.sfxVolume * atten;
    const dur = category === 'shotgun' || category === 'sniper' || category === 'heavy' ? 0.26 : 0.14;

    // ruído branco filtrado para estampido
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * (dur * 0.35)));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = category === 'sniper' || category === 'shotgun' ? 680 : 1200;

    const g = this.gain(vol)!;
    src.connect(filter);
    filter.connect(g);
    src.start();
  }

  playExplosion(dist = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const atten = Math.max(0.08, 1 - dist / 260);
    const dur = 0.7;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.22));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    const g = this.gain(0.42 * this.sfxVolume * atten)!;
    src.connect(filter);
    filter.connect(g);
    src.start();
  }

  playFootstep(surface: 'asphalt' | 'sand' | 'grass' | 'water' = 'asphalt') {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = this.gain(0.05 * this.sfxVolume)!;
    osc.type = surface === 'water' ? 'sine' : 'triangle';
    const base = surface === 'water' ? 190 : surface === 'sand' ? 140 : 110;
    osc.frequency.setValueAtTime(base + Math.random() * 25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + 0.065);
  }

  playHorn() {
    const ctx = this.ensure();
    if (!ctx) return;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = this.gain(0.14 * this.sfxVolume)!;
    o1.type = 'sawtooth'; o2.type = 'sawtooth';
    o1.frequency.value = 392;
    o2.frequency.value = 493.88;
    o1.connect(g); o2.connect(g);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o1.start(); o2.start();
    o1.stop(ctx.currentTime + 0.26); o2.stop(ctx.currentTime + 0.26);
  }

  updateEngine(active: boolean, speedAbs: number, maxSpeed: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (!active) {
      if (this.engineOsc) {
        try { this.engineOsc.stop(); } catch { /* ignore */ }
        this.engineOsc.disconnect();
        this.engineOsc = null;
        this.engineGain = null;
      }
      if (this.inVehicle) {
        this.inVehicle = false;
        this.stopRadio();
      }
      return;
    }
    if (!this.inVehicle) {
      this.inVehicle = true;
      this.startRadio();
    }
    if (!this.engineOsc) {
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0.06 * this.sfxVolume * this.masterVolume;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(ctx.destination);
      this.engineOsc.start();
    }
    const ratio = Math.min(1, speedAbs / Math.max(10, maxSpeed));
    const gearMod = (ratio * 4) % 1;
    const freq = 48 + ratio * 75 + gearMod * 38;
    this.engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
    if (this.engineGain) {
      this.engineGain.gain.setTargetAtTime((0.045 + ratio * 0.05) * this.sfxVolume * this.masterVolume, ctx.currentTime, 0.08);
    }
  }

  get currentStation(): RadioStation {
    return RADIO_STATIONS[this.radioIdx];
  }

  cycleRadio(): RadioStation {
    this.radioIdx = (this.radioIdx + 1) % RADIO_STATIONS.length;
    if (this.inVehicle) {
      this.stopRadio();
      this.startRadio();
    }
    return this.currentStation;
  }

  private startRadio() {
    this.stopRadio();
    const st = this.currentStation;
    if (!st || st.bpm <= 0 || st.notes.length === 0) return;
    const interval = Math.round((60 / st.bpm) * 500);
    this.radioTimer = window.setInterval(() => {
      if (!this.inVehicle || this.radioVolume <= 0.01) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const note = st.notes[this.radioStep % st.notes.length];
      this.radioStep++;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 950;
      const g = this.gain(0.045 * this.radioVolume)!;
      osc.type = st.wave;
      osc.frequency.setValueAtTime(note, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + interval / 1000);
      osc.connect(filter);
      filter.connect(g);
      osc.start();
      osc.stop(ctx.currentTime + interval / 1000 + 0.02);
    }, interval);
  }

  private stopRadio() {
    if (this.radioTimer !== null) {
      clearInterval(this.radioTimer);
      this.radioTimer = null;
    }
  }

  startMenuAmbience() {
    this.stopMenuAmbience();
    const chord = [130.81, 164.81, 196.0, 246.94, 293.66];
    let idx = 0;
    this.menuMusicTimer = window.setInterval(() => {
      if (this.musicVolume <= 0.01) return;
      const ctx = this.ensure();
      if (!ctx || ctx.state !== 'running') return;
      const freq = chord[idx % chord.length];
      idx++;
      const osc = ctx.createOscillator();
      const g = this.gain(0.03 * this.musicVolume)!;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 1.8);
      osc.connect(g);
      osc.start();
      osc.stop(ctx.currentTime + 1.85);
    }, 1900);
  }

  stopMenuAmbience() {
    if (this.menuMusicTimer !== null) {
      clearInterval(this.menuMusicTimer);
      this.menuMusicTimer = null;
    }
  }
}
