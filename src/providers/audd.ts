import { v4 } from '@se-oss/uuid';

import { AUDD_CONFIG } from '../constants.js';
import type { AuddConfig, AudioInput, RemoteRecognitionResult, Track } from '../typings.js';
import { createTrackId, normalizeIsrc, parseDateOnly } from '../utils/id.js';

interface AuddResponseJson {
  status: 'success' | 'error';
  result?: {
    artist?: string;
    title?: string;
    album?: string;
    release_date?: string;
    timecode?: string;
    song_link?: string;
    isrc?: string;
    lyrics?: {
      lyrics?: string;
      media?: Array<{
        provider?: string;
        url?: string;
      }>;
    };
    spotify?: {
      name?: string;
      external_urls?: { spotify?: string };
      duration_ms?: number;
      album?: {
        name?: string;
        release_date?: string;
        images?: Array<{ url?: string; width?: number; height?: number }>;
      };
      artists?: Array<{ name?: string }>;
      external_ids?: { isrc?: string };
    };
    apple_music?: {
      name?: string;
      artistName?: string;
      albumName?: string;
      releaseDate?: string;
      durationInMillis?: number;
      url?: string;
      isrc?: string;
      artwork?: {
        url?: string;
        width?: number;
        height?: number;
      };
    };
    deezer?: {
      title?: string;
      link?: string;
      duration?: number;
      release_date?: string;
      artist?: {
        name?: string;
        picture_medium?: string;
        picture_xl?: string;
      };
      album?: {
        title?: string;
        cover_medium?: string;
        cover_xl?: string;
      };
    };
    musicbrainz?: Array<{
      id?: string;
      title?: string;
      length?: number;
      isrcs?: string[];
      'artist-credit'?: Array<{ name?: string }>;
    }>;
    napster?: {
      id?: string;
      name?: string;
      artistName?: string;
      albumName?: string;
      playbackSeconds?: number;
    };
  } | null;
  error?: {
    error_code: number;
    error_message: string;
  };
}

function parseTimecodeMs(timecode?: string): number | null {
  if (!timecode) return null;
  const parts = timecode.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 1) return parts[0] * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
}

export class AuddRecognitionService {
  #config: AuddConfig;

  constructor(config: AuddConfig) {
    this.#config = config;
  }

  async recognize(
    input: AudioInput,
    timestamp: Date = new Date()
  ): Promise<RemoteRecognitionResult> {
    const rawData =
      input instanceof Int16Array
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : input instanceof Uint8Array || Buffer.isBuffer(input)
          ? input
          : input.data;

    const mimeType =
      input instanceof Int16Array || input instanceof Uint8Array || Buffer.isBuffer(input)
        ? 'audio/mpeg'
        : (input.mimeType ?? 'audio/mpeg');

    const formData = new FormData();
    formData.append('api_token', this.#config.apiToken);
    formData.append('return', AUDD_CONFIG.returnParam);
    formData.append('file', new Blob([rawData as BlobPart], { type: mimeType }), 'sample.mp3');

    let res: Response;
    try {
      res = await fetch(AUDD_CONFIG.restEndpoint, {
        method: 'POST',
        body: formData,
      });
    } catch (e) {
      return {
        status: 'error',
        code: 'BAD_CONNECTION',
        message: e instanceof Error ? e.message : 'Connection failed',
        cause: e,
      };
    }

    if (!res.ok) {
      return {
        status: 'error',
        code: 'HTTP_ERROR',
        httpCode: res.status,
        message: `AudD returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = (await res.json()) as AuddResponseJson;
    return this.mapResponse(data, timestamp);
  }

  async mapResponse(data: AuddResponseJson, timestamp: Date): Promise<RemoteRecognitionResult> {
    if (data.status === 'error') {
      const err = data.error;
      const code = err?.error_code ?? 0;
      const msg = err?.error_message ?? 'Unknown error';

      if (code === 300 || code === 400 || code === 500) {
        return { status: 'error', code: 'BAD_RECORDING', message: msg };
      }
      if (code === 900) {
        return { status: 'error', code: 'AUTH_ERROR', message: msg };
      }
      if (code === 901) {
        return { status: 'error', code: 'API_USAGE_LIMITED', message: msg };
      }
      return {
        status: 'error',
        code: 'UNHANDLED_ERROR',
        message: `AudD error: ${msg} (code ${code})`,
      };
    }

    const res = data.result;
    if (!res) return { status: 'no_matches' };

    const title =
      res.apple_music?.name?.trim() ||
      res.deezer?.title?.trim() ||
      res.title?.trim() ||
      res.spotify?.name?.trim() ||
      res.napster?.name?.trim() ||
      res.musicbrainz?.[0]?.title?.trim();

    const artist =
      res.apple_music?.artistName?.trim() ||
      res.deezer?.artist?.name?.trim() ||
      res.artist?.trim() ||
      res.spotify?.artists?.[0]?.name?.trim() ||
      res.napster?.artistName?.trim() ||
      res.musicbrainz?.[0]?.['artist-credit']?.[0]?.name?.trim();

    if (!title || !artist) {
      return { status: 'no_matches' };
    }

    const trackId = res.song_link ? await createTrackId('audd', res.song_link) : v4();

    const album =
      res.apple_music?.albumName?.trim() ||
      res.deezer?.album?.title?.trim() ||
      res.album?.trim() ||
      res.spotify?.album?.name?.trim() ||
      res.napster?.albumName?.trim() ||
      null;

    const releaseDate =
      parseDateOnly(res.apple_music?.releaseDate) ||
      parseDateOnly(res.deezer?.release_date) ||
      parseDateOnly(res.release_date) ||
      parseDateOnly(res.spotify?.album?.release_date);

    const durationMs =
      res.apple_music?.durationInMillis ||
      res.spotify?.duration_ms ||
      (res.deezer?.duration ? res.deezer.duration * 1000 : null) ||
      (res.napster?.playbackSeconds ? res.napster.playbackSeconds * 1000 : null) ||
      res.musicbrainz?.[0]?.length ||
      null;

    const recognizedAtMs = parseTimecodeMs(res.timecode);

    const trackLinks: Track['trackLinks'] = {};
    if (res.spotify?.external_urls?.spotify) {
      trackLinks.spotify = res.spotify.external_urls.spotify;
    }
    if (res.apple_music?.url) {
      trackLinks.appleMusic = res.apple_music.url;
    }
    if (res.deezer?.link) {
      trackLinks.deezer = res.deezer.link;
    }
    if (res.napster?.id) {
      trackLinks.napster = `https://web.napster.com/track/${res.napster.id}`;
    }
    if (res.musicbrainz?.[0]?.id) {
      trackLinks.musicBrainz = `https://musicbrainz.org/recording/${res.musicbrainz[0].id}`;
    }

    const mediaList = res.lyrics?.media ?? [];
    const ytMedia = mediaList.find((m) => m.provider === 'youtube');
    if (ytMedia?.url) trackLinks.youtube = ytMedia.url;
    const scMedia = mediaList.find((m) => m.provider === 'soundcloud');
    if (scMedia?.url) trackLinks.soundcloud = scMedia.url;

    const isrc =
      normalizeIsrc(res.isrc) ||
      normalizeIsrc(res.apple_music?.isrc) ||
      normalizeIsrc(res.spotify?.external_ids?.isrc) ||
      normalizeIsrc(res.musicbrainz?.[0]?.isrcs?.[0]);

    // Artwork resolution
    let artworkUrl: string | null = null;
    let artworkThumbUrl: string | null = null;

    if (res.deezer?.album?.cover_xl && res.deezer?.album?.cover_medium) {
      artworkUrl = res.deezer.album.cover_xl;
      artworkThumbUrl = res.deezer.album.cover_medium;
    } else if (res.apple_music?.artwork?.url) {
      const art = res.apple_music.artwork;
      artworkUrl = art.url ? art.url.replace('{w}x{h}', '1500x1500') : null;
      artworkThumbUrl = art.url ? art.url.replace('{w}x{h}', '300x300') : null;
    } else if (res.spotify?.album?.images?.length) {
      const images = res.spotify.album.images;
      artworkUrl = images[0]?.url ?? null;
      artworkThumbUrl = images[images.length - 1]?.url ?? null;
    }

    const lyricsText = res.lyrics?.lyrics?.trim();

    const track: Track = {
      id: trackId,
      title,
      artist,
      album,
      releaseDate,
      durationMs,
      recognizedAtMs,
      recognizedBy: 'audd',
      recognitionDate: timestamp,
      lyrics: lyricsText ? { type: 'plain', text: lyricsText } : null,
      isrc,
      artworkThumbUrl,
      artworkUrl,
      trackLinks,
      properties: {
        isFavorite: false,
        isViewed: false,
        themeSeedColor: null,
      },
    };

    return { status: 'success', track };
  }
}
