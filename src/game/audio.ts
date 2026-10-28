/**
 * audio.ts — Web Audio synthesized SFX + simple adaptive music + mute toggle (remembered in localStorage).
 * No audio asset files at all — everything is synthesized at runtime.
 */

import type { Surface } from "./world";

export type SfxId = "move" | "hit" | "pickup" | "ui" | "explosion" | "win" | "lose";

const MUTE_KEY = "game.muted";

// localStorage can throw (storage disabled, private mode, third-party storage blocked
// inside a preview iframe) — a game must never fail to start because of that.
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMuted(v: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    // not persisted this session; the in-memory flag still works
  }
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicOsc: OscillatorNode | null = null;
  private disposed = false;
  muted = false;

  // browsers require a first user interaction before the AudioContext can start
  private readonly unlock = () => {
    this.ensureCtx();
    this.detachUnlock();
  };

  constructor() {
    this.muted = readMuted();
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  private detachUnlock(): void {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }

  /**
   * Release everything: unlock listeners, the music oscillator and the AudioContext.
   * Call it from your teardown path (stopGame) next to input.dispose() — otherwise React
   * StrictMode's double mount / HMR leaks one AudioContext per mount, and Chrome caps a
   * page at about six of them.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachUnlock();
    this.stopMusic();
    this.master?.disconnect();
    this.master = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeMuted(this.muted);
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  sfx(id: SfxId): void {
    if (this.disposed || this.muted) return; // muted: no context is created either
    const ctx = this.ensureCtx();
    if (!this.master) return;
    const t = ctx.currentTime;
    const spec: Record<SfxId, [type: OscillatorType, f0: number, f1: number, dur: number, gain: number]> = {
      move: ["triangle", 105, 68, 0.065, 0.055],
      hit: ["square", 160, 60, 0.12, 0.3],
      pickup: ["sine", 660, 990, 0.12, 0.25],
      ui: ["sine", 440, 520, 0.05, 0.15],
      explosion: ["sawtooth", 120, 30, 0.4, 0.4],
      win: ["sine", 523, 1046, 0.5, 0.3],
      lose: ["sawtooth", 220, 55, 0.6, 0.3],
    };
    const [type, f0, f1, dur, g] = spec[id];
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env.gain.setValueAtTime(g, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  scream(): void {
    if (this.disposed || this.muted) return;
    const ctx = this.ensureCtx(); if (!this.master) return;
    const t = ctx.currentTime;
    for (const [frequency, detune, gainValue] of [[740, -18, 0.2], [913, 23, 0.14]] as const) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      osc.type = "sawtooth"; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(115, t + 0.72); osc.detune.value = detune;
      filter.type = "bandpass"; filter.frequency.setValueAtTime(1250, t); filter.frequency.exponentialRampToValueAtTime(280, t + 0.72); filter.Q.value = 1.8;
      gain.gain.setValueAtTime(gainValue, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      osc.connect(filter).connect(gain).connect(this.master); osc.start(t); osc.stop(t + 0.76);
    }
  }

  step(surface: Surface, weight = 75): void {
    if (this.disposed || this.muted) return;
    const ctx = this.ensureCtx();
    if (!this.master) return;
    const profiles: Record<Surface, { frequency: number; end: number; duration: number; noise: number; tone: number; filter: number }> = {
      road: { frequency: 175, end: 82, duration: 0.075, noise: 0.045, tone: 0.09, filter: 1450 },
      trail: { frequency: 132, end: 65, duration: 0.09, noise: 0.075, tone: 0.07, filter: 720 },
      microtrail: { frequency: 124, end: 61, duration: 0.095, noise: 0.09, tone: 0.06, filter: 820 },
      grass: { frequency: 105, end: 62, duration: 0.1, noise: 0.1, tone: 0.035, filter: 850 },
      meadow: { frequency: 112, end: 68, duration: 0.1, noise: 0.105, tone: 0.035, filter: 960 },
      rough: { frequency: 96, end: 52, duration: 0.13, noise: 0.14, tone: 0.045, filter: 1050 },
      slow: { frequency: 90, end: 48, duration: 0.14, noise: 0.17, tone: 0.04, filter: 1250 },
      walk: { frequency: 86, end: 45, duration: 0.15, noise: 0.19, tone: 0.04, filter: 1180 },
      fight: { frequency: 82, end: 42, duration: 0.16, noise: 0.21, tone: 0.045, filter: 1350 },
      fallen: { frequency: 118, end: 45, duration: 0.13, noise: 0.13, tone: 0.08, filter: 680 },
      thorn: { frequency: 92, end: 40, duration: 0.17, noise: 0.22, tone: 0.05, filter: 1700 },
      marsh: { frequency: 74, end: 38, duration: 0.18, noise: 0.16, tone: 0.075, filter: 390 },
      water: { frequency: 138, end: 48, duration: 0.2, noise: 0.23, tone: 0.065, filter: 1050 },
    };
    const p = profiles[surface], t = ctx.currentTime;
    const weightPitch = Math.sqrt(75 / Math.max(35, Math.min(200, weight)));
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.type = surface === "road" || surface === "fallen" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(p.frequency * weightPitch, t);
    osc.frequency.exponentialRampToValueAtTime(p.end * weightPitch, t + p.duration);
    env.gain.setValueAtTime(p.tone, t); env.gain.exponentialRampToValueAtTime(0.001, t + p.duration);
    osc.connect(env).connect(this.master); osc.start(t); osc.stop(t + p.duration);

    const frames = Math.max(1, Math.floor(ctx.sampleRate * p.duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate), data = buffer.getChannelData(0);
    let seed = 193 + Math.floor(t * 1000) % 997;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 1073741823.5 - 1) * (1 - i / frames);
    }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), noiseGain = ctx.createGain();
    source.buffer = buffer; filter.type = surface === "marsh" ? "lowpass" : "bandpass"; filter.frequency.value = p.filter * weightPitch; filter.Q.value = 0.75;
    noiseGain.gain.setValueAtTime(p.noise, t); noiseGain.gain.exponentialRampToValueAtTime(0.001, t + p.duration);
    source.connect(filter).connect(noiseGain).connect(this.master); source.start(t);
  }

  /** Minimal adaptive background pulse (replace with a full score). */
  startMusic(): void {
    if (this.disposed) return;
    const ctx = this.ensureCtx();
    if (this.musicOsc) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 55; // A1 sustained bass
    gain.gain.value = 0.06;
    osc.connect(gain).connect(this.master!);
    osc.start();
    this.musicOsc = osc;
  }

  stopMusic(): void {
    this.musicOsc?.stop();
    this.musicOsc = null;
  }
}
