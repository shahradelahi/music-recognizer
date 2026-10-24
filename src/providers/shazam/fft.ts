/**
 * Real-to-Complex FFT for 2048 points.
 * Output is 1025 complex numbers (0 Hz to Nyquist 8000 Hz).
 */
export class RealFft2048 {
  #cosTable: Float32Array;
  #sinTable: Float32Array;
  #bitRev: Uint16Array;

  constructor() {
    this.#cosTable = new Float32Array(1024);
    this.#sinTable = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const angle = (-2 * Math.PI * i) / 2048;
      this.#cosTable[i] = Math.cos(angle);
      this.#sinTable[i] = Math.sin(angle);
    }

    this.#bitRev = new Uint16Array(2048);
    for (let i = 0; i < 2048; i++) {
      let rev = 0;
      let temp = i;
      for (let j = 0; j < 11; j++) {
        rev = (rev << 1) | (temp & 1);
        temp >>= 1;
      }
      this.#bitRev[i] = rev;
    }
  }

  /**
   * Process 2048 real samples into 1025 complex points.
   * re and im should each have length at least 1025.
   */
  process(realInput: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
    // 2048-point complex FFT with zero imaginary parts
    const workRe = new Float32Array(2048);
    const workIm = new Float32Array(2048);

    for (let i = 0; i < 2048; i++) {
      workRe[this.#bitRev[i]] = realInput[i];
    }

    // Cooley-Tukey Radix-2 Decimation-in-Time FFT
    for (let len = 2; len <= 2048; len <<= 1) {
      const halfLen = len >> 1;
      const step = 2048 / len;

      for (let i = 0; i < 2048; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const tableIdx = j * step;
          const uRe = workRe[i + j];
          const uIm = workIm[i + j];

          const vRe = workRe[i + j + halfLen];
          const vIm = workIm[i + j + halfLen];

          const cos = this.#cosTable[tableIdx];
          const sin = this.#sinTable[tableIdx];

          // t = v * e^(-2pi*i*j/len)
          const tRe = vRe * cos - vIm * sin;
          const tIm = vRe * sin + vIm * cos;

          workRe[i + j] = uRe + tRe;
          workIm[i + j] = uIm + tIm;
          workRe[i + j + halfLen] = uRe - tRe;
          workIm[i + j + halfLen] = uIm - tIm;
        }
      }
    }

    for (let i = 0; i < 1025; i++) {
      outRe[i] = workRe[i];
      outIm[i] = workIm[i];
    }
  }
}
