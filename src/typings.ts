export type MusicService =
  | 'amazonMusic'
  | 'anghami'
  | 'appleMusic'
  | 'audiomack'
  | 'audius'
  | 'boomplay'
  | 'deezer'
  | 'musicBrainz'
  | 'napster'
  | 'pandora'
  | 'qobuz'
  | 'soundcloud'
  | 'spotify'
  | 'tidal'
  | 'yandexMusic'
  | 'youtube'
  | 'youtubeMusic';

export type RecognitionProvider = 'audd' | 'acrcloud' | 'shazam';

export interface SyncedLyricsLine {
  timestampMs: number;
  content: string;
}

export interface PlainLyrics {
  type: 'plain';
  text: string;
}

export interface SyncedLyrics {
  type: 'synced';
  text: string;
  lines: SyncedLyricsLine[];
}

export type Lyrics = PlainLyrics | SyncedLyrics;

export interface TrackProperties {
  isFavorite?: boolean;
  isViewed?: boolean;
  themeSeedColor?: number | null;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  releaseDate?: string | null;
  durationMs?: number | null;
  recognizedAtMs?: number | null;
  recognizedBy: RecognitionProvider;
  recognitionDate: Date;
  lyrics?: Lyrics | null;
  isrc?: string | null;
  artworkThumbUrl?: string | null;
  artworkUrl?: string | null;
  trackLinks: Partial<Record<MusicService, string>>;
  properties?: TrackProperties;
}

export type RemoteRecognitionResult =
  | { status: 'success'; track: Track }
  | { status: 'no_matches' }
  | { status: 'no_sound_detected' }
  | {
      status: 'error';
      code:
        | 'BAD_CONNECTION'
        | 'BAD_RECORDING'
        | 'AUTH_ERROR'
        | 'API_USAGE_LIMITED'
        | 'HTTP_ERROR'
        | 'UNHANDLED_ERROR';
      message: string;
      httpCode?: number;
      cause?: unknown;
    };

export interface AudioSample {
  data: Uint8Array | Buffer;
  mimeType?: string;
  durationMs?: number;
  sampleRate?: number;
  timestamp?: Date;
}

export type AudioInput = Uint8Array | Buffer | Int16Array | AudioSample;

export type AudioDecoderHook = (
  input: Uint8Array | Buffer,
  mimeType?: string
) => Promise<Int16Array>;

export interface AuddConfig {
  apiToken: string;
}

export interface AcrCloudConfig {
  host: string;
  accessKey: string;
  accessSecret: string;
}

export interface OdesliConfig {
  apiKey?: string;
  userCountry?: string;
}

export interface RecognizerOptions {
  audd?: AuddConfig;
  acrcloud?: AcrCloudConfig;
  odesli?: OdesliConfig;
  audioDecoder?: AudioDecoderHook;
}

export interface RecognizeOptions {
  providers?: RecognitionProvider[];
  enrichLinks?: boolean;
  fetchLyrics?: boolean;
}
