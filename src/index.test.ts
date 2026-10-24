import { describe, expect, it } from 'vitest';

import {
  AcrCloudRecognitionService,
  AuddRecognitionService,
  createTrackId,
  encodeSignatureToBinary,
  encodeSignatureToUri,
  isWav,
  MusicRecognizer,
  normalizeIsrc,
  OdesliTrackLinksFetcher,
  parseLrcLyrics,
  parseWav,
  resamplePcm16,
  ShazamRecognitionService,
  SignatureGenerator,
  toPcm16Mono16kHz,
} from './index.js';

describe('Music Recognizer - ID & ISRC', () => {
  it('generates deterministic UUIDs matching Audile namespace logic', async () => {
    const id1 = await createTrackId('acrcloud', 'test-acrid-123');
    const id2 = await createTrackId('acrcloud', 'test-acrid-123');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const shazamId = await createTrackId('shazam', 'track-key-456');
    expect(shazamId).not.toBe(id1);
  });

  it('normalizes valid and invalid ISRCs', () => {
    expect(normalizeIsrc('US-RC1-76-04746')).toBe('USRC17604746');
    expect(normalizeIsrc('GBAYE0601477')).toBe('GBAYE0601477');
    expect(normalizeIsrc('invalid-isrc')).toBeNull();
    expect(normalizeIsrc(null)).toBeNull();
  });
});

describe('WAV Parser & Audio Resampler', () => {
  function createMockWavBuffer(
    sampleRate = 44100,
    channels = 2,
    bitsPerSample = 16,
    numFrames = 100
  ): Uint8Array {
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = numFrames * channels * bytesPerSample;
    const buffer = new Uint8Array(44 + dataSize);
    const view = new DataView(buffer.buffer);

    // RIFF header
    buffer[0] = 0x52;
    buffer[1] = 0x49;
    buffer[2] = 0x46;
    buffer[3] = 0x46; // RIFF
    view.setUint32(4, 36 + dataSize, true);
    buffer[8] = 0x57;
    buffer[9] = 0x41;
    buffer[10] = 0x56;
    buffer[11] = 0x45; // WAVE

    // fmt subchunk
    buffer[12] = 0x66;
    buffer[13] = 0x6d;
    buffer[14] = 0x74;
    buffer[15] = 0x20; // fmt
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);

    // data subchunk
    buffer[36] = 0x64;
    buffer[37] = 0x61;
    buffer[38] = 0x74;
    buffer[39] = 0x61; // data
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < numFrames * channels; i++) {
      view.setInt16(44 + i * 2, 1000, true);
    }

    return buffer;
  }

  it('detects and parses 16-bit stereo WAV down to mono', () => {
    const wavBuf = createMockWavBuffer(44100, 2, 16, 200);
    expect(isWav(wavBuf)).toBe(true);

    const parsed = parseWav(wavBuf);
    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.channels).toBe(2);
    expect(parsed.data.length).toBe(200);
    expect(parsed.data[0]).toBe(1000);
  });

  it('resamples PCM 16-bit to target sample rate', () => {
    const input = new Int16Array([0, 1000, 2000, 3000]);
    const resampled = resamplePcm16(input, 32000, 16000);
    expect(resampled.length).toBe(2);
    expect(resampled[0]).toBe(0);
    expect(resampled[1]).toBe(2000);
  });

  it('toPcm16Mono16kHz converts WAV and supports custom audioDecoder hook', async () => {
    const wavBuf = createMockWavBuffer(32000, 1, 16, 320);
    const pcmFromWav = await toPcm16Mono16kHz(wavBuf);
    expect(pcmFromWav.length).toBe(160); // 32kHz -> 16kHz is halved

    const customHook = async (buf: Uint8Array | Buffer) => new Int16Array(buf.length);
    const customResult = await toPcm16Mono16kHz(new Uint8Array(50), customHook);
    expect(customResult.length).toBe(50);
  });
});

describe('LRCLIB Synced Lyrics Parser', () => {
  it('parses standard LRC lyrics timestamps and content', () => {
    const lrc = `
      [00:12.50] Hello world
      [00:15.80] Second line of lyrics
      [01:02.123] After one minute
    `;
    const lines = parseLrcLyrics(lrc);
    expect(lines.length).toBe(3);
    expect(lines[0].timestampMs).toBe(12500);
    expect(lines[0].content).toBe('Hello world');
    expect(lines[1].timestampMs).toBe(15800);
    expect(lines[2].timestampMs).toBe(62123);
  });
});

describe('Shazam SongRec Fingerprint', () => {
  it('generates valid binary signature from PCM 16kHz audio buffer', () => {
    const sampleRate = 16000;
    const numSamples = sampleRate * 2; // 2 seconds
    const pcm = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    }

    const decoded = SignatureGenerator.makeSignatureFromBuffer(pcm);
    expect(decoded.sampleRateHz).toBe(16000);
    expect(decoded.numberSamples).toBe(numSamples);

    const binary = encodeSignatureToBinary(decoded);
    expect(binary.length).toBeGreaterThanOrEqual(48);

    // Verify magic 1: 0xcafe2580 -> 0x80, 0x25, 0xfe, 0xca
    expect(binary[0]).toBe(0x80);
    expect(binary[1]).toBe(0x25);
    expect(binary[2]).toBe(0xfe);
    expect(binary[3]).toBe(0xca);

    // Verify magic 2: 0x94119c00 -> 0x00, 0x9c, 0x11, 0x94
    expect(binary[12]).toBe(0x00);
    expect(binary[13]).toBe(0x9c);
    expect(binary[14]).toBe(0x11);
    expect(binary[15]).toBe(0x94);

    const uri = encodeSignatureToUri(decoded);
    expect(uri.startsWith('data:audio/vnd.shazam.sig;base64,')).toBe(true);
  });
});

describe('Shazam Mapper', () => {
  it('maps Shazam API response to unified Track format', async () => {
    const service = new ShazamRecognitionService();
    const mockResponse = {
      matches: [{ offset: 15.5 }],
      track: {
        key: '123456',
        title: 'Bohemian Rhapsody',
        subtitle: 'Queen',
        isrc: 'GBUM71029604',
        images: {
          coverarthq: 'https://is1-ssl.mzstatic.com/image/thumb/400x400cc.jpg',
        },
        sections: [
          {
            type: 'SONG',
            metadata: [
              { title: 'ALBUM', text: 'A Night at the Opera' },
              { title: 'RELEASED', text: '1975' },
            ],
          },
          {
            type: 'LYRICS',
            text: ['Is this the real life?', 'Is this just fantasy?'],
          },
        ],
        hub: {
          options: [
            {
              type: 'OPEN',
              providername: 'APPLEMUSIC',
              actions: [
                {
                  name: 'hub:applemusic:deeplink',
                  uri: 'https://music.apple.com/us/album/bohemian-rhapsody/1434899831?i=1434900142&uo=4',
                },
              ],
            },
          ],
        },
      },
    };

    const result = await service.mapResponse(mockResponse, new Date());
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.track.title).toBe('Bohemian Rhapsody');
      expect(result.track.artist).toBe('Queen');
      expect(result.track.album).toBe('A Night at the Opera');
      expect(result.track.releaseDate).toBe('1975-01-01');
      expect(result.track.isrc).toBe('GBUM71029604');
      expect(result.track.recognizedAtMs).toBe(15500);
      expect(result.track.lyrics?.text).toContain('Is this the real life?');
      expect(result.track.trackLinks.appleMusic).toBe(
        'https://music.apple.com/us/album/bohemian-rhapsody/1434899831?i=1434900142'
      );
      expect(result.track.artworkUrl).toBe(
        'https://is1-ssl.mzstatic.com/image/thumb/1500x1500cc.jpg'
      );
    }
  });
});

describe('ACRCloud Mapper & Signature', () => {
  it('creates valid HMAC-SHA1 signature', () => {
    const service = new AcrCloudRecognitionService({
      host: 'identify-eu-west-1.acrcloud.com',
      accessKey: 'test_key',
      accessSecret: 'test_secret',
    });

    const sig = service.createSignature('1600000000');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  it('maps ACRCloud response correctly', async () => {
    const service = new AcrCloudRecognitionService({
      host: 'identify-eu-west-1.acrcloud.com',
      accessKey: 'key',
      accessSecret: 'secret',
    });

    const mockResponse = {
      status: { code: 0, msg: 'Success' },
      metadata: {
        music: [
          {
            acrid: 'acr123',
            title: 'Stairway to Heaven',
            artists: [{ name: 'Led Zeppelin' }],
            album: { name: 'Led Zeppelin IV' },
            release_date: '1971-11-08',
            duration_ms: 482000,
            db_begin_time_offset_ms: 12000,
            sample_begin_time_offset_ms: 0,
            score: 100,
            external_ids: { isrc: 'USPR37300012' },
            external_metadata: {
              spotify: { track: { id: '5CQ30WqJwcep0pYcV4AMNc' } },
              youtube: { vid: 'QkF3oxziUI4' },
            },
          },
        ],
      },
    };

    const res = await service.mapResponse(mockResponse, new Date());
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.track.title).toBe('Stairway to Heaven');
      expect(res.track.artist).toBe('Led Zeppelin');
      expect(res.track.album).toBe('Led Zeppelin IV');
      expect(res.track.releaseDate).toBe('1971-11-08');
      expect(res.track.durationMs).toBe(482000);
      expect(res.track.recognizedAtMs).toBe(12000);
      expect(res.track.isrc).toBe('USPR37300012');
      expect(res.track.trackLinks.spotify).toBe(
        'https://open.spotify.com/track/5CQ30WqJwcep0pYcV4AMNc'
      );
      expect(res.track.trackLinks.youtube).toBe('https://www.youtube.com/watch?v=QkF3oxziUI4');
    }
  });
});

describe('AudD Mapper', () => {
  it('maps AudD response with lyrics and cross-platform links', async () => {
    const service = new AuddRecognitionService({ apiToken: 'test_token' });
    const mockResponse = {
      status: 'success' as const,
      result: {
        title: 'Hotel California',
        artist: 'Eagles',
        album: 'Hotel California',
        release_date: '1976-12-08',
        timecode: '01:23',
        song_link: 'https://lis.tn/HotelCalifornia',
        spotify: {
          name: 'Hotel California',
          external_urls: {
            spotify: 'https://open.spotify.com/track/hotel-california',
          },
          album: {
            images: [
              { url: 'https://spotify.com/cover-large.jpg' },
              { url: 'https://spotify.com/cover-small.jpg' },
            ],
          },
        },
        deezer: {
          link: 'https://www.deezer.com/track/hotel-california',
          album: {
            cover_xl: 'https://deezer.com/xl.jpg',
            cover_medium: 'https://deezer.com/medium.jpg',
          },
        },
        lyrics: {
          lyrics: 'Welcome to the Hotel California',
          media: [
            {
              provider: 'youtube',
              url: 'https://youtube.com/watch?v=hotel',
            },
          ],
        },
      },
    };

    const res = await service.mapResponse(mockResponse, new Date());
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.track.title).toBe('Hotel California');
      expect(res.track.artist).toBe('Eagles');
      expect(res.track.recognizedAtMs).toBe(83000);
      expect(res.track.trackLinks.spotify).toBe('https://open.spotify.com/track/hotel-california');
      expect(res.track.trackLinks.deezer).toBe('https://www.deezer.com/track/hotel-california');
      expect(res.track.trackLinks.youtube).toBe('https://youtube.com/watch?v=hotel');
      expect(res.track.artworkUrl).toBe('https://deezer.com/xl.jpg');
      expect(res.track.lyrics?.text).toBe('Welcome to the Hotel California');
    }
  });
});

describe('Odesli Track Links', () => {
  it('identifies highest priority link for query', () => {
    const fetcher = new OdesliTrackLinksFetcher();
    const query = fetcher.getPriorityQueryUrl({
      youtube: 'https://youtube.com/watch?v=123',
      spotify: 'https://open.spotify.com/track/abc',
      appleMusic: 'https://music.apple.com/track/xyz',
    });

    expect(query).toBe('https://open.spotify.com/track/abc');
  });
});

describe('MusicRecognizer class', () => {
  it('instantiates cleanly and provides accessor properties', () => {
    const recognizer = new MusicRecognizer({
      audd: { apiToken: 'token' },
      acrcloud: { host: 'h', accessKey: 'k', accessSecret: 's' },
      odesli: { apiKey: 'key' },
    });

    expect(recognizer.shazam).toBeDefined();
    expect(recognizer.audd).toBeDefined();
    expect(recognizer.acrcloud).toBeDefined();
    expect(recognizer.odesli).toBeDefined();
    expect(recognizer.lrclib).toBeDefined();
  });
});
