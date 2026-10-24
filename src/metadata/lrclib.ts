import type { Lyrics, SyncedLyricsLine, Track } from '../typings.js';

interface LrcLibResponse {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

/**
 * Parses timestamp string [mm:ss.xx] or [mm:ss.xxx] into milliseconds.
 */
function parseLrcTimestampMs(timestamp: string): number | null {
  const match = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]$/.exec(timestamp);
  if (!match) return null;

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  const rawFraction = match[3] ?? '0';
  const millis =
    rawFraction.length === 2
      ? Number.parseInt(rawFraction, 10) * 10
      : Number.parseInt(rawFraction.padEnd(3, '0').slice(0, 3), 10);

  return (minutes * 60 + seconds) * 1000 + millis;
}

/**
 * Parses standard LRC formatted synced lyrics string.
 */
export function parseLrcLyrics(lrcText: string): SyncedLyricsLine[] {
  const lines = lrcText.split('\n');
  const result: SyncedLyricsLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const timeMatch = /^(\[\d{2}:\d{2}(?:\.\d{2,3})?\])(.*)$/.exec(trimmed);
    if (!timeMatch) continue;

    const timestampMs = parseLrcTimestampMs(timeMatch[1]);
    if (timestampMs !== null) {
      result.push({
        timestampMs,
        content: timeMatch[2].trim(),
      });
    }
  }

  return result.sort((a, b) => a.timestampMs - b.timestampMs);
}

export class LrcLibFetcher {
  #endpoint = 'https://lrclib.net/api/get';

  /**
   * Fetches plain or synced lyrics from LRCLIB.
   */
  async fetch(track: Pick<Track, 'title' | 'artist' | 'durationMs'>): Promise<Lyrics | null> {
    const url = new URL(this.#endpoint);
    url.searchParams.set('track_name', track.title);
    url.searchParams.set('artist_name', track.artist);
    if (track.durationMs) {
      url.searchParams.set('duration', Math.round(track.durationMs / 1000).toString());
    }

    try {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'music-recognizer (https://github.com/shahradelahi/music-recognizer)',
        },
      });

      if (!res.ok) return null;
      const json = (await res.json()) as LrcLibResponse;

      if (json.syncedLyrics?.trim()) {
        const lines = parseLrcLyrics(json.syncedLyrics);
        if (lines.length > 0) {
          return {
            type: 'synced',
            text: json.syncedLyrics.trim(),
            lines,
          };
        }
      }

      if (json.plainLyrics?.trim()) {
        return {
          type: 'plain',
          text: json.plainLyrics.trim(),
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
