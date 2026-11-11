import type { Clip, ClipAudio } from '../types';
import { resolveVolume } from './animation';
import type { SequenceItem, SequenceTransition } from './sequence';
import { clipDuration } from './timelineModel';

// ---------------------------------------------------------------------------
// Shared audio model. The preview (live AudioContext) and the export
// (OfflineAudioContext) build the SAME processing chain from the same
// parameters and use the SAME gain envelope, so what you hear is what is
// exported:
//
//   source → rumble high-pass → noise gate → bass → 5-band EQ → treble
//          → stereo balance → clip gain (dB) → [envelope] → track volume → out
//
// The envelope = volume keyframes × fade in/out × transition crossfade.
// ---------------------------------------------------------------------------

export const EQ_BANDS = [60, 250, 1000, 4000, 12000] as const;
export const EQ_LABELS = ['60', '250', '1k', '4k', '12k'];

export const DEFAULT_CLIP_AUDIO: ClipAudio = {
  gainDb: 0,
  fadeIn: 0,
  fadeOut: 0,
  bass: 0,
  treble: 0,
  eq: [0, 0, 0, 0, 0],
  pan: 0,
  noiseReduction: 0,
};

export const clipAudio = (c: Clip): ClipAudio => ({ ...DEFAULT_CLIP_AUDIO, ...c.audio });
export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-6, g));

/** Fade in/out multiplier at timeline time t (linear amplitude ramps within the clip's own range). */
export function fadeGainAt(clip: Clip, t: number): number {
  const a = clip.audio;
  if (!a || (!a.fadeIn && !a.fadeOut)) return 1;
  const dur = clipDuration(clip);
  const local = t - clip.start;
  let g = 1;
  const fi = Math.min(a.fadeIn, dur);
  const fo = Math.min(a.fadeOut, dur);
  if (fi > 0 && local < fi) g *= Math.max(0, local / fi);
  if (fo > 0 && local > dur - fo) g *= Math.max(0, (dur - local) / fo);
  return Math.min(1, Math.max(0, g));
}

/** Transition crossfade: the outgoing clip fades out, the incoming one in. */
export function transitionAudioGain(transitions: readonly SequenceTransition[], clipId: string, t: number): number {
  let gain = 1;
  for (const tr of transitions) {
    if (t < tr.start || t >= tr.end) continue;
    const p = (t - tr.start) / (tr.end - tr.start);
    if (tr.fromId === clipId) gain *= 1 - p;
    else if (tr.toId === clipId) gain *= p;
  }
  return gain;
}

/** Envelope (0..1) of an item at timeline time t. */
export function audioEnvelopeAt(item: SequenceItem, transitions: readonly SequenceTransition[], t: number): number {
  return resolveVolume(item.clip, t) * fadeGainAt(item.clip, t) * transitionAudioGain(transitions, item.clip.id, t);
}

// ---- Noise gate (AudioWorklet) --------------------------------------------------------

const GATE_SOURCE = `
class NoiseGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() { super(); this.env = 0; this.gain = 1; }
  process(inputs, outputs, params) {
    const input = inputs[0]; const output = outputs[0];
    const amount = params.amount[0];
    if (!input || input.length === 0) return true;
    if (amount <= 0) { for (let c = 0; c < output.length; c++) output[c].set(input[c] || input[0]); return true; }
    // Threshold -60 dBFS (amount 0) .. -30 dBFS (amount 1); attenuation up to -40 dB.
    const threshold = Math.pow(10, (-60 + amount * 30) / 20);
    const floor = Math.pow(10, (-40 * amount) / 20);
    const atk = Math.exp(-1 / (0.002 * sampleRate)), rel = Math.exp(-1 / (0.08 * sampleRate));
    const gAtk = Math.exp(-1 / (0.005 * sampleRate)), gRel = Math.exp(-1 / (0.12 * sampleRate));
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) { const v = Math.abs(input[c][i]); if (v > peak) peak = v; }
      this.env = peak > this.env ? atk * this.env + (1 - atk) * peak : rel * this.env + (1 - rel) * peak;
      const target = this.env >= threshold ? 1 : floor;
      this.gain = target > this.gain ? gAtk * this.gain + (1 - gAtk) * target : gRel * this.gain + (1 - gRel) * target;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain;
    }
    return true;
  }
}
registerProcessor('rf-noise-gate', NoiseGate);
`;

const workletReady = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Loads the noise-gate worklet into a context (once). Resolves false if AudioWorklet is unavailable. */
export function ensureAudioWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = workletReady.get(ctx);
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) return false;
      const url = URL.createObjectURL(new Blob([GATE_SOURCE], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletReady.set(ctx, p);
  }
  return p;
}

export interface AudioChain {
  input: AudioNode;
  /** Clip gain (dB) stage; connect this to the envelope / track bus. */
  output: GainNode;
  setParams: (a: ClipAudio) => void;
  disconnect: () => void;
}

/**
 * Builds the per-clip processing chain. `withGate` requires ensureAudioWorklet()
 * to have resolved true for this context.
 */
export function createAudioChain(ctx: BaseAudioContext, a: ClipAudio, withGate: boolean): AudioChain {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = 0.707;
  const gate = withGate ? new AudioWorkletNode(ctx, 'rf-noise-gate', { outputChannelCount: [2] }) : null;
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 100;
  const eq = EQ_BANDS.map((f) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking';
    // Stay below Nyquist (the AI analysis renders at 16 kHz).
    b.frequency.value = Math.min(f, ctx.sampleRate * 0.45);
    b.Q.value = 1.1;
    return b;
  });
  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = Math.min(8000, ctx.sampleRate * 0.45);
  const pan = ctx.createStereoPanner();
  const out = ctx.createGain();

  const chain: AudioNode[] = [hp, ...(gate ? [gate] : []), bass, ...eq, treble, pan, out];
  for (let i = 0; i + 1 < chain.length; i++) chain[i].connect(chain[i + 1]);

  const setParams = (p: ClipAudio) => {
    // Noise reduction: a rumble high-pass (40–120 Hz) plus a downward noise gate.
    hp.frequency.value = p.noiseReduction > 0 ? 40 + p.noiseReduction * 80 : 10;
    const amount = gate?.parameters.get('amount');
    if (amount) amount.value = p.noiseReduction;
    bass.gain.value = p.bass;
    treble.gain.value = p.treble;
    eq.forEach((b, i) => (b.gain.value = p.eq[i] ?? 0));
    pan.pan.value = Math.max(-1, Math.min(1, p.pan));
    out.gain.value = dbToGain(p.gainDb);
  };
  setParams(a);
  return {
    input: hp,
    output: out,
    setParams,
    disconnect: () => chain.forEach((n) => n.disconnect()),
  };
}
