import { v4 } from '@se-oss/uuid';

import { SHAZAM_CONFIG } from '../../constants.js';
import type { RemoteRecognitionResult, Track } from '../../typings.js';
import { createTrackId, normalizeIsrc } from '../../utils/id.js';
import { SignatureGenerator } from './algorithm.js';
import { encodeSignatureToUri } from './signature.js';

interface ShazamResponseJson {
  matches?: Array<{
    id?: string;
    offset?: number;
    timeskew?: number;
    frequencyskew?: number;
  }>;
  track?: {
    key?: string;
    title?: string;
    subtitle?: string;
    isrc?: string;
    images?: {
      coverart?: string;
      coverarthq?: string;
      background?: string;
    };
    hub?: {
      options?: Array<{
        type?: string;
        providername?: string;
        actions?: Array<{
          name?: string;
          uri?: string;
        }>;
      }>;
    };
    sections?: Array<{
      type?: string;
      metadata?: Array<{
        title?: string;
        text?: string;
      }>;
      text?: string[];
    }>;
  };
}

function convertImageUrl(url: string | undefined, size: string): string | null {
  if (!url) return null;
  const pattern = /\d+x\d+cc/;
  if (pattern.test(url)) {
    return url.replace(pattern, size);
  }
  return url;
}

export class ShazamRecognitionService {
  async recognizeFromPcm(
    pcm16Mono16kHz: Int16Array,
    timestamp: Date = new Date()
  ): Promise<RemoteRecognitionResult> {
    const maxSamples = SHAZAM_CONFIG.maxSampleDurationSec * SHAZAM_CONFIG.sampleRate; // 12s = 192000 samples
    let pcm = pcm16Mono16kHz;

    if (pcm.length > maxSamples) {
      // Replicate SongRec logic: take centered 12 seconds
      const startSample = Math.floor((pcm.length - maxSamples) / 2);
      pcm = pcm.subarray(startSample, startSample + maxSamples);
    }

    const durationSec = pcm.length / SHAZAM_CONFIG.sampleRate;
    const durationMs = Math.round(durationSec * 1000);

    const signature = SignatureGenerator.makeSignatureFromBuffer(pcm);
    const signatureUri = encodeSignatureToUri(signature);

    const nowEpoch = Math.floor(Date.now() / 1000);
    const userAgent =
      SHAZAM_CONFIG.userAgents[Math.floor(Math.random() * SHAZAM_CONFIG.userAgents.length)];
    const timezone =
      SHAZAM_CONFIG.timezones[Math.floor(Math.random() * SHAZAM_CONFIG.timezones.length)];

    const body = {
      geolocation: {
        altitude: Math.random() * 400 + 100,
        latitude: Math.random() * 180 - 90,
        longitude: Math.random() * 360 - 180,
      },
      signature: {
        samplems: durationMs,
        timestamp: nowEpoch,
        uri: signatureUri,
      },
      timestamp: nowEpoch,
      timezone,
    };

    const uuid1 = v4().toUpperCase();
    const uuid2 = v4();
    const url = new URL(`${SHAZAM_CONFIG.endpoint}/${uuid1}/${uuid2}`);
    url.searchParams.set('sync', 'true');
    url.searchParams.set('webv3', 'true');
    url.searchParams.set('sampling', 'true');
    url.searchParams.set('connected', '');
    url.searchParams.set('shazamapiversion', 'v3');
    url.searchParams.set('sharehub', 'true');
    url.searchParams.set('video', 'v3');

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'Content-Language': 'en_US',
        },
        body: JSON.stringify(body),
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
        code: res.status === 429 ? 'API_USAGE_LIMITED' : 'HTTP_ERROR',
        httpCode: res.status,
        message: `Shazam API returned status ${res.status}`,
      };
    }

    const data = (await res.json()) as ShazamResponseJson;
    return this.mapResponse(data, timestamp);
  }

  async mapResponse(data: ShazamResponseJson, timestamp: Date): Promise<RemoteRecognitionResult> {
    const rawTrack = data.track;
    if (!rawTrack || !rawTrack.title?.trim() || !rawTrack.subtitle?.trim()) {
      return { status: 'no_matches' };
    }

    const trackKey = rawTrack.key ?? `${rawTrack.title}_${rawTrack.subtitle}`;
    const trackId = await createTrackId('shazam', trackKey);

    const songSection = rawTrack.sections?.find((s) => s.type?.toUpperCase() === 'SONG');
    const album =
      songSection?.metadata?.find((m) => m.title?.toUpperCase() === 'ALBUM')?.text ?? null;
    const releaseDateRaw =
      songSection?.metadata?.find((m) => m.title?.toUpperCase() === 'RELEASED')?.text ?? null;

    let releaseDate: string | null = null;
    if (releaseDateRaw) {
      const year = Number.parseInt(releaseDateRaw, 10);
      if (year >= 1700 && year <= new Date().getFullYear()) {
        releaseDate = `${year}-01-01`;
      }
    }

    const lyricsSection = rawTrack.sections?.find((s) => s.type?.toUpperCase() === 'LYRICS');
    const lyricsText = lyricsSection?.text?.join('\n')?.trim();

    const trackLinks: Track['trackLinks'] = {};
    const appleMusicOpt = rawTrack.hub?.options?.find(
      (opt) =>
        opt.type?.toUpperCase() === 'OPEN' && opt.providername?.toUpperCase() === 'APPLEMUSIC'
    );
    const appleMusicLink = appleMusicOpt?.actions?.find(
      (a) => a.name === 'hub:applemusic:deeplink'
    )?.uri;

    if (appleMusicLink) {
      const cleaned = appleMusicLink
        .replace(/^.*music\.apple\.com/, 'https://music.apple.com')
        .split('&')[0];
      if (cleaned.startsWith('https://')) {
        trackLinks.appleMusic = cleaned;
      }
    }

    const coverHq = rawTrack.images?.coverarthq;
    const bg = rawTrack.images?.background;
    const cover = rawTrack.images?.coverart;
    const chosenArt = coverHq ?? bg ?? cover;

    const offsetSec = data.matches?.[0]?.offset;
    const recognizedAtMs = offsetSec ? Math.round(offsetSec * 1000) : null;

    const track: Track = {
      id: trackId,
      title: rawTrack.title.trim(),
      artist: rawTrack.subtitle.trim(),
      album,
      releaseDate,
      durationMs: null,
      recognizedAtMs,
      recognizedBy: 'shazam',
      recognitionDate: timestamp,
      lyrics: lyricsText ? { type: 'plain', text: lyricsText } : null,
      isrc: normalizeIsrc(rawTrack.isrc),
      artworkThumbUrl: convertImageUrl(chosenArt, '400x400cc'),
      artworkUrl: convertImageUrl(chosenArt, '1500x1500cc'),
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
