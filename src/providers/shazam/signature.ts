import { fromUint8Array } from '@se-oss/base64';
import { crc32 } from '@se-oss/crc32';

import { SHAZAM_CONFIG } from '../../constants.js';
import type { DecodedSignature } from './algorithm.js';

class BinaryWriter {
  #buffer: number[] = [];

  writeU8(val: number): void {
    this.#buffer.push(val & 0xff);
  }

  writeU16LE(val: number): void {
    this.#buffer.push(val & 0xff, (val >> 8) & 0xff);
  }

  writeU32LE(val: number): void {
    this.#buffer.push(val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >>> 24) & 0xff);
  }

  writeBytes(bytes: Uint8Array | number[]): void {
    for (let i = 0; i < bytes.length; i++) {
      this.#buffer.push(bytes[i]);
    }
  }

  setU32LE(offset: number, val: number): void {
    this.#buffer[offset] = val & 0xff;
    this.#buffer[offset + 1] = (val >> 8) & 0xff;
    this.#buffer[offset + 2] = (val >> 16) & 0xff;
    this.#buffer[offset + 3] = (val >>> 24) & 0xff;
  }

  get length(): number {
    return this.#buffer.length;
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.#buffer);
  }
}

export function encodeSignatureToBinary(sig: DecodedSignature): Uint8Array {
  const writer = new BinaryWriter();

  // RawSignatureHeader (48 bytes):
  writer.writeU32LE(0xcafe2580); // magic1
  writer.writeU32LE(0); // crc32 (offset 4) - updated later
  writer.writeU32LE(0); // size_minus_header (offset 8) - updated later
  writer.writeU32LE(0x94119c00); // magic2
  writer.writeU32LE(0); // void1[0]
  writer.writeU32LE(0); // void1[1]
  writer.writeU32LE(0); // void1[2]

  const sampleRateId =
    sig.sampleRateHz === 8000
      ? 1
      : sig.sampleRateHz === 11025
        ? 2
        : sig.sampleRateHz === 16000
          ? 3
          : sig.sampleRateHz === 32000
            ? 4
            : sig.sampleRateHz === 44100
              ? 5
              : sig.sampleRateHz === 48000
                ? 6
                : 3;
  writer.writeU32LE(sampleRateId << 27); // shifted_sample_rate_id

  writer.writeU32LE(0); // void2[0]
  writer.writeU32LE(0); // void2[1]

  const samplesPlusDivided = Math.floor(sig.numberSamples + sig.sampleRateHz * 0.24);
  writer.writeU32LE(samplesPlusDivided); // number_samples_plus_divided_sample_rate
  writer.writeU32LE((15 << 19) + 0x40000); // fixed_value (0x7c0000)

  // Secondary header
  writer.writeU32LE(0x40000000);
  writer.writeU32LE(0); // size_minus_header (offset 52) - updated later

  for (
    let frequencyBand = 0;
    frequencyBand < sig.frequencyBandToSoundPeaks.length;
    frequencyBand++
  ) {
    const peaks = sig.frequencyBandToSoundPeaks[frequencyBand];
    if (peaks.length === 0) continue;

    const peaksWriter = new BinaryWriter();
    let fftPassNumber = 0;

    for (const peak of peaks) {
      if (peak.fftPassNumber - fftPassNumber >= 255) {
        peaksWriter.writeU8(0xff);
        peaksWriter.writeU32LE(peak.fftPassNumber);
        fftPassNumber = peak.fftPassNumber;
      }

      peaksWriter.writeU8(peak.fftPassNumber - fftPassNumber);
      peaksWriter.writeU16LE(peak.peakMagnitude);
      peaksWriter.writeU16LE(peak.correctedPeakFrequencyBin);
      fftPassNumber = peak.fftPassNumber;
    }

    const peaksBuffer = peaksWriter.toUint8Array();

    writer.writeU32LE(0x60030040 + frequencyBand);
    writer.writeU32LE(peaksBuffer.length);
    writer.writeBytes(peaksBuffer);

    // 4-byte alignment padding
    const padding = (4 - (peaksBuffer.length % 4)) % 4;
    for (let p = 0; p < padding; p++) {
      writer.writeU8(0);
    }
  }

  const totalSize = writer.length;
  const sizeMinusHeader = totalSize - 48;

  writer.setU32LE(8, sizeMinusHeader);
  writer.setU32LE(52, sizeMinusHeader);

  const finalArray = writer.toUint8Array();
  // CRC32 of everything after the first 8 bytes (from offset 8 to the end)
  const checksum = crc32(finalArray.subarray(8));
  writer.setU32LE(4, checksum);

  return writer.toUint8Array();
}

export function encodeSignatureToUri(sig: DecodedSignature): string {
  const binary = encodeSignatureToBinary(sig);
  return `${SHAZAM_CONFIG.signaturePrefix}${fromUint8Array(binary)}`;
}
