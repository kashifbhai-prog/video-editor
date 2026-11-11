import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Cpu, Loader2, X } from 'lucide-react';
import { cancelAiJob, dismissAiJob, useAiJobs, type AiJob, type AiJobKind } from '../../services/ai/aiJobs';
import { cn } from '../../utils/cn';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

function JobRow({ job }: { job: AiJob }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job.status !== 'running') return;
    const iv = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(iv);
  }, [job.status]);
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const eta = job.status === 'running' && job.progress > 0.05 ? (elapsed / job.progress) * (1 - job.progress) : null;
  return (
    <div className="space-y-1 rounded-md border border-line bg-panel-2 p-2" data-testid={`ai-job-${job.kind}`} data-status={job.status}>
      <div className="flex items-center gap-1.5 text-[11px]">
        {job.status === 'running' && <Loader2 size={12} className="shrink-0 animate-spin text-accent" />}
        {job.status === 'done' && <CheckCircle2 size={12} className="shrink-0 text-success" />}
        {(job.status === 'error' || job.status === 'cancelled') && <CircleAlert size={12} className={cn('shrink-0', job.status === 'error' ? 'text-danger' : 'text-fg-subtle')} />}
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{job.label}</span>
        <span className="font-mono text-[10px] text-fg-subtle">{fmt(elapsed)}</span>
        {job.status === 'running' ? (
          <button type="button" onClick={() => cancelAiJob(job.id)} className="rounded px-1.5 text-[10px] text-fg-muted hover:bg-hover hover:text-fg">
            Cancel
          </button>
        ) : (
          <button type="button" aria-label="Dismiss" onClick={() => dismissAiJob(job.id)} className="rounded p-0.5 text-fg-subtle hover:text-fg">
            <X size={11} />
          </button>
        )}
      </div>
      {job.status === 'running' && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-panel-3" role="progressbar" aria-label={`${job.label} progress`} aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${job.progress * 100}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-[10px] text-fg-subtle">
            <span className="truncate">
              {job.stage}
              {job.detail ? ` · ${job.detail}` : ''}
            </span>
            <span className="shrink-0 font-mono">
              {Math.round(job.progress * 100)}%{eta !== null ? ` · ~${fmt(eta)} left` : ''}
            </span>
          </div>
        </>
      )}
      {job.status === 'error' && (
        <p role="alert" className="text-[10px] leading-relaxed text-danger">
          {job.error}
        </p>
      )}
    </div>
  );
}

/** Progress / result rows of AI jobs (optionally only some kinds). */
export function AiJobList({ kinds }: { kinds?: AiJobKind[] }) {
  const jobs = useAiJobs((s) => s.jobs);
  const shown = kinds ? jobs.filter((j) => kinds.includes(j.kind)) : jobs;
  if (!shown.length) return null;
  return (
    <div className="space-y-1.5">
      {shown.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  );
}

export const useJobRunning = (kind: AiJobKind) => useAiJobs((s) => s.jobs.some((j) => j.kind === kind && j.status === 'running'));

/** "Runs on this device" note – no external service, no API key. */
export function LocalBadge({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-panel-2 px-2 py-1.5 text-[10px] leading-relaxed text-fg-subtle">
      <Cpu size={11} className="mt-px shrink-0 text-success" />
      <span>{children ?? 'Runs on this device. No account, API key or upload needed.'}</span>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-fg-muted">{label}</span>
      <div className="min-w-0 max-w-[170px] flex-1">{children}</div>
    </label>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex items-start gap-1.5 text-[11px] text-fg-muted', disabled && 'opacity-50')}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};
