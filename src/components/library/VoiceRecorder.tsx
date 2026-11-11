import { useEffect, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import { cancelRecording, startRecording, stopRecording, useRecorderStore } from '../../services/voiceRecorder';
import { cn } from '../../utils/cn';

/** Voice-over recorder shown at the top of the Audio panel. */
export function VoiceRecorder() {
  const status = useRecorderStore((s) => s.status);
  const level = useRecorderStore((s) => s.level);
  const startedAt = useRecorderStore((s) => s.startedAt);
  const error = useRecorderStore((s) => s.error);
  const playAlong = useRecorderStore((s) => s.playAlong);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (status !== 'recording') return;
    const iv = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(iv);
  }, [status]);
  const secs = status === 'recording' ? (now - startedAt) / 1000 : 0;

  return (
    <div className="space-y-2 border-b border-line p-3" data-testid="voice-recorder">
      <div className="flex items-center gap-2">
        {status === 'recording' ? (
          <>
            <button
              type="button"
              onClick={() => void stopRecording()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-danger px-2.5 text-[11px] font-semibold text-white"
            >
              <Square size={11} className="fill-white" /> Stop
            </button>
            <button type="button" aria-label="Discard recording" onClick={cancelRecording} className="rounded p-1 text-fg-muted hover:text-fg">
              <X size={14} />
            </button>
            <span className="font-mono text-[11px] text-danger">● {Math.floor(secs / 60)}:{String(Math.floor(secs % 60)).padStart(2, '0')}</span>
          </>
        ) : (
          <button
            type="button"
            disabled={status !== 'idle'}
            onClick={() => void startRecording()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[11px] text-fg hover:bg-hover disabled:opacity-60"
          >
            {status === 'idle' ? <Mic size={13} /> : <Loader2 size={13} className="animate-spin" />}
            {status === 'requesting' ? 'Waiting for microphone…' : status === 'saving' ? 'Saving…' : 'Record voice-over'}
          </button>
        )}
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-3" aria-label="Input level" role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full transition-[width] duration-75', level > 0.9 ? 'bg-danger' : 'bg-success')} style={{ width: `${level * 100}%` }} />
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
        <input type="checkbox" checked={playAlong} disabled={status !== 'idle'} onChange={(e) => useRecorderStore.setState({ playAlong: e.target.checked })} />
        Play the timeline while recording (use headphones)
      </label>
      {error && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}
      <p className="text-[10px] text-fg-subtle">The take is placed on an audio track at the playhead where recording started.</p>
    </div>
  );
}
