import { ODESLI_CONFIG } from '../constants.js';
import type { MusicService, OdesliConfig, Track } from '../typings.js';

interface OdesliApiResponse {
  entityUniqueId?: string;
  userCountry?: string;
  pageUrl?: string;
  entitiesByUniqueId?: Record<
    string,
    {
      id?: string;
      type?: string;
      title?: string;
      artistName?: string;
      thumbnailUrl?: string;
      thumbnailWidth?: number;
      thumbnailHeight?: number;
      apiProvider?: string;
    }
  >;
  linksByPlatform?: Record<
    string,
    {
      url?: string;
      entityUniqueId?: string;
    }
  >;
}

interface NextDataProps {
  props?: {
    pageProps?: {
      pageData?: {
        sections?: Array<{
          links?: Array<{
            platform?: string;
            url?: string;
          }>;
        }>;
        entityData?: {
          thumbnailUrl?: string;
          thumbnailWidth?: number;
          thumbnailHeight?: number;
        };
      };
    };
  };
}

export const PLATFORM_TO_SERVICE: Record<string, MusicService> = {
  amazonmusic: 'amazonMusic',
  amazonstore: 'amazonMusic',
  anghami: 'anghami',
  applemusic: 'appleMusic',
  audiomack: 'audiomack',
  audius: 'audius',
  boomplay: 'boomplay',
  deezer: 'deezer',
  napster: 'napster',
  pandora: 'pandora',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
  tidal: 'tidal',
  yandex: 'yandexMusic',
  youtube: 'youtube',
  youtubemusic: 'youtubeMusic',
  qobuz: 'qobuz',
};

export class OdesliTrackLinksFetcher {
  #config: OdesliConfig;

  constructor(config: OdesliConfig = {}) {
    this.#config = config;
  }

  getPriorityQueryUrl(links: Track['trackLinks']): string | null {
    const priorityOrder: MusicService[] = [
      'spotify',
      'appleMusic',
      'amazonMusic',
      'youtubeMusic',
      'youtube',
      'deezer',
      'soundcloud',
      'yandexMusic',
      'napster',
      'tidal',
      'pandora',
      'musicBrainz',
      'audiomack',
      'audius',
      'boomplay',
      'anghami',
    ];

    for (const service of priorityOrder) {
      if (links[service]) return links[service]!;
    }
    return null;
  }

  async fetch(
    trackOrUrl: Track | string
  ): Promise<{ trackLinks: Partial<Record<MusicService, string>>; artworkUrl?: string | null }> {
    const queryUrl =
      typeof trackOrUrl === 'string' ? trackOrUrl : this.getPriorityQueryUrl(trackOrUrl.trackLinks);
    const existingArtwork = typeof trackOrUrl === 'string' ? null : (trackOrUrl.artworkUrl ?? null);

    if (!queryUrl) {
      return { trackLinks: {} };
    }

    if (this.#config.apiKey) {
      return this.#fetchFromApi(queryUrl, existingArtwork);
    }

    // Default to scraping HTML
    return this.#fetchFromHtml(queryUrl, existingArtwork);
  }

  async #fetchFromApi(
    queryUrl: string,
    existingArtwork: string | null
  ): Promise<{ trackLinks: Partial<Record<MusicService, string>>; artworkUrl?: string | null }> {
    const url = new URL(ODESLI_CONFIG.apiEndpoint);
    if (this.#config.apiKey) url.searchParams.set('key', this.#config.apiKey);
    url.searchParams.set('url', queryUrl);
    url.searchParams.set('userCountry', this.#config.userCountry ?? 'US');
    url.searchParams.set('songIfSingle', 'true');

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return { trackLinks: {} };

      const json = (await res.json()) as OdesliApiResponse;
      const trackLinks: Partial<Record<MusicService, string>> = {};

      if (json.linksByPlatform) {
        for (const [platform, linkData] of Object.entries(json.linksByPlatform)) {
          const service = PLATFORM_TO_SERVICE[platform.toLowerCase()];
          if (service && linkData.url) {
            trackLinks[service] = linkData.url;
          }
        }
      }

      let artworkUrl = existingArtwork;
      if (!artworkUrl && json.entitiesByUniqueId) {
        const entities = Object.values(json.entitiesByUniqueId);
        const hiRes = entities.find(
          (e) =>
            e.thumbnailUrl &&
            e.thumbnailWidth &&
            e.thumbnailHeight &&
            e.thumbnailWidth >= 500 &&
            e.thumbnailHeight >= 500
        );
        artworkUrl = hiRes?.thumbnailUrl ?? entities[0]?.thumbnailUrl ?? null;
      }

      return { trackLinks, artworkUrl };
    } catch {
      return { trackLinks: {} };
    }
  }

  async #fetchFromHtml(
    queryUrl: string,
    existingArtwork: string | null
  ): Promise<{ trackLinks: Partial<Record<MusicService, string>>; artworkUrl?: string | null }> {
    const songLinkUrl = `${ODESLI_CONFIG.pageEndpoint}/${encodeURIComponent(queryUrl)}`;

    try {
      const res = await fetch(songLinkUrl, {
        headers: {
          'User-Agent': ODESLI_CONFIG.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      if (!res.ok) return { trackLinks: {} };
      const html = await res.text();

      // Extract __NEXT_DATA__
      const nextDataMatch =
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]) as NextDataProps;
          const trackLinks: Partial<Record<MusicService, string>> = {};
          const sections = nextData.props?.pageProps?.pageData?.sections ?? [];

          for (const section of sections) {
            for (const link of section.links ?? []) {
              if (!link.platform || !link.url) continue;
              const service = PLATFORM_TO_SERVICE[link.platform.toLowerCase()];
              if (service && !trackLinks[service]) {
                trackLinks[service] = link.url;
              }
            }
          }

          let artworkUrl = existingArtwork;
          if (!artworkUrl) {
            const entity = nextData.props?.pageProps?.pageData?.entityData;
            if (entity?.thumbnailUrl) {
              artworkUrl = entity.thumbnailUrl;
            }
          }

          return { trackLinks, artworkUrl };
        } catch {
          // Fall through to regex extraction
        }
      }

      // Fallback: extract open graph image and standard anchors
      const trackLinks: Partial<Record<MusicService, string>> = {};
      const linkRegex = /<a\s+[^>]*?aria-label="([^"]*)"[^>]*?href="([^"]*)"/gi;
      let match: RegExpExecArray | null;

      while ((match = linkRegex.exec(html)) !== null) {
        const ariaLabel = match[1].toLowerCase();
        const href = match[2];
        for (const [platform, service] of Object.entries(PLATFORM_TO_SERVICE)) {
          if (ariaLabel.includes(platform) && !trackLinks[service]) {
            trackLinks[service] = href;
          }
        }
      }

      let artworkUrl = existingArtwork;
      if (!artworkUrl) {
        const ogImageMatch = /<meta property="og:image" content="([^"]+)"/i.exec(html);
        if (ogImageMatch) {
          artworkUrl = ogImageMatch[1];
        }
      }

      return { trackLinks, artworkUrl };
    } catch {
      return { trackLinks: {} };
    }
  }
}
