import type { AudioDecoderHook, AudioInput } from '../typings.js';
import { resamplePcm16 } from './resampler.js';
import { isWav, parseWav } from './wav.js';

export const TARGET_SAMPLE_RATE = 16000;

/**
 * Resolves any AudioInput into 16-bit 16kHz mono PCM Int16Array.
 * Supports raw Int16Array, WAV buffers, and optional custom AudioDecoderHook.
 */
export async function toPcm16Mono16kHz(
  input: AudioInput,
  decoderHook?: AudioDecoderHook
): Promise<Int16Array> {
  if (input instanceof Int16Array) {
    return input;
  }

  const rawBytes = input instanceof Uint8Array || Buffer.isBuffer(input) ? input : input.data;

  const mimeType =
    input instanceof Uint8Array || Buffer.isBuffer(input) ? undefined : input.mimeType;

  // 1. If WAV header detected, parse and resample if necessary
  if (isWav(rawBytes)) {
    const wav = parseWav(rawBytes);
    return resamplePcm16(wav.data, wav.sampleRate, TARGET_SAMPLE_RATE);
  }

  // 2. If caller provided custom decoder hook, use it
  if (decoderHook) {
    const decoded = await decoderHook(rawBytes, mimeType);
    return decoded;
  }

  // 3. If mimeType indicates raw pcm or sampleRate was provided
  if (typeof input === 'object' && 'sampleRate' in input && input.sampleRate) {
    const pcm = new Int16Array(
      rawBytes.buffer,
      rawBytes.byteOffset,
      Math.floor(rawBytes.byteLength / 2)
    );
    return resamplePcm16(pcm, input.sampleRate, TARGET_SAMPLE_RATE);
  }

  // 4. Fallback: treat as raw 16-bit PCM (assuming 16kHz mono)
  if (rawBytes.byteLength % 2 === 0) {
    return new Int16Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength / 2);
  }

  throw new Error(
    'Unable to process audio into PCM 16kHz mono. Provide a .wav file, raw Int16Array, or configure an audioDecoder hook.'
  );
}
