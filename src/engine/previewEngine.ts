import { usePlaybackStore } from '../store/playbackStore';
import { timeToFrame } from '../utils/format';
import type { CompositorLayer } from './compositor';
import { EMPTY_SEQUENCE, type Sequence, type SequenceItem } from './sequence';
import { quantizeToFrame } from './timelineModel';
import { composeLayers, isItemActive, sourceTarget, videoSampleTarget, type MediaContentProvider } from './composition';
import { audioEnvelopeAt, clipAudio } from './audio';
import { audioMixer } from './audioMixer';
import { matteEngine } from './ai/matte';

// ---------------------------------------------------------------------------
// PreviewEngine – the timeline playback engine.
//
//  * A master clock (requestAnimationFrame + performance.now) owns time.
//    Media elements follow the clock; they never drive it.
//  * One media element per clip, created lazily when the clip becomes active
//    or is about to (preload), drift-corrected while playing, and destroyed
//    once the playhead has moved away – so long timelines stay cheap.
//  * Gaps have no active clips, so the compositor draws only the background.
//  * The clock holds while an active video is still buffering, keeping
//    picture and timeline in sync instead of skipping ahead.
//  * Phase 3: clips are "live" over their render range, which transitions
//    extend into the neighbouring clip. Outside the media's own range a clip
//    holds its first / last frame. Reversed clips are driven by seeking.
//
// UI never touches media elements; it calls this API and reads playbackStore.
// ---------------------------------------------------------------------------

type FrameListener = () => void;

interface Player {
  el: HTMLMediaElement;
  url: string;
  failed: boolean;
  /** Soft sync in progress (playback-rate nudging). */
  correcting: boolean;
  /** Output has started since the last play() (the 'playing' event fired). */
  started: boolean;
  /** performance.now() of the pending play() call, for latency measurement. */
  playCalledAt: number;
  /** currentTime when play() was called – "started" means it has moved past this. */
  startPos: number;
  /** The element has decoded at least one frame (it can be held while it seeks). */
  hasFrame: boolean;
  /** A seek finished and its frame has not been drawn yet (seek-driven playback waits for it). */
  pendingPresent: boolean;
  /**
   * Identity of the frame the element currently SHOWS. While it seeks, currentTime
   * already reports the target but the old frame is still displayed – per-frame AI
   * masks must follow the picture, not the clock.
   */
  frameKey?: string;
  dispose: () => void;
}

/** Create elements this long before a clip starts, so it can start instantly. */
const PRELOAD_AHEAD = 1.5;
/** Keep elements this long after a clip ends (cheap scrubbing back). */
const KEEP_BEHIND = 2;
/** Hard re-seek when a playing element drifts further than this (seconds). */
const HARD_RESYNC = 0.3;
/** Start / stop soft (playback-rate) correction at these drifts (seconds). */
const SOFT_SYNC_START = 0.02;
const SOFT_SYNC_STOP = 0.005;
/** Rate correction: `gain` × drift, capped at ±8 % (inaudible with pitch preservation). */
const RATE_GAIN = 2;
const MAX_RATE_ADJUST = 0.08;
/** Above this drift, allow up to ±20 % so start-up errors clear in a fraction of a second. */
const FAST_SYNC_DRIFT = 0.06;
const MAX_FAST_RATE_ADJUST = 0.2;
/** Never wait longer than this for elements to start after Play. */
const MAX_START_GATE_MS = 300;
/** Never hold the clock longer than this for a buffering element. */
const MAX_STALL_MS = 3000;
const EPS = 1e-4;

/** Audio and video elements have very different start-up latency (measured ~70–100 ms vs ~30 ms). */
const kindOf = (el: HTMLMediaElement) => (el instanceof HTMLAudioElement ? 'audio' : 'video');

class PreviewEngine {
  private seq: Sequence = EMPTY_SEQUENCE;
  private time = 0;
  private playing = false;
  private clockOrigin = { wall: 0, time: 0 };
  private stallStartedAt = 0;
  private raf = 0;
  private players = new Map<string, Player>();
  private images = new Map<string, HTMLImageElement>();
  private listeners = new Set<FrameListener>();
  private savedTimelineTime = 0;
  /** Wall time play() was pressed while waiting for elements to start; 0 = clock running. */
  private startGateAt = 0;
  /** Learned delay between element.play() and its position advancing, per media kind (seconds). */
  private startLatency = { audio: 0.1, video: 0.05 };

  private get store() {
    return usePlaybackStore.getState();
  }

  // ---- Sequence ------------------------------------------------------------

  /** Loads a new or updated sequence. Edits keep the playhead; switching source resets it. */
  setSequence(seq: Sequence) {
    if (seq.key !== this.seq.key) {
      if (this.seq.key === 'timeline') this.savedTimelineTime = this.time;
      this.stopClock();
      this.disposeAllPlayers();
      this.time = seq.key === 'timeline' ? this.savedTimelineTime : 0;
    }
    this.seq = seq;
    if (this.time > seq.duration) this.time = seq.duration;
    if (this.playing && !this.isPlayable()) this.stopClock();
    this.syncImages();
    this.syncPlayers();
    this.publish();
    this.emitFrame();
  }

  get sequence() {
    return this.seq;
  }

  get currentTime() {
    return this.time;
  }

  // ---- Transport -------------------------------------------------------------

  play() {
    if (!this.isPlayable() || this.playing) return;
    if (this.time >= this.seq.duration - 1e-3) this.time = 0;
    this.playing = true;
    // Play is a user gesture: start / resume the audio graph (routes elements once running).
    audioMixer.resume();
    this.resetClock();
    // Hold the clock until the active elements actually output (see tick()).
    this.startGateAt = performance.now();
    // Called synchronously from the user's click so element.play() is allowed.
    this.syncPlayers();
    this.publish();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    if (!this.playing) return;
    this.stopClock();
    // Rest on a frame boundary so edits at the playhead (split, paste) are frame-exact.
    this.time = this.toFrameGrid(this.time);
    this.syncPlayers();
    this.publish();
    this.emitFrame();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number) {
    if (!this.isPlayable()) return;
    this.time = this.toFrameGrid(time);
    if (this.playing) this.resetClock();
    this.syncPlayers();
    this.publish();
    this.emitFrame();
  }

  /** Steps by whole frames (pauses first). Integer frame math avoids drift. */
  step(frames: number, fps: number) {
    if (!this.isPlayable()) return;
    this.pause();
    this.seek((timeToFrame(this.time, fps) + frames) / fps);
  }

  setVolume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    this.store._set({ volume: v, muted: v === 0 ? this.store.muted : false });
    this.syncPlayers();
  }

  setMuted(muted: boolean) {
    this.store._set({ muted });
    this.syncPlayers();
  }

  // ---- Rendering -------------------------------------------------------------

  onFrame(listener: FrameListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitFrame() {
    this.listeners.forEach((l) => l());
  }

  /** Layers to composite at the current time, bottom-most first. */
  getLayers(): CompositorLayer[] {
    const { seq } = this;
    if (seq.source?.kind === 'audio') {
      return [
        {
          kind: 'audio',
          waveform: seq.source.waveform,
          progress: seq.duration ? this.time / seq.duration : 0,
          label: seq.source.name,
        },
      ];
    }
    return composeLayers(seq, this.effectiveTime(), this.mediaContent);
  }

  /** Live media frame for an item: the image, or the clip's <video> element. */
  private mediaContent: MediaContentProvider = (it) => {
    const media = it.media!;
    if (media.kind === 'image') {
      const img = this.images.get(media.url);
      if (!img?.complete || !img.naturalWidth) return null;
      return { type: 'media', source: img, width: img.naturalWidth, height: img.naturalHeight, dynamic: false, frameKey: media.id };
    }
    const p = this.players.get(it.clip.id);
    const v = p?.el as HTMLVideoElement | undefined;
    if (!p || !v || p.failed || !v.videoWidth) return null;
    const ready = v.readyState >= 2;
    if (ready) {
      p.hasFrame = true;
      p.pendingPresent = false;
      if (!v.seeking) p.frameKey = `${media.id}@${v.currentTime.toFixed(3)}`;
    }
    // While seeking (scrubbing, reverse playback) hold the last decoded frame instead of flashing the background.
    if (!p.hasFrame) return null;
    return { type: 'media', source: v, width: v.videoWidth, height: v.videoHeight, dynamic: ready, frameKey: p.frameKey };
  };

  /** Envelope gain the mixer applies to a clip's audio right now (null when not routed). Diagnostics / tests. */
  audioGainOf(clipId: string): number | null {
    const p = this.players.get(clipId);
    return p ? audioMixer.gainOf(p.el) : null;
  }

  // ---- Internals -------------------------------------------------------------

  /**
   * Nearest frame boundary, clamped to the sequence. The very end is kept exact
   * (it is usually not frame-aligned, e.g. a 4.093 s source).
   */
  private toFrameGrid(t: number) {
    const { duration, fps } = this.seq;
    if (t >= duration) return duration;
    return Math.max(0, Math.min(duration, quantizeToFrame(t, fps)));
  }

  private isPlayable() {
    return this.seq.duration > 0 && !this.seq.still;
  }

  /** At the very end, show the last frame instead of an empty canvas. */
  private effectiveTime() {
    return this.seq.duration > 0 && this.time >= this.seq.duration ? this.seq.duration - EPS : this.time;
  }

  private isActive(it: SequenceItem, t: number) {
    return isItemActive(this.seq, it, t);
  }

  private sourceTarget(it: SequenceItem, t: number) {
    return sourceTarget(it, t);
  }

  /** Where a held (paused / frozen) video element should sit: the frame-centre sample. Audio elements keep the exact time. */
  private visualTarget(it: SequenceItem, el: HTMLMediaElement, t: number, exact: number) {
    if (!(el instanceof HTMLVideoElement)) return exact;
    return videoSampleTarget(it, t, this.seq.fps);
  }

  private resetClock() {
    this.clockOrigin = { wall: performance.now(), time: this.time };
    this.stallStartedAt = 0;
  }

  private stopClock() {
    this.playing = false;
    this.startGateAt = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = () => {
    this.raf = 0;
    if (!this.playing) return;
    const now = performance.now();
    if (this.startGateAt && (this.allActiveStarted() || now - this.startGateAt > MAX_START_GATE_MS)) {
      // Everything is producing output: start the clock from here.
      this.startGateAt = 0;
      this.clockOrigin = { wall: now, time: this.time };
    }
    if (this.startGateAt || this.isStalled(now)) {
      // Hold the clock: waiting for start-up, or for an active video to buffer.
      this.clockOrigin = { wall: now, time: this.time };
    } else {
      this.time = this.clockOrigin.time + (now - this.clockOrigin.wall) / 1000;
    }
    if (this.time >= this.seq.duration) {
      this.time = this.seq.duration;
      this.stopClock();
      this.syncPlayers();
      this.publish();
      this.emitFrame();
      return;
    }
    this.syncPlayers();
    this.publish();
    this.emitFrame();
    this.raf = requestAnimationFrame(this.tick);
  };

  private allActiveStarted() {
    const t = this.effectiveTime();
    return this.seq.items.every((it) => {
      if (!it.media || it.media.kind === 'image' || !this.isActive(it, t)) return true;
      if (this.sourceTarget(it, t).frozen) return true;
      const p = this.players.get(it.clip.id);
      return !p || p.failed || p.started;
    });
  }

  private isStalled(now: number) {
    const t = this.time;
    const waiting = this.seq.items.some((it) => {
      if (it.media?.kind !== 'video' || !it.visible || !this.isActive(it, t)) return false;
      // Frozen / reversed elements are seeked continuously; they never hold the clock.
      if (this.sourceTarget(it, t).frozen) return false;
      const p = this.players.get(it.clip.id);
      return !!p && !p.failed && p.el.readyState < 3;
    });
    if (!waiting) {
      this.stallStartedAt = 0;
      return false;
    }
    if (!this.stallStartedAt) this.stallStartedAt = now;
    return now - this.stallStartedAt < MAX_STALL_MS;
  }

  /** Brings every relevant media element in line with the clock. */
  private syncPlayers() {
    const t = this.effectiveTime();
    const { volume, muted } = this.store;
    const wanted = new Set<string>();

    for (const it of this.seq.items) {
      const media = it.media;
      if (!media || media.kind === 'image') continue;
      const active = this.isActive(it, t);
      const upcoming = !active && it.renderStart > t && it.renderStart - t <= PRELOAD_AHEAD;
      const recent = !active && t >= it.renderEnd && t - it.renderEnd <= KEEP_BEHIND;
      if (!active && !upcoming && !recent) continue;
      wanted.add(it.clip.id);

      const p = this.ensurePlayer(it.clip.id, media.url, media.kind === 'audio');
      if (p.failed) continue;
      const el = p.el;
      this.detectStart(p);
      const { target, frozen } = this.sourceTarget(it, t);
      // Silent until active (pre-rolled clips start slightly early); reversed audio is not supported.
      el.muted = muted || !it.audible || !active || !!it.clip.reversed;
      const envelope = active ? audioEnvelopeAt(it, this.seq.transitions, t) : 0;
      // Routed through the shared audio chain when the graph runs; otherwise plain element volume.
      const routed = audioMixer.update(el, it.clip.trackId, clipAudio(it.clip), envelope * volume, it.trackVolume);
      if (!routed) el.volume = Math.max(0, Math.min(1, envelope * volume));

      let rate = it.clip.speed;
      if (active && frozen) {
        // Hold a frame: a transition beyond the media's range, or reversed playback (seek-driven).
        p.correcting = false;
        this.stopElement(p);
        // While playing, let an in-flight seek finish (the next tick retargets);
        // when paused there is no next tick, so always apply the latest target.
        const tolerance = this.playing ? 0.5 / (this.seq.fps || 30) : 5e-4;
        // Seek-driven playback: show each decoded frame before requesting the next one.
        if (!it.visible) p.pendingPresent = false;
        const busy = el.seeking || p.pendingPresent;
        const held = this.visualTarget(it, el, t, target);
        if ((!this.playing || !busy) && Math.abs(el.currentTime - held) > tolerance) el.currentTime = held;
      } else if (active) {
        if (this.playing) {
          if (!el.seeking) {
            // Positive drift = element ahead of the clock (in source seconds).
            const drift = el.currentTime - target;
            if (Math.abs(drift) > HARD_RESYNC) {
              el.currentTime = target;
              p.correcting = false;
            } else {
              // Media elements start a few tens of ms after play() and run on
              // their own clock; nudge the rate so they converge smoothly instead
              // of stuttering through repeated seeks. Hysteresis avoids hunting.
              if (Math.abs(drift) > SOFT_SYNC_START) p.correcting = true;
              else if (Math.abs(drift) < SOFT_SYNC_STOP) p.correcting = false;
              if (p.correcting) {
                // Gentle (±8 %) for small drift; faster catch-up for larger drift.
                const cap = Math.abs(drift) > FAST_SYNC_DRIFT ? MAX_FAST_RATE_ADJUST : MAX_RATE_ADJUST;
                const adjust = Math.max(-cap, Math.min(cap, -drift * RATE_GAIN));
                rate = it.clip.speed * (1 + adjust);
              }
            }
          }
          this.startElement(p);
        } else {
          p.correcting = false;
          this.stopElement(p);
          // Paused: show the frame the export renders for this output frame (centre sampling).
          const still = this.visualTarget(it, el, t, target);
          if (Math.abs(el.currentTime - still) > 5e-4) el.currentTime = still;
        }
      } else {
        p.correcting = false;
        // Pre-roll: elements need ~startLatency after play() before they output,
        // so a clip starting mid-playback is started that much early (muted, not drawn).
        const entry = this.sourceTarget(it, it.renderStart);
        const preroll = this.playing && upcoming && !entry.frozen && it.renderStart - t <= this.startLatency[kindOf(el)];
        if (preroll) {
          this.startElement(p);
        } else {
          this.stopElement(p);
          if (upcoming && !el.seeking && Math.abs(el.currentTime - entry.target) > 0.05) {
            el.currentTime = entry.target;
          }
        }
      }
      if (Math.abs(el.playbackRate - rate) > 1e-6) el.playbackRate = rate;
    }

    for (const [id, p] of this.players) {
      if (!wanted.has(id)) {
        p.dispose();
        this.players.delete(id);
      }
    }
  }

  private startElement(p: Player) {
    if (!p.el.paused) return;
    p.started = false;
    p.playCalledAt = performance.now();
    p.startPos = p.el.currentTime;
    p.el.play().catch(() => undefined);
  }

  /**
   * An element has "started" only once its position actually advances. The
   * 'playing' event is not enough: audio output stays frozen for a further
   * 30–100 ms while the device spins up (measured in headless and headed Chrome).
   * The observed delay trains the pre-roll latency estimate.
   */
  private detectStart(p: Player) {
    if (p.started || !p.playCalledAt || p.el.paused) return;
    if (p.el.currentTime > p.startPos + 1e-3) {
      p.started = true;
      const measured = (performance.now() - p.playCalledAt) / 1000;
      const k = kindOf(p.el);
      this.startLatency[k] = Math.min(0.25, Math.max(0.01, this.startLatency[k] * 0.7 + measured * 0.3));
      p.playCalledAt = 0;
    }
  }

  private stopElement(p: Player) {
    p.started = false;
    p.playCalledAt = 0;
    if (!p.el.paused) p.el.pause();
  }

  private ensurePlayer(clipId: string, url: string, audioOnly: boolean): Player {
    const existing = this.players.get(clipId);
    if (existing && existing.url === url) return existing;
    existing?.dispose();

    const el = document.createElement(audioOnly ? 'audio' : 'video');
    el.preload = 'auto';
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    const player: Player = { el, url, failed: false, correcting: false, started: false, playCalledAt: 0, startPos: 0, hasFrame: false, pendingPresent: false, dispose: () => undefined };
    // Re-render when a paused element lands on its frame.
    const onFrameReady = () => !this.playing && this.emitFrame();
    const onError = () => {
      player.failed = true;
      this.emitFrame();
    };
    el.addEventListener('loadeddata', onFrameReady);
    el.addEventListener('seeked', onFrameReady);
    el.addEventListener('error', onError);
    const onSeeked = () => {
      if (el instanceof HTMLVideoElement) player.pendingPresent = true;
    };
    el.addEventListener('seeked', onSeeked);
    player.dispose = () => {
      el.removeEventListener('loadeddata', onFrameReady);
      el.removeEventListener('seeked', onFrameReady);
      el.removeEventListener('seeked', onSeeked);
      audioMixer.release(el);
      el.removeEventListener('error', onError);
      el.pause();
      el.removeAttribute('src');
      el.load(); // releases the decoder
    };
    el.src = url;
    this.players.set(clipId, player);
    return player;
  }

  private disposeAllPlayers() {
    this.players.forEach((p) => p.dispose());
    this.players.clear();
  }

  private syncImages() {
    const needed = new Set<string>();
    for (const it of this.seq.items) {
      if (it.media?.kind !== 'image') continue;
      needed.add(it.media.url);
      if (!this.images.has(it.media.url)) {
        const img = new Image();
        img.onload = () => this.emitFrame();
        img.src = it.media.url;
        this.images.set(it.media.url, img);
      }
    }
    for (const url of this.images.keys()) if (!needed.has(url)) this.images.delete(url);
  }

  private publish() {
    const isTimeline = this.seq.key === 'timeline';
    if (isTimeline) this.savedTimelineTime = this.time;
    this.store._set({
      isPlaying: this.playing,
      currentTime: this.time,
      duration: this.seq.duration,
      playable: this.isPlayable(),
      timelineTime: this.savedTimelineTime,
    });
  }
}

export const previewEngine = new PreviewEngine();

// Redraw when a background-removal model finishes loading (masks appear without pressing play).
matteEngine.subscribe(() => previewEngine.emitFrame());
