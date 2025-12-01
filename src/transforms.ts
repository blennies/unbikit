/**
 * Transformation functions (cosine transforms, Fourier transforms, etc.) used during media
 * decoding.
 */
import type { IntRange } from "type-fest";

interface IDxT extends Generator<void, void, Float32Array> {
  /**
   * Calculate inverse DCT/RDFT for a given array of real values.
   *
   * For IRDFT, a forward FFT/DFT is used and pre-processing applied to ensure the result is an
   * inverse transformation.
   *
   * Input format for IRDFT: data[0]=Re[0] (DC), data[1]=Re[N/2] (Nyquist),
   *                         data[2k]=Re[k],     data[2k+1]=Im[k] for k=1..N/2-1
   *
   * @param value Real-valued frequency domain samples of length `n`, which are converted in-place
   *   to real-valued time domain samples.
   */
  next(...[value]: [] | [Float32Array]): IteratorResult<void, void>;
}

/**
 * Generator that implements two inverse transforms.
 *
 * ### 1D Inverse Discrete Cosine Transform (IDCT)
 *
 * This implementation provides the DCT-III transform (inverse of DCT-II), optimized using the
 * algorithm by Byeong Gi Lee, 1984.
 *
 * ### 1D Inverse Real Discrete Fourier Transform (IRDFT)
 *
 * This implementation provides the inverse RDFT transform for real-valued data, optimized using
 * the Cooley-Tukey FFT algorithm.
 *
 * @param nBits Number of values passed for processing with each iteration. Expressed as a power
 *   of 2.
 * @param useDCT `true` when the values passed for processing are encoded using DCTs (discrete
 *   cosine transforms), otherwise `false` when they are encoded using RDFTs (real discrete
 *   Fourier transforms).
 */
function* genIDxT(nBits: IntRange<4, 17>, useDCT: boolean): IDxT {
  /*
   * Initialize the transform.
   */
  const nBase = 1 << nBits;
  const nDiv4 = nBase >>> 2;
  const theta = (2 * Math.PI) / nBase;
  const tempBuf = new Float32Array(nBase);

  let reciprocalCosTables: Float32Array[];
  let cosTable: Float32Array;
  let sinTable: Float32Array;
  let fft: FFT;
  let i: number;

  // Precompute cosine tables.
  if (useDCT) {
    reciprocalCosTables = [];
    for (let tableIndex = 0; tableIndex <= nBits; tableIndex++) {
      const n = 1 << tableIndex;
      const reciprocalCosTable = new Float32Array(n);
      for (i = 0; i < n; i++) {
        reciprocalCosTable[i] = 0.5 / Math.cos(((i + 0.5) * Math.PI) / n);
      }
      reciprocalCosTables.push(reciprocalCosTable);
    }
  } else {
    // Precompute sine and cosine tables.
    cosTable = new Float32Array(nDiv4);
    sinTable = new Float32Array(nDiv4);
    for (i = 0; i < nDiv4; i++) {
      cosTable[i] = Math.cos(i * theta);
      sinTable[i] = Math.sin(i * theta);
    }

    // Initialize FFT with half size
    fft = genFFT((nBits - 1) as IntRange<3, 16>);
    fft.next();
  }

  // Recursive transform function for IDCT.
  const inverseTransformInternal = (
    data: Float32Array,
    off: number,
    n: number,
    nBits: number,
    temp: Float32Array,
  ) => {
    if (n < 2) {
      return;
    }
    const reciprocalCosTable = reciprocalCosTables[nBits] as Float32Array;
    const halfLen = n >>> 1;

    temp[off + 0] = data[off] as number;
    temp[off + halfLen] = data[off + 1] as number;
    for (i = 1; i < halfLen; i++) {
      const iDoubled = i << 1;
      temp[off + i] = data[off + iDoubled] as number;
      temp[off + i + halfLen] =
        (data[off - 1 + iDoubled] as number) + (data[off + 1 + iDoubled] as number);
    }
    inverseTransformInternal(temp, off, halfLen, nBits - 1, data);
    inverseTransformInternal(temp, off + halfLen, halfLen, nBits - 1, data);
    for (i = 0; i < halfLen; i++) {
      const x = temp[off + i] as number;
      const y = (temp[off + i + halfLen] as number) * (reciprocalCosTable[i] as number);
      data[off + i] = x + y;
      data[off + n - 1 - i] = x - y;
    }
  };

  /*
   * Calculate inverse transformation with each iteration.
   */
  let data: Float32Array | null | undefined = yield;
  while (data) {
    if (data.length < nBase) {
      return;
    }
    if (useDCT) {
      inverseTransformInternal(data, 0, nBase, nBits, tempBuf);
    } else {
      // Handle DC and Nyquist components.
      const dc = data[0] as number;
      const nyquist = data[1] as number;
      data[0] = 0.5 * (dc + nyquist); // Re[0]
      data[1] = 0.5 * (dc - nyquist); // Im[0]

      // Process remaining components.
      for (i = 1; i < nDiv4; i++) {
        const i1 = i << 1;
        const i2 = nBase - i1;
        const d01 = data[i1] ?? 0;
        const d02 = data[i2] ?? 0;
        const d11 = data[i1 + 1] ?? 0;
        const d12 = data[i2 + 1] ?? 0;

        // Remap to complex values in the half-size FFT.
        const evenRe = 0.5 * (d01 + d02);
        const oddIm = 0.5 * (d01 - d02);
        const evenIm = 0.5 * (d11 - d12);
        const oddRe = -0.5 * (d11 + d12);

        // biome-ignore lint/style/noNonNullAssertion: defined because `useDCT` is `false`
        const cosVal = cosTable![i] as number;
        // biome-ignore lint/style/noNonNullAssertion: defined because `useDCT` is `false`
        const sinVal = sinTable![i] as number;

        data[i1] = evenRe + oddRe * cosVal - oddIm * sinVal;
        data[i1 + 1] = evenIm + oddIm * cosVal + oddRe * sinVal;
        data[i2] = evenRe - oddRe * cosVal + oddIm * sinVal;
        data[i2 + 1] = -evenIm + oddIm * cosVal + oddRe * sinVal;
      }

      // Apply scaling then call forward FFT.
      // biome-ignore lint/style/noNonNullAssertion: defined because `useDCT` is `false`
      fft!.next(data);
    }
    data = yield;
  }
}

interface FFT extends Generator<void, void, Float32Array> {
  /**
   * Calculate in-place FFT
   *
   * Data format: [Re[0], Im[0], Re[1], Im[1], ..., Re[n-1], Im[n-1]]
   *
   * @param value Real-valued frequency domain samples of length `n`, which are converted in-place
   *   to real-valued time domain samples.
   */
  next(...[value]: [] | [Float32Array]): IteratorResult<void, void>;
}

/**
 * Fast Fourier Transform (FFT)
 *
 * Standard Cooley-Tukey radix-2 decimation-in-time FFT.
 *
 * @param nBits Number of values passed for processing with each iteration. Expressed as a power
 *   of 2.
 */
function* genFFT(nBits: IntRange<2, 17>): FFT {
  /*
   * Initialize the transform.
   */
  const n = 1 << nBits;
  let i: number;
  let j: number;

  // Build bit-reversal table.
  const revTable = new Uint16Array(n);
  for (i = 0; i < n; i++) {
    // Reverse bit order.
    let iCopy = i;
    let value = 0;
    for (j = 0; j < nBits; j++) {
      value = (value << 1) | (iCopy & 1);
      iCopy >>= 1;
    }
    revTable[i] = value;
  }

  // Precompute twiddle factors.
  const twiddle = new Float32Array(n);
  for (i = 0; i < n >>> 1; i++) {
    const twiddleIndex = i << 1;
    const angle = (-2 * Math.PI * i) / n;
    twiddle[twiddleIndex] = Math.cos(angle);
    twiddle[twiddleIndex + 1] = Math.sin(angle);
  }

  /*
   * Calculate FFT with each iteration.
   */
  let data: Float32Array | null | undefined = yield;
  while (data) {
    if (data.length < n) {
      return;
    }

    // Perform bit-reversal permutation.
    for (i = 0; i < n; i++) {
      const iDouble = i << 1;
      j = revTable[i] as number;
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

      for (i = 0; i < n; i += size) {
        let twiddleIdx = 0;
        for (j = 0; j < halfSize; j++) {
          const wr = twiddle[twiddleIdx << 1] as number;
          const wi = twiddle[(twiddleIdx << 1) + 1] as number;

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
    data = yield;
  }
}

/**
 * 1D DCT-III (inverse of DCT-II, sometimes just called IDCT).
 *
 * Fast approximation using signed integers. Optimized for 8 element arrays.
 * Based on the Arai-Agui-Nakajima (AAN) algorithm.
 *
 * This function can be run on each column and row of an 8x8 block as part of calculating a
 * 2D IDCT.
 * @param src Input buffer containing the coefficients to transform.
 * @param srcOffset Offset in the input buffer of the start of the coefficients to transform.
 * @param dest Output buffer to write the result of the transformation to.
 * @param destOffset Offset in the output buffer to write the output of the transformation to.
 * @param column `true` when processing a column; `false` when processing a row.
 */
const idct = (
  src: Int32Array,
  srcOffset: number,
  rawDest: Uint8Array | null,
  destOffset: number,
  column: boolean,
): void => {
  const indexShift = column ? 3 : 0;
  const constantToAdd = column ? 0 : 0x7f;
  const destShift = column ? 0 : 8;
  const dest = rawDest ? rawDest : src;

  let a0 = (src[srcOffset] ?? 0) + constantToAdd;
  let b0 = src[srcOffset + (1 << indexShift)] ?? 0;
  let a2 = src[srcOffset + (2 << indexShift)] ?? 0;
  const x3 = src[srcOffset + (3 << indexShift)] ?? 0;
  const x4 = src[srcOffset + (4 << indexShift)] ?? 0;
  let a4 = src[srcOffset + (5 << indexShift)] ?? 0;
  const x6 = src[srcOffset + (6 << indexShift)] ?? 0;
  const x7 = src[srcOffset + (7 << indexShift)] ?? 0;

  const a1 = a0 - x4;
  const a3 = (DCT_C0 * (a2 - x6)) >> 11;
  const a5 = a4 - x3;
  const a7 = b0 - x7;
  a0 += x4;
  a2 += x6;
  a4 += x3;
  b0 += x7;

  const a0pa2 = a0 + a2;
  const a0ma2 = a0 - a2;
  const a1pa3ma3 = a1 + a3 - a2;
  const a1ma3pa2 = a1 - a3 + a2;

  const b1 = (DCT_C2 * (a5 + a7)) >> 11;
  let b3 = (DCT_C0 * (b0 - a4)) >> 11;
  b0 += a4;
  const b2 = ((DCT_C3 * a5) >> 11) - b0 + b1;
  b3 -= b2;
  const b4 = ((DCT_C1 * a7) >> 11) + b3 - b1;

  dest[destOffset] = (a0pa2 + b0) >> destShift;
  dest[destOffset + (1 << indexShift)] = (a1pa3ma3 + b2) >> destShift;
  dest[destOffset + (2 << indexShift)] = (a1ma3pa2 + b3) >> destShift;
  dest[destOffset + (3 << indexShift)] = (a0ma2 - b4) >> destShift;
  dest[destOffset + (4 << indexShift)] = (a0ma2 + b4) >> destShift;
  dest[destOffset + (5 << indexShift)] = (a1ma3pa2 - b3) >> destShift;
  dest[destOffset + (6 << indexShift)] = (a1pa3ma3 - b2) >> destShift;
  dest[destOffset + (7 << indexShift)] = (a0pa2 - b0) >> destShift;
};

/**
 * 2D DCT-III (inverse of DCT-II, sometimes just called IDCT).
 *
 * Fast approximation using signed integers. Optimized for 8x8 element blocks.
 * Based on the Arai-Agui-Nakajima (AAN) algorithm.
 *
 * Runs the 1D variant on each column and row of the 8x8 entry block.
 * @param block Input buffer containing the 64 (8x8) coefficients to transform.
 * @param dest Output buffer to write the result of the transformation to.
 * @param destOffset Offset in the output buffer to write the output of the transformation to.
 * @param stride Amount to add to `destOffset` to get the next block row in the output
 *   buffer.
 */
const idctPut = (
  block: Int32Array,
  dest: Uint8Array,
  destOffset: number,
  stride: number,
): void => {
  let i: number;

  for (i = 0; i < 8; i++) {
    idct(block, i, null, i, true);
  }

  for (i = 0; i < 64; i += 8) {
    if (destOffset >= dest.length) {
      break;
    }
    idct(block, i, dest, destOffset, false);
    destOffset += stride;
  }
};

/**
 * Variant of {@link #idctPut} that adds the result of the transformation to the values in the
 * output buffer instead of overwriting them.
 */
const idctAdd = (
  block: Int32Array,
  dest: Uint8Array,
  destOffset: number,
  stride: number,
): void => {
  let i: number;

  for (i = 0; i < 8; i++) {
    idct(block, i, null, i, true);
  }

  for (i = 0; i < 64; i += 8) {
    idct(block, i, null, i, false);
  }

  addBlock8x8(block, dest, destOffset, stride);
};

/**
 * Add one 8x8 block of values to another, and store the resulting values in the latter block.
 * @param block 8x8 block of consecutive values to add to the destination block.
 * @param dest Array of values containing the destination block.
 * @param destOffset Offset of the start of the destination block within {@link dest}.
 * @param stride Length of a "line" or "row" of values in {@link dest}. This value will be added
 *   to get from one row of the destination block to the next.
 */
const addBlock8x8 = (
  block: Int32Array,
  dest: Uint8Array,
  destOffset: number,
  stride: number,
): void => {
  stride -= 8;
  let i = -1;
  let iMax = 6;
  while (i++ < 63) {
    (dest[destOffset + i] as number) += block[i] as number;
    if (i > iMax) {
      destOffset += stride;
      iMax += 8;
    }
  }
};

export { addBlock8x8, genIDxT, idctAdd, idctPut };
