/**
 * Frame index containing `seconds`. Media elements round currentTime to
 * microseconds (e.g. 1/30s reads back as 0.033333), so a small tolerance keeps
 * exact frame boundaries on the right frame.
 */
export function timeToFrame(seconds: number, fps: number): number {
  return Math.floor(seconds * fps + 1e-3);
}

/** Formats seconds as HH:MM:SS:FF (frames) or MM:SS.cs when fps is not given. */
export function formatTimecode(seconds: number, fps?: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (fps) {
    const total = timeToFrame(seconds, fps);
    const f = total % fps;
    const totalSec = Math.floor(total / fps);
    return `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}:${pad(f)}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}` : `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Short duration label, e.g. 0:07 or 1:02:03. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Ruler label: 0s, 5s, 1:00, 1:30 ... */
export function formatRulerLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Math.round((Date.now() - timestamp) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
