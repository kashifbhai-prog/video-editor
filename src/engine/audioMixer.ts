import type { ClipAudio } from '../types';
import { createAudioChain, ensureAudioWorklet, type AudioChain } from './audio';

// ---------------------------------------------------------------------------
// Preview mixer: routes each playing media element through the shared audio
// chain (engine/audio.ts) → envelope gain → track bus → speakers.
//
// Measured browser behaviour this design depends on:
//  * A media element routed into a SUSPENDED AudioContext stops advancing, so
//    elements are only routed once the context is running (it is resumed from
//    the user's Play gesture). Before that they play directly (el.volume).
//  * el.volume is not applied linearly inside the graph, so once routed the
//    element runs at volume 1 and the envelope is a GainNode – the same
//    mechanism the export uses.
// ---------------------------------------------------------------------------

interface Routed {
  source: MediaElementAudioSourceNode;
  chain: AudioChain;
  envelope: GainNode;
  trackId: string;
  gate: boolean;
  target: number;
  /** Last applied chain parameters (the clip object is immutable, so identity = unchanged). */
  params: ClipAudio | null;
}

class AudioMixer {
  private ctx: AudioContext | null = null;
  private gateOk = false;
  private buses = new Map<string, GainNode>();
  private busVolume = new Map<string, number>();
  private routed = new Map<HTMLMediaElement, Routed>();

  /** True once elements can be routed (context running). */
  get active() {
    return this.ctx?.state === 'running';
  }

  get context() {
    return this.ctx;
  }

  /** Creates / resumes the context. Call from a user gesture (Play). */
  resume() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx({ latencyHint: 'interactive' });
        void ensureAudioWorklet(this.ctx).then((ok) => (this.gateOk = ok));
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private bus(trackId: string) {
    let g = this.buses.get(trackId);
    if (!g) {
      g = this.ctx!.createGain();
      g.connect(this.ctx!.destination);
      this.buses.set(trackId, g);
    }
    return g;
  }

  /**
   * Routes (once) and updates an element. Returns false when the element is
   * not routed (context not running) – the caller then uses el.volume.
   */
  update(el: HTMLMediaElement, trackId: string, audio: ClipAudio, envelope: number, trackVolume: number): boolean {
    if (!this.active) return this.routed.has(el);
    const ctx = this.ctx!;
    let r = this.routed.get(el);
    try {
      if (!r) {
        const source = ctx.createMediaElementSource(el);
        const chain = createAudioChain(ctx, audio, this.gateOk);
        const env = ctx.createGain();
        source.connect(chain.input);
        chain.output.connect(env);
        env.connect(this.bus(trackId));
        r = { source, chain, envelope: env, trackId, gate: this.gateOk, target: -1, params: audio };
        this.routed.set(el, r);
      } else if (r.gate !== this.gateOk) {
        // The worklet finished loading after this chain was built: rebuild with the gate.
        r.chain.disconnect();
        r.source.disconnect();
        r.chain = createAudioChain(ctx, audio, this.gateOk);
        r.source.connect(r.chain.input);
        r.chain.output.connect(r.envelope);
        r.gate = this.gateOk;
        r.params = audio;
      }
    } catch {
      return false;
    }
    if (r.trackId !== trackId) {
      r.envelope.disconnect();
      r.envelope.connect(this.bus(trackId));
      r.trackId = trackId;
    }
    // Only touch the graph when something changed: every set*AtTime call adds an
    // automation event, and doing that per frame for every element costs frame rate.
    if (r.params !== audio && JSON.stringify(r.params) !== JSON.stringify(audio)) {
      r.chain.setParams(audio);
      r.params = audio;
    }
    if (Math.abs(r.target - envelope) > 1e-4) {
      // Short smoothing avoids zipper noise on envelope changes.
      r.envelope.gain.cancelScheduledValues(ctx.currentTime);
      r.envelope.gain.setTargetAtTime(envelope, ctx.currentTime, 0.008);
      r.target = envelope;
    }
    if (this.busVolume.get(trackId) !== trackVolume) {
      const bus = this.bus(trackId).gain;
      bus.cancelScheduledValues(ctx.currentTime);
      bus.setTargetAtTime(trackVolume, ctx.currentTime, 0.01);
      this.busVolume.set(trackId, trackVolume);
    }
    if (el.volume !== 1) el.volume = 1;
    return true;
  }

  /** Current envelope gain of an element (diagnostics / tests). */
  gainOf(el: HTMLMediaElement): number | null {
    const r = this.routed.get(el);
    return r ? r.target : null;
  }

  release(el: HTMLMediaElement) {
    const r = this.routed.get(el);
    if (!r) return;
    r.source.disconnect();
    r.chain.disconnect();
    r.envelope.disconnect();
    this.routed.delete(el);
  }
}

export const audioMixer = new AudioMixer();
