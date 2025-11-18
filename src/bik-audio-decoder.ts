/**
 * Module holding audio decoding logic for the BIK decoder.
 */
import type { IntRange } from "type-fest";
import { AUDIO_CRITICAL_FREQS, AUDIO_RLE_LENGTH_TABLE } from "./bik-constants.ts";
import { BitReader } from "./bik-decoder-utils.ts";

class BikAudioDecoder {
  #numChannels: number;
  #numInternalChannels: number; // after interleaving, if any

  #first = true;
  #frameLen: number;
  #overlapLen: number;
  #blockSize: number;
  #baseQuant: number;
  #quantTable = new Float32Array(96);
  #numBands: number;
  #bands: Uint32Array;
  #output: Float32Array[];
  #overlapWindow: Float32Array[] = [];
  #useDCT: boolean;
  #idt: IDCT | IRDFT;

  constructor(sampleRate: number, numChannels: number, useDCT: boolean) {
    let frameLenBits: 9 | 10 | 11 | 12 | 13 | 14;
    if (sampleRate < 22050) frameLenBits = 9;
    else if (sampleRate < 44100) frameLenBits = 10;
    else frameLenBits = 11;

    // IRDFT variant (non-DCT) uses interleaved audio, so account for this
    let numInternalChannels = numChannels;
    if (!useDCT) {
      sampleRate *= numChannels;
      // support up to 8 channels
      frameLenBits += Math.ceil(Math.log2(numChannels)) & 3;
      frameLenBits = frameLenBits as 9 | 10 | 11 | 12 | 13 | 14;
      numInternalChannels = 1;
    }
    this.#numInternalChannels = numInternalChannels;
    this.#numChannels = numChannels;

    this.#frameLen = 1 << frameLenBits;
    this.#overlapLen = this.#frameLen / 16;
    this.#blockSize = (this.#frameLen - this.#overlapLen) * numInternalChannels;

    const sampleRateHalf = (sampleRate + 1) >>> 1;
    this.#baseQuant = (useDCT ? this.#frameLen : 2.0) / (Math.sqrt(this.#frameLen) * 32768.0);

    const expMultiplier = 0.0664 / Math.log10(Math.E);
    for (let i = 0; i < 96; i++) {
      this.#quantTable[i] = Math.exp(i * expMultiplier) * this.#baseQuant;
    }

    let numBands = AUDIO_CRITICAL_FREQS.findIndex((x) => sampleRateHalf <= x);
    numBands = numBands < 0 ? AUDIO_CRITICAL_FREQS.length + 1 : numBands + 1;
    this.#numBands = numBands;

    this.#bands = new Uint32Array(numBands + 1);
    this.#bands[0] = 2;
    for (let i = 1; i < numBands; i++) {
      this.#bands[i] =
        (((AUDIO_CRITICAL_FREQS[i - 1] as number) * this.#frameLen) / sampleRateHalf) & ~1;
    }
    this.#bands[numBands] = this.#frameLen;

    this.#output = new Array(this.#numInternalChannels);
    for (const [index] of this.#output.entries()) {
      this.#output[index] = new Float32Array(this.#frameLen);
    }
    for (let i = 0; i < numInternalChannels; i++) {
      this.#overlapWindow.push(new Float32Array(this.#overlapLen));
    }

    this.#useDCT = useDCT;
    this.#idt = useDCT ? new IDCT(frameLenBits) : new IRDFT(frameLenBits);
  }

  /**
   * Decode all blocks and channels of a frame of audio data.
   * @param data Encoded frame audio data.
   * @returns Decoded data indexed by block number and then by channel number.
   */
  decode(data: Uint8Array): Float32Array[][] {
    const reader = new BitReader(data);
    const output = this.#output;
    const allOutput: Float32Array[][] = [];

    while (reader.bitsLeft_() > 0) {
      if (this.#useDCT) {
        reader.skip_(2);
      }

      for (let ch = 0; ch < this.#numInternalChannels; ch++) {
        const coeffs = output[ch] as Float32Array;

        // Get first two (unencoded) coefficients
        coeffs[0] = this.#getFloat(reader) * this.#baseQuant;
        coeffs[1] = this.#getFloat(reader) * this.#baseQuant;

        // Calculate the quantizers for each band for this frame
        const quant = new Float32Array(this.#numBands);
        for (let i = 0; i < quant.length; i++) {
          quant[i] = this.#quantTable[Math.min(reader.readBits_(8), 95)] as number;
        }

        let k = 0;
        let q = quant[0] as number;
        let i = 2;

        while (i < this.#frameLen) {
          let j: number;
          if (reader.readBit_()) {
            const v = reader.readBits_(4) as IntRange<0, 16>;
            j = i + AUDIO_RLE_LENGTH_TABLE[v];
          } else {
            j = i + 8;
          }

          j = ~~Math.min(j, this.#frameLen);

          const width = reader.readBits_(4);
          if (width === 0) {
            coeffs.fill(0, i, j);
            i = j;
            while ((this.#bands[k] ?? 0) < i) {
              q = quant[k++] ?? 0;
            }
          } else {
            while (i < j) {
              if (this.#bands[k] === i) {
                q = quant[k++] ?? 0;
              }
              const coeff = reader.readBits_(width);
              if (coeff) {
                const sign = reader.readBit_();
                coeffs[i] = sign ? -q * coeff : q * coeff;
              } else {
                coeffs[i] = 0;
              }
              i++;
            }
          }
        }

        this.#idt.calculate_(coeffs);
        if (this.#useDCT) {
          const dctModifier = 4 * this.#baseQuant;
          for (let i = 0; i < coeffs.length; i++) {
            (coeffs[i] as number) *= dctModifier;
          }
        }
      }

      // Overlap end of previous block of audio with this block
      for (let ch = 0; ch < this.#numInternalChannels; ch++) {
        const coeffs = output[ch] as Float32Array;
        const overlapWindow = this.#overlapWindow[ch] as Float32Array;
        if (!this.#first) {
          const count = this.#overlapLen * this.#numInternalChannels;
          for (let i = 0, j = ch; i < this.#overlapLen; i++, j += this.#numInternalChannels) {
            coeffs[i] = ((overlapWindow[i] ?? 0) * (count - j) + (coeffs[i] ?? 0) * j) / count;
          }
        }
        overlapWindow.set(coeffs.subarray(this.#frameLen - this.#overlapLen));
      }

      // Convert to planar format if the channels are interleaved, and add the final data to the
      // array of processed blocks
      const outputBlock: Float32Array[] = [];
      const stride = Math.ceil(this.#numChannels / this.#numInternalChannels);
      if (stride > 1) {
        let intCh = 0;
        while (intCh < this.#numInternalChannels) {
          const internalBlock = output[intCh] as Float32Array;
          let ch = 0;
          while (ch < this.#numChannels) {
            for (let strideCount = 0; strideCount < stride; strideCount++) {
              const deinterleavedBlock = new Float32Array(~~(this.#blockSize / stride));
              for (let i = 0; i < deinterleavedBlock.length; i++) {
                deinterleavedBlock[i] = internalBlock[i * stride + strideCount] as number;
              }
              outputBlock.push(deinterleavedBlock);
            }
            ch += stride;
          }
          intCh++;
        }
      } else {
        const actualOutputBlockSize = ~~(this.#blockSize / this.#numInternalChannels);
        for (let ch = 0; ch < this.#numInternalChannels; ch++) {
          outputBlock.push((output[ch] as Float32Array).slice(0, actualOutputBlockSize));
        }
      }
      allOutput.push(outputBlock);

      this.#first = false;
      reader.align32_();
    }

    return allOutput;
  }

  /**
   * Read a 29-bit floating point value (5 bits exponent, 23 bits mantissa, 1 bit sign) from a
   * readable bit-stream.
   * @param reader Bit-stream to read from.
   * @returns The floating point value as a regular 64-bit double.
   */
  #getFloat(reader: BitReader) {
    const power = reader.readBits_(5);
    const f = reader.readBits_(23) * 2 ** (power - 23);
    return reader.readBit_() ? -f : f;
  }
}

/**
 * 1D Inverse Discrete Cosine Transform (IDCT)
 *
 * This implementation provides the DCT-III transform (inverse of DCT-II), optimized using the
 * algorithm by Byeong Gi Lee, 1984.
 */
class IDCT {
  #n: number;
  #tempBuf: Float32Array;

  constructor(nbits: IntRange<1, 17>) {
    this.#n = 1 << nbits;
    this.#tempBuf = new Float32Array(this.#n);
  }

  /**
   * Calculate inverse DCT for a given array of real values.
   *
   * @param data Real-valued frequency domain samples of length `n`, which are converted in-place
   *   to real-valued time domain samples.
   */
  calculate_(data: Float32Array) {
    if (data.length < this.#n) {
      return;
    }
    this.#inverseTransformInternal(data, 0, this.#n, this.#tempBuf);
  }

  #inverseTransformInternal(data: Float32Array, off: number, n: number, temp: Float32Array) {
    if (n < 2) {
      return;
    }
    const halfLen = n >>> 1;

    temp[off + 0] = data[off] as number;
    temp[off + halfLen] = data[off + 1] as number;
    for (let i = 1; i < halfLen; i++) {
      temp[off + i] = data[off + i * 2] as number;
      temp[off + i + halfLen] =
        (data[off + i * 2 - 1] as number) + (data[off + i * 2 + 1] as number);
    }
    this.#inverseTransformInternal(temp, off, halfLen, data);
    this.#inverseTransformInternal(temp, off + halfLen, halfLen, data);
    for (let i = 0; i < halfLen; i++) {
      const x = temp[off + i] as number;
      const y = (temp[off + i + halfLen] as number) / (Math.cos(((i + 0.5) * Math.PI) / n) * 2);
      data[off + i] = x + y;
      data[off + n - 1 - i] = x - y;
    }
  }
}

/**
 * 1D Inverse Real Discrete Fourier Transform (IRDFT)
 *
 * This implementation provides the inverse RDFT transform for real-valued data, optimized using
 * the Cooley-Tukey FFT algorithm.
 */
class IRDFT {
  #n: number;
  #nDiv4: number;
  #fft: FFT;

  constructor(nbits: IntRange<4, 17>) {
    this.#n = 1 << nbits;
    this.#nDiv4 = this.#n >>> 2;

    // Initialize FFT with half size
    this.#fft = new FFT((nbits - 1) as IntRange<3, 16>);
  }

  /**
   * Calculate inverse RDFT for a given array of real values.
   *
   * Forward FFT/DFT is used and pre-processing applied to ensure the result is an inverse
   * transformation.
   *
   * Input format details: data[0]=Re[0] (DC), data[1]=Re[N/2] (Nyquist),
   *                       data[2k]=Re[k],     data[2k+1]=Im[k] for k=1..N/2-1
   * @param data Real-valued frequency domain samples of length `n`, which are converted in-place
   *   to real-valued time domain samples.
   */
  calculate_(data: Float32Array): void {
    const n = this.#n;
    const nDiv4 = this.#nDiv4;
    if (data.length < n) {
      return;
    }
    const theta = (2 * Math.PI) / n;

    // Handle DC and Nyquist components.
    const dc = data[0] as number;
    const nyquist = data[1] as number;
    data[0] = 0.5 * (dc + nyquist); // Re[0]
    data[1] = 0.5 * (dc - nyquist); // Im[0]

    // Process remaining components.
    for (let i = 1; i < nDiv4; i++) {
      const i1 = i << 1;
      const i2 = n - i1;
      const d01 = data[i1] ?? 0;
      const d02 = data[i2] ?? 0;
      const d11 = data[i1 + 1] ?? 0;
      const d12 = data[i2 + 1] ?? 0;

      // Remap to complex values in the half-size FFT.
      const evenRe = 0.5 * (d01 + d02);
      const oddIm = 0.5 * (d01 - d02);
      const evenIm = 0.5 * (d11 - d12);
      const oddRe = -0.5 * (d11 + d12);

      const cosVal = Math.cos(i * theta);
      const sinVal = Math.sin(i * theta);

      data[i1] = evenRe + oddRe * cosVal - oddIm * sinVal;
      data[i1 + 1] = evenIm + oddIm * cosVal + oddRe * sinVal;
      data[i2] = evenRe - oddRe * cosVal + oddIm * sinVal;
      data[i2 + 1] = -evenIm + oddIm * cosVal + oddRe * sinVal;
    }

    // Apply scaling then call forward FFT.
    this.#fft.calculate_(data);
  }
}

/**
 * Fast Fourier Transform (FFT)
 *
 * Standard Cooley-Tukey radix-2 decimation-in-time FFT.
 */
class FFT {
  #n: number;
  #nbits: number;
  #revTable: Uint16Array;
  #twiddle: Float32Array;

  constructor(nbits: IntRange<2, 17>) {
    this.#nbits = nbits;
    this.#n = 1 << nbits;

    // Build bit-reversal table.
    this.#revTable = new Uint16Array(this.#n);
    for (let i = 0; i < this.#n; i++) {
      this.#revTable[i] = this.#bitReverse(i);
    }

    // Precompute twiddle factors.
    this.#twiddle = new Float32Array(this.#n);
    for (let i = 0; i < this.#n >>> 1; i++) {
      const angle = (-2 * Math.PI * i) / this.#n;
      this.#twiddle[i * 2] = Math.cos(angle);
      this.#twiddle[i * 2 + 1] = Math.sin(angle);
    }
  }

  #bitReverse(x: number): number {
    let result = 0;
    for (let i = 0; i < this.#nbits; i++) {
      result = (result << 1) | (x & 1);
      x >>= 1;
    }
    return result;
  }

  /**
   * In-place FFT
   *
   * Data format: [Re[0], Im[0], Re[1], Im[1], ..., Re[n-1], Im[n-1]]
   */
  calculate_(data: Float32Array): void {
    const n = this.#n;

    // Perform bit-reversal permutation.
    for (let i = 0; i < n; i++) {
      const iDouble = i << 1;
      const j = this.#revTable[i] as number;
      if (j > i) {
        const jDouble = j << 1;
        const tr = data[iDouble];
        const ti = data[iDouble + 1];
        data[iDouble] = data[jDouble] as number;
        data[iDouble + 1] = data[jDouble + 1] as number;
        data[jDouble] = tr as number;
        data[jDouble + 1] = ti as number;
      }
    }

    // Main FFT loop.
    for (let size = 2; size <= n; size <<= 1) {
      const halfSize = size >>> 1;
      const step = ~~(n / size);

      for (let i = 0; i < n; i += size) {
        let twiddleIdx = 0;
        for (let j = 0; j < halfSize; j++) {
          const wr = this.#twiddle[twiddleIdx << 1] as number;
          const wi = this.#twiddle[(twiddleIdx << 1) + 1] as number;

          const evenIdx = (i + j) << 1;
          const oddIdx = (i + j + halfSize) << 1;

          const er = data[evenIdx] as number;
          const ei = data[evenIdx + 1] as number;
          const or = data[oddIdx] as number;
          const oi = data[oddIdx + 1] as number;

          // Twiddle * odd
          const tr = wr * or - wi * oi;
          const ti = wr * oi + wi * or;

          // Butterfly
          data[evenIdx] = er + tr;
          data[evenIdx + 1] = ei + ti;
          data[oddIdx] = er - tr;
          data[oddIdx + 1] = ei - ti;

          twiddleIdx += step;
        }
      }
    }
  }
}

export { BikAudioDecoder };
