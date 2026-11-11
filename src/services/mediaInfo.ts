import { useEffect, useState } from 'react';
import type { MediaItem } from '../types';

// ---------------------------------------------------------------------------
// Technical facts about a media file that the library does not store: frame
// rate, codecs, audio channels / sample rate, whether a video has sound.
// Read from the file's own container (Mediabunny, loaded on demand) once per
// media item and cached for the session.
// ---------------------------------------------------------------------------

export interface MediaInfo {
  frameRate?: number;
  videoCodec?: string;
  hasAudio: boolean;
  audioCodec?: string;
  channels?: number;
  sampleRate?: number;
}

const cache = new Map<string, Promise<MediaInfo | null>>();

export function getMediaInfo(media: MediaItem): Promise<MediaInfo | null> {
  let p = cache.get(media.id);
  if (!p) {
    p = (async (): Promise<MediaInfo | null> => {
      if (media.kind === 'image') return { hasAudio: false };
      const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
      const blob = await (await fetch(media.url)).blob();
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try {
        const info: MediaInfo = { hasAudio: false };
        const v = media.kind === 'video' ? await input.getPrimaryVideoTrack().catch(() => null) : null;
        if (v) {
          info.videoCodec = v.codec ?? undefined;
          // Whole-file average (recordings are often variable-rate and start slower).
          const stats = await v.computePacketStats().catch(() => null);
          if (stats?.averagePacketRate) info.frameRate = Math.round(stats.averagePacketRate * 100) / 100;
        }
        const a = await input.getPrimaryAudioTrack().catch(() => null);
        if (a) {
          info.hasAudio = true;
          info.audioCodec = a.codec ?? undefined;
          info.channels = a.numberOfChannels;
          info.sampleRate = a.sampleRate;
        }
        return info;
      } finally {
        input.dispose?.();
      }
    })().catch(() => null);
    cache.set(media.id, p);
  }
  return p;
}

/** React hook: the media's info, `undefined` while reading, `null` if unreadable. */
export function useMediaInfo(media: MediaItem | undefined): MediaInfo | null | undefined {
  const [info, setInfo] = useState<MediaInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!media || media.status !== 'ready') {
      setInfo(null);
      return;
    }
    let live = true;
    setInfo(undefined);
    void getMediaInfo(media).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [media]);
  return info;
}
