<h1 align="center">
  <sup>music-recognizer</sup>
  <br>
  <a href="https://github.com/shahradelahi/music-recognizer/actions/workflows/ci.yml"><img src="https://github.com/shahradelahi/music-recognizer/actions/workflows/ci.yml/badge.svg?branch=main&event=push" alt="CI"></a>
  <a href="https://www.npmjs.com/package/music-recognizer"><img src="https://img.shields.io/npm/v/music-recognizer.svg" alt="NPM Version"></a>
  <a href="/LICENSE"><img src="https://img.shields.io/badge/License-GPL_v3-blue.svg?style=flat" alt="GPL-3.0 License"></a>
  <a href="https://bundlephobia.com/package/music-recognizer"><img src="https://img.shields.io/bundlephobia/minzip/music-recognizer" alt="npm bundle size"></a>
  <a href="https://packagephobia.com/result?p=music-recognizer"><img src="https://packagephobia.com/badge?p=music-recognizer" alt="Install Size"></a>
</h1>

_music-recognizer_ is a TypeScript library for song recognition using **Shazam**, **AudD**, and **ACRCloud**, with automated cross-platform streaming link retrieval via **Odesli** (SongLink) and lyrics via **LRCLIB**.

## Benefits

- **Multi-Provider Support:** Identify tracks with Shazam, AudD, or ACRCloud using a unified, standardized interface.
- **Pure TypeScript Fingerprinting:** Complete, dependency-free port of the SongRec Shazam algorithm with 2048-point real FFT, peak detection, CRC32, and Base64 encoding. No native C++ or Python addons required.
- **Audio Processing:** Built-in WAV parser, linear sample-rate resampler to 16 kHz mono, and custom audio decoder hook support.
- **Cross-Platform Links:** Automatically enrich matched tracks with links for Spotify, Apple Music, YouTube Music, Deezer, Tidal, Amazon Music, and more via Odesli.
- **Synced & Plain Lyrics:** Integrated LRCLIB fetcher with timestamped line parsing (`[mm:ss.xx]`) for synchronized playback.
- **Deterministic IDs:** RFC 4122 v5 name-based UUIDs for reliable caching and database indexing.

---

- [Benefits](#benefits)
- [Installation](#-installation)
- [Usage](#-usage)
  - [Quick Start](#quick-start)
  - [Audio Formats & WAV Support](#audio-formats--wav-support)
  - [Custom Audio Decoder Hook](#custom-audio-decoder-hook)
  - [Using AudD & ACRCloud](#using-audd--acrcloud)
  - [Fallback Chain & Multi-Provider](#fallback-chain--multi-provider)
  - [Cross-Platform Links (Odesli)](#cross-platform-links-odesli)
  - [Lyrics Fetching (LRCLIB)](#lyrics-fetching-lrclib)
  - [Standalone Shazam Fingerprinting](#standalone-shazam-fingerprinting)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#license)

## 📦 Installation

```bash
npm install music-recognizer
```

<details>
<summary>Install using your favorite package manager</summary>

**pnpm**

```bash
pnpm install music-recognizer
```

**yarn**

```bash
yarn add music-recognizer
```

</details>

## 📖 Usage

### Quick Start

Identify a song using Shazam with zero external API credentials needed:

```ts
import { readFile } from 'node:fs/promises';
import { MusicRecognizer } from 'music-recognizer';

const recognizer = new MusicRecognizer();

// Provide a WAV buffer (any sample rate/channels) or 16-bit 16kHz mono PCM
const audioBuffer = await readFile('sample.wav');

const result = await recognizer.recognize(audioBuffer, {
  enrichLinks: true, // Fetch streaming links via Odesli
  fetchLyrics: true, // Fetch synced or plain lyrics via LRCLIB
});

if (result.status === 'success') {
  console.log(`${result.track.title} by ${result.track.artist}`);
  console.log('Album:', result.track.album);
  console.log('ISRC:', result.track.isrc);
  console.log('Streaming links:', result.track.trackLinks);
}
```

### Audio Formats & WAV Support

The library accepts `Int16Array`, `Buffer`, `Uint8Array`, or an `AudioSample` object:

```ts
import { parseWav, resamplePcm16, toPcm16Mono16kHz } from 'music-recognizer';

// 1. Raw 16-bit mono 16kHz PCM
const pcm = new Int16Array(16000 * 5); // 5 seconds
await recognizer.recognize(pcm);

// 2. Standard WAV file (auto-parses channels & auto-resamples to 16kHz mono)
const wavBytes = await readFile('recording.wav');
await recognizer.recognize(wavBytes);

// 3. AudioSample descriptor
await recognizer.recognize({
  data: wavBytes,
  mimeType: 'audio/wav',
});
```

### Custom Audio Decoder Hook

Integrate external tools (e.g. `ffmpeg`, `node-lame`, or Web Audio API) to decode MP3, AAC, OGG, or FLAC files directly:

```ts
import { spawnSync } from 'node:child_process';
import { MusicRecognizer } from 'music-recognizer';

const recognizer = new MusicRecognizer({
  audioDecoder: async (buffer, mimeType) => {
    // Decode any format to 16kHz mono 16-bit PCM using ffmpeg
    const proc = spawnSync(
      'ffmpeg',
      ['-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1'],
      { input: buffer }
    );

    return new Int16Array(
      proc.stdout.buffer,
      proc.stdout.byteOffset,
      proc.stdout.byteLength / 2
    );
  },
});

const oggBuffer = await readFile('audio.ogg');
const result = await recognizer.recognize(oggBuffer);
```

### Using AudD & ACRCloud

Configure API keys to enable AudD and ACRCloud recognition:

```ts
const recognizer = new MusicRecognizer({
  audd: {
    apiToken: process.env.AUDD_API_TOKEN!,
  },
  acrcloud: {
    host: 'identify-eu-west-1.acrcloud.com',
    accessKey: process.env.ACRCLOUD_ACCESS_KEY!,
    accessSecret: process.env.ACRCLOUD_ACCESS_SECRET!,
  },
});

// Recognize directly using AudD
const auddResult = await recognizer.audd.recognize(audioBuffer);

// Recognize directly using ACRCloud
const acrResult = await recognizer.acrcloud.recognize(audioBuffer);
```

### Fallback Chain & Multi-Provider

Automatically try multiple providers in order until a match is found:

```ts
const result = await recognizer.recognize(audioBuffer, {
  // Try Shazam first; if no match, fall back to AudD, then ACRCloud
  providers: ['shazam', 'audd', 'acrcloud'],
  enrichLinks: true,
  fetchLyrics: true,
});
```

### Cross-Platform Links (Odesli)

Retrieve streaming links across all major music platforms using any track URL:

```ts
import { OdesliTrackLinksFetcher } from 'music-recognizer';

const odesli = new OdesliTrackLinksFetcher({
  apiKey: process.env.ODESLI_API_KEY, // Optional: falls back to HTML scraping
});

// Lookup by song link
const { trackLinks, artworkUrl } = await odesli.fetch(
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'
);

console.log(trackLinks.appleMusic);
console.log(trackLinks.youtubeMusic);
console.log(trackLinks.deezer);
console.log(trackLinks.tidal);
```

### Lyrics Fetching (LRCLIB)

Fetch synced and plain lyrics directly using LRCLIB:

```ts
import { LrcLibFetcher } from 'music-recognizer';

const lrclib = new LrcLibFetcher();
const lyrics = await lrclib.fetch({
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  durationMs: 354000,
});

if (lyrics?.type === 'synced') {
  for (const line of lyrics.lines) {
    console.log(`[${line.timestampMs}ms] ${line.content}`);
  }
}
```

### Standalone Shazam Fingerprinting

Generate standard Shazam raw binary signatures and data URIs from raw PCM audio:

```ts
import {
  encodeSignatureToBinary,
  encodeSignatureToUri,
  SignatureGenerator,
} from 'music-recognizer';

// pcm16: Int16Array of mono 16000Hz audio
const signature = SignatureGenerator.makeSignatureFromBuffer(pcm16);

// Raw binary byte array with 0xcafe2580 magic header and CRC32 checksum
const binary = encodeSignatureToBinary(signature);

// Data URI: "data:audio/vnd.shazam.sig;base64,..."
const uri = encodeSignatureToUri(signature);
```

## 📚 Documentation

For all configuration options, please see [the API docs](https://www.jsdocs.io/package/music-recognizer).

## 🤝 Contributing

Want to contribute? Awesome! To show your support is to star the project, or to raise issues on [GitHub](https://github.com/shahradelahi/music-recognizer).

Thanks again for your support, it is much appreciated! 🙏

## License

[GPL-3.0](/LICENSE) © [Shahrad Elahi](https://github.com/shahradelahi) and [contributors](https://github.com/shahradelahi/music-recognizer/graphs/contributors).
