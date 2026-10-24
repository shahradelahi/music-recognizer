// Hanning window multipliers for 2048 samples
// Matches standard Hann window: 0.5 * (1 - cos(2 * pi * i / 2048))
export const HANNING_WINDOW_2048_MULTIPLIERS: Float32Array = new Float32Array(2048);

for (let i = 0; i < 2048; i++) {
  HANNING_WINDOW_2048_MULTIPLIERS[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / 2048));
}
