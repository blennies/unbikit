/**
 * Module holding audio decoding logic for the BIK decoder.
 */
import type { IntRange } from "type-fest";
import { AUDIO_CRITICAL_FREQS, AUDIO_RLE_LENGTH_TABLE } from "./bik-constants.ts";
import { BitReader } from "./bik-decoder-utils.ts";
import { genIDxT } from "./transforms.ts";

interface BikAudioDecoder
  extends Generator<Float32Array[][], Float32Array[][], Uint8Array | null | undefined> {
  /**
   * Decode a byte array of encoded BIK audio data.
   *
   * @param value Encoded BIK audio data.
   * @returns Decoded audio samples, indexed by block and then by channel.
   */
  next(
    ...[value]: [] | [Uint8Array] | [null] | [undefined]
  ): IteratorResult<Float32Array[][], Float32Array[][]>;
}

/**
 * Create a generator for decoding packets of BIK audio data.
 * @param sampleRate Sample rate/frequency of the audio data (in Hz).
 * @param numChannels Number of separate audio channels (may or may not have interleaved stereo).
 * @param useDCT `true` when the audio data is encoded using DCTs (discrete cosine transforms),
 *   otherwise `false` when the audio data is encoded using RDFTs (real discrete Fourier
 *   transforms).
 * @returns
 */
function* genBikAudioDecoder(
  sampleRate: number,
  numChannels: number,
  useDCT: boolean,
): BikAudioDecoder {
  /*
   * Initialize the audio decoder.
   */
  let frameLenBits: 9 | 10 | 11;
  if (sampleRate < 22050) frameLenBits = 9;
  else if (sampleRate < 44100) frameLenBits = 10;
  else frameLenBits = 11;

  // IRDFT variant (non-DCT) uses interleaved audio, so account for this
  let numInternalChannels = numChannels;
  if (!useDCT) {
    sampleRate *= numChannels;
    // support up to 8 channels
    frameLenBits += Math.ceil(Math.log2(numChannels)) & 3;
    numInternalChannels = 1; // after interleaving
  }
  const frameLen = 1 << frameLenBits;
  const overlapLen = frameLen >>> 4;
  const blockSize = (frameLen - overlapLen) * numInternalChannels;

  const sampleRateHalf = (sampleRate + 1) >>> 1;
  const baseQuant = (useDCT ? frameLen : 2.0) / (Math.sqrt(frameLen) * 32768.0);

  const expMultiplier = 0.0664 / Math.log10(Math.E);
  const quantTable = new Float32Array(96);
  for (let i = 0; i < 96; i++) {
    quantTable[i] = Math.exp(i * expMultiplier) * baseQuant;
  }

  let numBands = AUDIO_CRITICAL_FREQS.findIndex((x) => sampleRateHalf <= x);
  numBands = numBands < 0 ? AUDIO_CRITICAL_FREQS.length + 1 : numBands + 1;

  const bands = new Uint32Array(numBands + 1);
  bands[0] = 2;
  for (let i = 1; i < numBands; i++) {
    bands[i] = (((AUDIO_CRITICAL_FREQS[i - 1] as number) * frameLen) / sampleRateHalf) & ~1;
  }
  bands[numBands] = frameLen;

  const output = new Array(numInternalChannels);
  for (const [index] of output.entries()) {
    output[index] = new Float32Array(frameLen);
  }
  const overlapWindows: Float32Array[] = [];
  for (let i = 0; i < numInternalChannels; i++) {
    overlapWindows.push(new Float32Array(overlapLen));
  }

  const idt = genIDxT(frameLenBits as 9 | 10 | 11 | 12 | 13 | 14, useDCT);
  idt.next();

  let first = true;

  /*
   * Decode a data buffer with each iteration.
   */
  let allOutput: Float32Array[][] = [];
  while (true) {
    const data = yield allOutput;
    allOutput = [];
    if (!data) {
      first = true;
      continue;
    }
    const reader = new BitReader(data);

    const readDequantFloat29 = () => {
      const power = reader.readBits_(5);
      return reader.applySign_(reader.readBits_(23) * 2 ** (power - 23)) * baseQuant;
    };

    while (reader.bitsLeft_ > 0) {
      if (useDCT) {
        reader.skip_(2);
      }

      for (let ch = 0; ch < numInternalChannels; ch++) {
        const coeffs = output[ch] as Float32Array;

        // Get first two (unencoded) coefficients
        coeffs[0] = readDequantFloat29();
        coeffs[1] = readDequantFloat29();

        // Calculate the quantizers for each band for this frame
        const quant = new Float32Array(numBands);
        for (let i = 0; i < quant.length; i++) {
          quant[i] = quantTable[Math.min(reader.readBits_(8), 95)] as number;
        }

        let k = 0;
        let q = quant[0] as number;
        let i = 2;

        while (i < frameLen) {
          let j: number;
          if (reader.readBit_()) {
            const v = reader.readBits_(4) as IntRange<0, 16>;
            j = i + AUDIO_RLE_LENGTH_TABLE[v];
          } else {
            j = i + 8;
          }

          j = ~~Math.min(j, frameLen);

          const width = reader.readBits_(4);
          if (width === 0) {
            coeffs.fill(0, i, j);
            i = j;
            while ((bands[k] ?? 0) < i) {
              q = quant[k++] ?? 0;
            }
          } else {
            while (i < j) {
              if (bands[k] === i) {
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

        idt.next(coeffs);
        if (useDCT) {
          const dctModifier = 4 * baseQuant;
          for (let i = 0; i < coeffs.length; i++) {
            (coeffs[i] as number) *= dctModifier;
          }
        }
      }

      // Overlap end of previous block of audio with this block
      for (let ch = 0; ch < numInternalChannels; ch++) {
        const coeffs = output[ch] as Float32Array;
        const overlapWindow = overlapWindows[ch] as Float32Array;
        if (!first) {
          const count = overlapLen * numInternalChannels;
          for (let i = 0, j = ch; i < overlapLen; i++, j += numInternalChannels) {
            coeffs[i] = ((overlapWindow[i] ?? 0) * (count - j) + (coeffs[i] ?? 0) * j) / count;
          }
        }
        overlapWindow.set(coeffs.subarray(frameLen - overlapLen));
      }

      // Convert to planar format if the channels are interleaved, and add the final data to the
      // array of processed blocks
      const outputBlock: Float32Array[] = [];
      const stride = Math.ceil(numChannels / numInternalChannels);
      if (stride > 1) {
        let intCh = 0;
        while (intCh < numInternalChannels) {
          const internalBlock = output[intCh] as Float32Array;
          let ch = 0;
          while (ch < numChannels) {
            for (let strideCount = 0; strideCount < stride; strideCount++) {
              const deinterleavedBlock = new Float32Array(~~(blockSize / stride));
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
        const actualOutputBlockSize = ~~(blockSize / numInternalChannels);
        for (let ch = 0; ch < numInternalChannels; ch++) {
          outputBlock.push((output[ch] as Float32Array).slice(0, actualOutputBlockSize));
        }
      }
      allOutput.push(outputBlock);

      first = false;
      reader.align32_();
    }
  }
}

export { genBikAudioDecoder };
