export const UUID_NAMESPACES = {
  acrcloud: 'b2f226c2-e0e8-45d1-884f-856a8c59f174',
  audd: 'bbfa96d0-dae8-4273-912a-0d9e2e1931c2',
  shazam: '35f0e68f-421e-40ce-847e-f5b3c5ab77e5',
} as const;

export const SHAZAM_CONFIG = {
  endpoint: 'https://amp.shazam.com/discovery/v5/en/US/android/-/tag',
  signaturePrefix: 'data:audio/vnd.shazam.sig;base64,',
  sampleRate: 16000,
  maxSampleDurationSec: 12,
  userAgents: [
    'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)',
    'Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-G920I Build/LMY47X)',
    'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G930F Build/MMB29K)',
    'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G935R4 Build/MMB29M)',
    'Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)',
  ],
  timezones: [
    'Europe/Berlin',
    'Europe/London',
    'Europe/Paris',
    'Europe/Rome',
    'Europe/Amsterdam',
    'Europe/Madrid',
    'Europe/Warsaw',
    'America/New_York',
  ],
} as const;

export const AUDD_CONFIG = {
  restEndpoint: 'https://api.audd.io/',
  returnParam: 'lyrics,spotify,apple_music,deezer,napster,musicbrainz,isrc!',
} as const;

export const ODESLI_CONFIG = {
  apiEndpoint: 'https://api.odesli.co/v1-alpha.1/links',
  pageEndpoint: 'https://song.link',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
} as const;
