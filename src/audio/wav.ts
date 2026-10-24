export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  data: Int16Array;
}

/**
 * Checks if buffer starts with 'RIFF' and 'WAVE'.
 */
export function isWav(buffer: Uint8Array): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer[0] === 0x52 && // 'R'
    buffer[1] === 0x49 && // 'I'
    buffer[2] === 0x46 && // 'F'
    buffer[3] === 0x46 && // 'F'
    buffer[8] === 0x57 && // 'W'
    buffer[9] === 0x41 && // 'A'
    buffer[10] === 0x56 && // 'V'
    buffer[11] === 0x45 // 'E'
  );
}

/**
 * Parses RIFF/WAVE header and extracts 16-bit PCM mono samples.
 * Mixes down multichannel audio to mono.
 */
export function parseWav(buffer: Uint8Array): WavInfo {
  if (!isWav(buffer)) {
    throw new Error('Invalid WAV file: missing RIFF/WAVE signature');
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 12;
  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = String.fromCharCode(
      buffer[offset],
      buffer[offset + 1],
      buffer[offset + 2],
      buffer[offset + 3]
    );
    const chunkSize = view.getUint32(offset + 4, true);
    offset += 8;

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset, true);
      channels = view.getUint16(offset + 2, true);
      sampleRate = view.getUint32(offset + 4, true);
      bitsPerSample = view.getUint16(offset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = offset;
      dataSize = Math.min(chunkSize, buffer.length - offset);
      break;
    }

    offset += chunkSize;
    // Align to even boundary
    if (chunkSize % 2 !== 0) offset++;
  }

  if (dataOffset === -1) {
    throw new Error('Invalid WAV file: data chunk not found');
  }

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(
      `Unsupported WAV format (${audioFormat}): only PCM or IEEE float are supported`
    );
  }

  const totalFrames = Math.floor(dataSize / (channels * (bitsPerSample / 8)));
  const monoSamples = new Int16Array(totalFrames);

  if (bitsPerSample === 16 && audioFormat === 1) {
    let srcOffset = dataOffset;
    for (let i = 0; i < totalFrames; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        sum += view.getInt16(srcOffset, true);
        srcOffset += 2;
      }
      monoSamples[i] = Math.round(sum / channels);
    }
  } else if (bitsPerSample === 8 && audioFormat === 1) {
    let srcOffset = dataOffset;
    for (let i = 0; i < totalFrames; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const u8 = view.getUint8(srcOffset);
        sum += (u8 - 128) * 256;
        srcOffset += 1;
      }
      monoSamples[i] = Math.round(sum / channels);
    }
  } else if (bitsPerSample === 32 && audioFormat === 3) {
    // 32-bit float
    let srcOffset = dataOffset;
    for (let i = 0; i < totalFrames; i++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const f32 = view.getFloat32(srcOffset, true);
        sum += Math.max(-1, Math.min(1, f32)) * 32767;
        srcOffset += 4;
      }
      monoSamples[i] = Math.round(sum / channels);
    }
  } else {
    throw new Error(`Unsupported bit depth: ${bitsPerSample} bits`);
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    data: monoSamples,
  };
}
