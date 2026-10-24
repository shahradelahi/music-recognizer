import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MusicRecognizer } from './index.js';

function decodeWithFfmpeg(filePath: string): Int16Array | null {
  if (!existsSync(filePath)) return null;

  const result = spawnSync('ffmpeg', [
    '-i',
    filePath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-f',
    'wav',
    'pipe:1',
  ]);

  if (result.status !== 0 || !result.stdout) return null;

  const wavBuf = result.stdout;
  // Parse PCM samples directly from WAV or through helper
  return new Int16Array(
    wavBuf.buffer,
    wavBuf.byteOffset + 44,
    Math.floor((wavBuf.byteLength - 44) / 2)
  );
}

describe('Real Audio Recognition Tests (Optional/Local)', () => {
  const recognizer = new MusicRecognizer();

  const surviveSamplePath = 'sample-i-will-survive.ogg';
  const hasSurvive = existsSync(surviveSamplePath);

  it.skipIf(!hasSurvive)(
    'identifies Gloria Gaynor - I Will Survive from local audio sample',
    async () => {
      const pcm = decodeWithFfmpeg(surviveSamplePath);
      expect(pcm).not.toBeNull();
      if (!pcm) return;

      const result = await recognizer.recognize(pcm, {
        enrichLinks: true,
        fetchLyrics: true,
      });

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.track.title.toLowerCase()).toContain('survive');
        expect(result.track.artist.toLowerCase()).toContain('gloria gaynor');
        expect(result.track.isrc).toBe('USUR10200634');
        expect(Object.keys(result.track.trackLinks).length).toBeGreaterThan(0);
        expect(result.track.lyrics?.text).toBeDefined();
      }
    }
  );

  const jadeyeSamplePath = 'sample-jadeye-yektarafe.ogg';
  const hasJadeye = existsSync(jadeyeSamplePath);

  it.skipIf(!hasJadeye)(
    'identifies Morteza Pashaei - Jadeye Yektarafe from local audio sample',
    async () => {
      const pcm = decodeWithFfmpeg(jadeyeSamplePath);
      expect(pcm).not.toBeNull();
      if (!pcm) return;

      const result = await recognizer.recognize(pcm, {
        enrichLinks: true,
        fetchLyrics: true,
      });

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.track.title.toLowerCase()).toContain('jadeye yektarafe');
        expect(result.track.artist.toLowerCase()).toContain('morteza pashaei');
        expect(result.track.isrc).toBe('FRX201621976');
        expect(result.track.lyrics?.type).toBe('synced');
      }
    }
  );
});
