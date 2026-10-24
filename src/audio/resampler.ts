/**
 * Resamples 16-bit PCM mono audio from inputSampleRate to outputSampleRate using linear interpolation.
 */
export function resamplePcm16(
  input: Int16Array,
  inputSampleRate: number,
  outputSampleRate: number
): Int16Array {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  if (inputSampleRate <= 0 || outputSampleRate <= 0) {
    throw new Error(`Invalid sample rates: input=${inputSampleRate}, output=${outputSampleRate}`);
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;

    const sample1 = input[srcIndex] ?? 0;
    const sample2 = input[srcIndex + 1] ?? sample1;

    output[i] = Math.round(sample1 + frac * (sample2 - sample1));
  }

  return output;
}
