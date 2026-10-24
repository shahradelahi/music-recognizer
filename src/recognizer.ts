import { toPcm16Mono16kHz } from './audio/processor.js';
import { LrcLibFetcher } from './metadata/lrclib.js';
import { OdesliTrackLinksFetcher } from './metadata/odesli.js';
import { AcrCloudRecognitionService } from './providers/acrcloud.js';
import { AuddRecognitionService } from './providers/audd.js';
import { ShazamRecognitionService } from './providers/shazam/service.js';
import type {
  AudioInput,
  RecognizeOptions,
  RecognizerOptions,
  RemoteRecognitionResult,
  Track,
} from './typings.js';

export class MusicRecognizer {
  #options: RecognizerOptions;
  #auddService?: AuddRecognitionService;
  #acrcloudService?: AcrCloudRecognitionService;
  #shazamService: ShazamRecognitionService;
  #odesliFetcher: OdesliTrackLinksFetcher;
  #lrcLibFetcher: LrcLibFetcher;

  constructor(options: RecognizerOptions = {}) {
    this.#options = options;
    if (options.audd) {
      this.#auddService = new AuddRecognitionService(options.audd);
    }
    if (options.acrcloud) {
      this.#acrcloudService = new AcrCloudRecognitionService(options.acrcloud);
    }
    this.#shazamService = new ShazamRecognitionService();
    this.#odesliFetcher = new OdesliTrackLinksFetcher(options.odesli);
    this.#lrcLibFetcher = new LrcLibFetcher();
  }

  get shazam(): ShazamRecognitionService {
    return this.#shazamService;
  }

  get audd(): AuddRecognitionService | undefined {
    return this.#auddService;
  }

  get acrcloud(): AcrCloudRecognitionService | undefined {
    return this.#acrcloudService;
  }

  get odesli(): OdesliTrackLinksFetcher {
    return this.#odesliFetcher;
  }

  get lrclib(): LrcLibFetcher {
    return this.#lrcLibFetcher;
  }

  /**
   * Recognizes audio using configured providers in priority order.
   * If a provider returns no matches, falls back to the next one.
   * Automatically resolves audio format (WAV, PCM, or custom hook) for Shazam.
   */
  async recognize(
    input: AudioInput,
    options: RecognizeOptions = {}
  ): Promise<RemoteRecognitionResult> {
    const providers = options.providers ?? ['shazam', 'audd', 'acrcloud'];
    let lastResult: RemoteRecognitionResult = { status: 'no_matches' };

    for (const provider of providers) {
      let res: RemoteRecognitionResult | undefined;

      if (provider === 'shazam') {
        try {
          const pcm = await toPcm16Mono16kHz(input, this.#options.audioDecoder);
          res = await this.#shazamService.recognizeFromPcm(pcm);
        } catch (e) {
          res = {
            status: 'error',
            code: 'BAD_RECORDING',
            message: e instanceof Error ? e.message : 'Failed to decode audio for Shazam',
            cause: e,
          };
        }
      } else if (provider === 'audd') {
        if (this.#auddService) {
          res = await this.#auddService.recognize(input);
        }
      } else if (provider === 'acrcloud') {
        if (this.#acrcloudService) {
          res = await this.#acrcloudService.recognize(input);
        }
      }

      if (res) {
        if (res.status === 'success') {
          if (options.enrichLinks ?? true) {
            res.track = await this.enrichTrackLinks(res.track);
          }
          if (options.fetchLyrics ?? false) {
            res.track = await this.enrichTrackLyrics(res.track);
          }
          return res;
        }
        lastResult = res;
      }
    }

    return lastResult;
  }

  /**
   * Enriches an existing Track with platform-specific links using Odesli.
   */
  async enrichTrackLinks(track: Track): Promise<Track> {
    const { trackLinks, artworkUrl } = await this.#odesliFetcher.fetch(track);
    return {
      ...track,
      artworkUrl: track.artworkUrl ?? artworkUrl ?? null,
      trackLinks: {
        ...track.trackLinks,
        ...trackLinks,
      },
    };
  }

  /**
   * Enriches an existing Track with synced or plain lyrics using LRCLIB if lyrics are missing.
   */
  async enrichTrackLyrics(track: Track): Promise<Track> {
    if (track.lyrics) return track;
    const lyrics = await this.#lrcLibFetcher.fetch(track);
    if (lyrics) {
      return { ...track, lyrics };
    }
    return track;
  }
}
