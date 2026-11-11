import type { MediaKind } from '../types';

export const MAX_FILE_SIZE = 4 * 1024 ** 3; // 4 GB

const EXTENSIONS: Record<MediaKind, string[]> = {
  video: ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
};

/** Value for <input accept>. */
export const ACCEPT_ATTRIBUTE = [
  'video/*',
  'image/*',
  'audio/*',
  ...Object.values(EXTENSIONS)
    .flat()
    .map((e) => `.${e}`),
].join(',');

export function getExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function detectMediaKind(file: File): MediaKind | null {
  const type = file.type.toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  const ext = getExtension(file.name);
  for (const kind of Object.keys(EXTENSIONS) as MediaKind[]) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }
  return null;
}

export type ValidationResult = { ok: true; kind: MediaKind } | { ok: false; reason: string };

export function validateMediaFile(file: File): ValidationResult {
  const kind = detectMediaKind(file);
  if (!kind) {
    return { ok: false, reason: `"${file.name}" is not a supported video, image or audio file.` };
  }
  if (file.size === 0) {
    return { ok: false, reason: `"${file.name}" is empty.` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, reason: `"${file.name}" exceeds the 4 GB import limit.` };
  }
  return { ok: true, kind };
}
