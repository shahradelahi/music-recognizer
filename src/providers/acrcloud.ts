import { createHmac } from 'node:crypto';

import { fetchDeezerArtwork } from '../metadata/deezer.js';
import type { AcrCloudConfig, AudioInput, RemoteRecognitionResult, Track } from '../typings.js';
import { createTrackId, normalizeIsrc, parseDateOnly } from '../utils/id.js';

interface AcrCloudResponseJson {
  status: {
    code: number;
    msg: string;
    version?: string;
  };
  metadata?: {
    music?: Array<{
      acrid: string;
      title?: string;
      artists?: Array<{ name?: string }>;
      album?: { name?: string };
      release_date?: string;
      duration_ms?: number;
      score?: number;
      db_begin_time_offset_ms: number;
      sample_begin_time_offset_ms: number;
      external_ids?: {
        isrc?: string;
        upc?: string;
      };
      external_metadata?: {
        deezer?: {
          track?: { id?: string; name?: string };
        };
        spotify?: {
          track?: { id?: string; name?: string };
        };
        youtube?: {
          vid?: string;
        };
      };
    }>;
  };
}

export class AcrCloudRecognitionService {
  #config: AcrCloudConfig;

  constructor(config: AcrCloudConfig) {
    this.#config = config;
  }

  createSignature(timestamp: string): string {
    const stringToSign = [
      'POST',
      '/v1/identify',
      this.#config.accessKey,
      'audio',
      '1',
      timestamp,
    ].join('\n');

    return createHmac('sha1', this.#config.accessSecret).update(stringToSign).digest('base64');
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

    const timestampSec = Math.floor(timestamp.getTime() / 1000).toString();
    const signature = this.createSignature(timestampSec);

    const formData = new FormData();
    formData.append('sample', new Blob([rawData as BlobPart], { type: mimeType }), 'sample');
    formData.append('sample_bytes', rawData.length.toString());
    formData.append('access_key', this.#config.accessKey);
    formData.append('data_type', 'audio');
    formData.append('signature_version', '1');
    formData.append('signature', signature);
    formData.append('timestamp', timestampSec);

    let res: Response;
    try {
      res = await fetch(`https://${this.#config.host}/v1/identify`, {
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
        message: `ACRCloud returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = (await res.json()) as AcrCloudResponseJson;
    return this.mapResponse(data, timestamp);
  }

  async mapResponse(data: AcrCloudResponseJson, timestamp: Date): Promise<RemoteRecognitionResult> {
    const code = data.status.code;
    if (code === 1001) return { status: 'no_matches' };
    if (code === 2000 || code === 2004) {
      return {
        status: 'error',
        code: 'BAD_RECORDING',
        message: data.status.msg,
      };
    }
    if (code === 3001 || code === 3014) {
      return { status: 'error', code: 'AUTH_ERROR', message: data.status.msg };
    }
    if (code === 3003 || code === 3015) {
      return {
        status: 'error',
        code: 'API_USAGE_LIMITED',
        message: data.status.msg,
      };
    }
    if (code !== 0) {
      return {
        status: 'error',
        code: 'UNHANDLED_ERROR',
        message: `ACRCloud error response: ${data.status.msg} (code ${code})`,
      };
    }

    const musicList = data.metadata?.music;
    if (!musicList || musicList.length === 0) {
      return { status: 'no_matches' };
    }

    // Pick track with highest score, then highest sample_begin_time_offset_ms
    const sorted = [...musicList].sort((a, b) => {
      const scoreDiff = (b.score ?? 70) - (a.score ?? 70);
      if (scoreDiff !== 0) return scoreDiff;
      return b.sample_begin_time_offset_ms - a.sample_begin_time_offset_ms;
    });

    const bestMatch = sorted[0];
    const title = bestMatch.title?.trim();
    const artist = bestMatch.artists
      ?.map((a) => a.name?.trim())
      .filter((n): n is string => Boolean(n))
      .join(' & ');

    if (!title || !artist) {
      return { status: 'no_matches' };
    }

    const trackId = await createTrackId('acrcloud', bestMatch.acrid);
    const trackLinks: Track['trackLinks'] = {};

    const deezerTrackId = bestMatch.external_metadata?.deezer?.track?.id;
    if (deezerTrackId) {
      trackLinks.deezer = `https://www.deezer.com/track/${deezerTrackId}`;
    }

    const spotifyTrackId = bestMatch.external_metadata?.spotify?.track?.id;
    if (spotifyTrackId) {
      trackLinks.spotify = `https://open.spotify.com/track/${spotifyTrackId}`;
    }

    const youtubeVid = bestMatch.external_metadata?.youtube?.vid;
    if (youtubeVid) {
      trackLinks.youtube = `https://www.youtube.com/watch?v=${youtubeVid}`;
    }

    let artworkUrl: string | null = null;
    let artworkThumbUrl: string | null = null;

    if (trackLinks.deezer) {
      const deezerArt = await fetchDeezerArtwork(trackLinks.deezer);
      if (deezerArt) {
        artworkUrl = deezerArt.url;
        artworkThumbUrl = deezerArt.thumbUrl;
      }
    }

    const track: Track = {
      id: trackId,
      title,
      artist,
      album: bestMatch.album?.name?.trim() ?? null,
      releaseDate: parseDateOnly(bestMatch.release_date),
      durationMs: bestMatch.duration_ms ?? null,
      recognizedAtMs: bestMatch.db_begin_time_offset_ms,
      recognizedBy: 'acrcloud',
      recognitionDate: timestamp,
      lyrics: null,
      isrc: normalizeIsrc(bestMatch.external_ids?.isrc),
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
