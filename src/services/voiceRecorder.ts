import { create } from 'zustand';
import { useProjectStore } from '../store/projectStore';
import { useMediaStore } from '../store/mediaStore';
import { useUiStore } from '../store/uiStore';
import { usePlaybackStore } from '../store/playbackStore';
import { previewEngine } from '../engine/previewEngine';
import { clipsOnTrack, isRangeFree, quantizeToFrame } from '../engine/timelineModel';
import { track as trackEvent } from './analytics';
import { selectClips } from './editingService';

// ---------------------------------------------------------------------------
// Voice-over recording: microphone → MediaRecorder (Opus/WebM) → imported as a
// normal audio file (persisted, waveform) → placed on an audio track at the
// playhead where recording started. Permission is requested only when the
// user presses Record.
// ---------------------------------------------------------------------------

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'saving';

interface RecorderState {
  status: RecorderStatus;
  /** 0..1 input level (for the meter). */
  level: number;
  startedAt: number;
  error: string | null;
  /** Play the timeline while recording (to speak along with the picture). */
  playAlong: boolean;
}

export const useRecorderStore = create<RecorderState>()(() => ({ status: 'idle', level: 0, startedAt: 0, error: null, playAlong: true }));

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let meterCtx: AudioContext | null = null;
let meterRaf = 0;
let startTime = 0;
let take = 0;

function permissionMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return 'Microphone permission was denied. Allow microphone access for this site in the browser address bar, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone and try again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is in use by another application or could not be started.';
  if (name === 'SecurityError') return 'Microphone access requires a secure (https or localhost) page.';
  return `Could not start recording: ${err instanceof Error ? err.message : String(err)}`;
}

function cleanup() {
  cancelAnimationFrame(meterRaf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void meterCtx?.close();
  meterCtx = null;
  recorder = null;
}

export async function startRecording() {
  const st = useRecorderStore.getState();
  if (st.status !== 'idle') return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    useRecorderStore.setState({ error: 'This browser does not support microphone recording.' });
    return;
  }
  useRecorderStore.setState({ status: 'requesting', error: null });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    cleanup();
    useRecorderStore.setState({ status: 'idle', error: permissionMessage(err) });
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined);
  } catch (err) {
    cleanup();
    useRecorderStore.setState({ status: 'idle', error: permissionMessage(err) });
    return;
  }
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // Level meter.
  try {
    meterCtx = new AudioContext();
    const an = meterCtx.createAnalyser();
    an.fftSize = 1024;
    meterCtx.createMediaStreamSource(stream).connect(an);
    const data = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      useRecorderStore.setState({ level: Math.min(1, peak) });
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    /* meter is optional */
  }
  useUiStore.getState().showTimeline();
  startTime = quantizeToFrame(usePlaybackStore.getState().timelineTime, useProjectStore.getState().document.canvas.frameRate);
  recorder.start(250);
  useRecorderStore.setState({ status: 'recording', startedAt: performance.now() });
  if (useRecorderStore.getState().playAlong) previewEngine.play();
}

/** Stops, imports the take and places it on the timeline. Returns the new clip id. */
export async function stopRecording(): Promise<string | null> {
  if (useRecorderStore.getState().status !== 'recording' || !recorder) return null;
  previewEngine.pause();
  useRecorderStore.setState({ status: 'saving', level: 0 });
  const rec = recorder;
  const type = rec.mimeType || 'audio/webm';
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
    rec.stop();
  });
  cleanup();
  const blob = new Blob(chunks, { type });
  chunks = [];
  if (blob.size === 0) {
    useRecorderStore.setState({ status: 'idle', error: 'Nothing was recorded.' });
    return null;
  }
  take++;
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  const fileName = `Voice-over ${take} ${stamp}.${ext}`;
  const media = useMediaStore.getState();
  await media.importFiles([new File([blob], fileName, { type: type.split(';')[0] })]);
  const item = useMediaStore.getState().items.find((m) => m.name === fileName);
  if (!item || item.status !== 'ready') {
    useRecorderStore.setState({ status: 'idle', error: 'The recording could not be imported.' });
    return null;
  }
  let id: string | null = null;
  const project = useProjectStore.getState();
  project.transaction(() => {
    const doc = useProjectStore.getState().document;
    const len = item.duration ?? 1;
    const track = doc.tracks.find((t) => t.type === 'audio' && !t.locked && isRangeFree(clipsOnTrack(doc, t.id), startTime, len));
    const trackId = track?.id ?? useProjectStore.getState().addTrack('audio');
    id = useProjectStore.getState().addClip(item, trackId, startTime);
  });
  useRecorderStore.setState({ status: 'idle' });
  if (id) {
    selectClips([id]);
    useUiStore.getState().notify(`Recorded ${(item.duration ?? 0).toFixed(1)} s voice-over at ${startTime.toFixed(2)} s.`, 'success');
    trackEvent('voice_over', { seconds: Math.round(item.duration ?? 0) });
  }
  return id;
}

export function cancelRecording() {
  if (!recorder) return;
  recorder.ondataavailable = null;
  try {
    recorder.stop();
  } catch {
    /* already stopped */
  }
  chunks = [];
  cleanup();
  previewEngine.pause();
  useRecorderStore.setState({ status: 'idle', level: 0 });
}
