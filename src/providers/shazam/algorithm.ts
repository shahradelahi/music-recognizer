import { RealFft2048 } from './fft.js';
import { HANNING_WINDOW_2048_MULTIPLIERS } from './hanning.js';

export interface FrequencyPeak {
  fftPassNumber: number;
  peakMagnitude: number;
  correctedPeakFrequencyBin: number;
}

export const enum FrequencyBand {
  _250_520 = 0,
  _520_1450 = 1,
  _1450_3500 = 2,
  _3500_5500 = 3,
}

export interface DecodedSignature {
  sampleRateHz: number;
  numberSamples: number;
  frequencyBandToSoundPeaks: [FrequencyPeak[], FrequencyPeak[], FrequencyPeak[], FrequencyPeak[]];
}

export class SignatureGenerator {
  #ringBuffer: Int16Array = new Int16Array(2048);
  #ringBufferIndex = 0;

  #reorderedRingBuffer: Float32Array = new Float32Array(2048);
  #complexRe: Float32Array = new Float32Array(1025);
  #complexIm: Float32Array = new Float32Array(1025);

  #fftOutputs: Float32Array[] = Array.from({ length: 256 }, () => new Float32Array(1025));
  #fftOutputsIndex = 0;

  #spreadFftOutputs: Float32Array[] = Array.from({ length: 256 }, () => new Float32Array(1025));
  #spreadFftOutputsIndex = 0;

  #numSpreadFftsDone = 0;
  #fftObject = new RealFft2048();

  #signature: DecodedSignature;

  private constructor(totalSamples: number) {
    this.#signature = {
      sampleRateHz: 16000,
      numberSamples: totalSamples,
      frequencyBandToSoundPeaks: [[], [], [], []],
    };
  }

  static makeSignatureFromBuffer(s16Buffer: Int16Array): DecodedSignature {
    const generator = new SignatureGenerator(s16Buffer.length);
    const numChunks = Math.floor(s16Buffer.length / 128);

    for (let i = 0; i < numChunks; i++) {
      const chunk = s16Buffer.subarray(i * 128, (i + 1) * 128);
      generator.#doFft(chunk);
      generator.#doPeakSpreading();

      generator.#numSpreadFftsDone++;
      if (generator.#numSpreadFftsDone >= 46) {
        generator.#doPeakRecognition();
      }
    }

    return generator.#signature;
  }

  #doFft(chunk: Int16Array): void {
    // Copy 128 samples to ring buffer
    this.#ringBuffer.set(chunk, this.#ringBufferIndex);
    this.#ringBufferIndex = (this.#ringBufferIndex + 128) & 2047;

    // Apply Hanning window to reordered ring buffer
    for (let i = 0; i < 2048; i++) {
      const ringIdx = (i + this.#ringBufferIndex) & 2047;
      this.#reorderedRingBuffer[i] = this.#ringBuffer[ringIdx] * HANNING_WINDOW_2048_MULTIPLIERS[i];
    }

    // FFT
    this.#fftObject.process(this.#reorderedRingBuffer, this.#complexRe, this.#complexIm);

    // Power spectrum: (re^2 + im^2) / (1 << 17), max 1e-10
    const out = this.#fftOutputs[this.#fftOutputsIndex];
    const denom = 1 << 17;
    for (let i = 0; i < 1025; i++) {
      const power = (this.#complexRe[i] ** 2 + this.#complexIm[i] ** 2) / denom;
      out[i] = Math.max(power, 0.0000000001);
    }

    this.#fftOutputsIndex = (this.#fftOutputsIndex + 1) & 255;
  }

  #doPeakSpreading(): void {
    const prevFftIndex = (this.#fftOutputsIndex - 1) & 255;
    const realFftResults = this.#fftOutputs[prevFftIndex];
    const spreadFftResults = this.#spreadFftOutputs[this.#spreadFftOutputsIndex];

    spreadFftResults.set(realFftResults);

    // Frequency-domain spreading
    for (let position = 0; position <= 1022; position++) {
      spreadFftResults[position] = Math.max(
        spreadFftResults[position],
        spreadFftResults[position + 1],
        spreadFftResults[position + 2]
      );
    }

    // Time-domain spreading
    const copy = new Float32Array(spreadFftResults);
    for (const formerOffset of [1, 3, 6]) {
      const formerIndex = (this.#spreadFftOutputsIndex - formerOffset) & 255;
      const formerFftOutput = this.#spreadFftOutputs[formerIndex];
      for (let position = 0; position <= 1024; position++) {
        formerFftOutput[position] = Math.max(formerFftOutput[position], copy[position]);
      }
    }

    this.#spreadFftOutputsIndex = (this.#spreadFftOutputsIndex + 1) & 255;
  }

  #doPeakRecognition(): void {
    const fftMinus46Index = (this.#fftOutputsIndex - 46) & 255;
    const fftMinus49Index = (this.#spreadFftOutputsIndex - 49) & 255;

    const fftMinus46 = this.#fftOutputs[fftMinus46Index];
    const fftMinus49 = this.#spreadFftOutputs[fftMinus49Index];

    const neighborOffsets = [-10, -7, -4, -3, 1, 2, 5, 8];
    const otherOffsets = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];

    for (let binPos = 10; binPos <= 1014; binPos++) {
      if (fftMinus46[binPos] >= 1.0 / 64.0 && fftMinus46[binPos] >= fftMinus49[binPos - 1]) {
        let maxNeighborInFftMinus49 = 0.0;
        for (const offset of neighborOffsets) {
          const val = fftMinus49[binPos + offset];
          if (val > maxNeighborInFftMinus49) {
            maxNeighborInFftMinus49 = val;
          }
        }

        if (fftMinus46[binPos] > maxNeighborInFftMinus49) {
          let maxNeighborInOther = maxNeighborInFftMinus49;
          for (const otherOffset of otherOffsets) {
            const otherIndex = (this.#spreadFftOutputsIndex + otherOffset) & 255;
            const otherVal = this.#spreadFftOutputs[otherIndex][binPos - 1];
            if (otherVal > maxNeighborInOther) {
              maxNeighborInOther = otherVal;
            }
          }

          if (fftMinus46[binPos] > maxNeighborInOther) {
            const fftPassNumber = this.#numSpreadFftsDone - 46;

            const peakMag = Math.max(Math.log(fftMinus46[binPos]), 1.0 / 64.0) * 1477.3 + 6144.0;
            const peakMagBefore =
              Math.max(Math.log(fftMinus46[binPos - 1]), 1.0 / 64.0) * 1477.3 + 6144.0;
            const peakMagAfter =
              Math.max(Math.log(fftMinus46[binPos + 1]), 1.0 / 64.0) * 1477.3 + 6144.0;

            const peakVar1 = peakMag * 2.0 - peakMagBefore - peakMagAfter;
            const peakVar2 = ((peakMagAfter - peakMagBefore) * 32.0) / peakVar1;

            const correctedBin = ((binPos * 64 + peakVar2) | 0) & 0xffff;
            const frequencyHz = correctedBin * (16000.0 / 2.0 / 1024.0 / 64.0);

            let band: FrequencyBand;
            if (frequencyHz >= 250 && frequencyHz < 520) {
              band = FrequencyBand._250_520;
            } else if (frequencyHz >= 520 && frequencyHz < 1450) {
              band = FrequencyBand._520_1450;
            } else if (frequencyHz >= 1450 && frequencyHz < 3500) {
              band = FrequencyBand._1450_3500;
            } else if (frequencyHz >= 3500 && frequencyHz <= 5500) {
              band = FrequencyBand._3500_5500;
            } else {
              continue;
            }

            this.#signature.frequencyBandToSoundPeaks[band].push({
              fftPassNumber,
              peakMagnitude: (peakMag | 0) & 0xffff,
              correctedPeakFrequencyBin: correctedBin,
            });
          }
        }
      }
    }
  }
}
