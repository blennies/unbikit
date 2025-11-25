/**
 * Bit-stream reader.
 *
 * Provides read-only bit access to a `Uint8Array` or `Uint8ArrayClamped` buffer.
 */
class BitReader {
  #buffer: Uint8Array | Uint8ClampedArray;
  #bufferBitLength: number;
  #bitPos = 0;

  constructor(buffer: Uint8Array | Uint8ClampedArray) {
    this.#buffer = buffer;
    this.#bufferBitLength = buffer.length << 3;
  }

  reset_(buffer: Uint8Array | Uint8ClampedArray): void {
    this.#buffer = buffer;
    this.#bufferBitLength = buffer.length << 3;
    this.#bitPos = 0;
  }

  /**
   * Read the specified number of bits from the bit-stream.
   * @param n Number of bits to read. Must be less than or equal to 32.
   * @param peek When `true`, do not update the bit position in the bit-stream, otherwise do
   *   update it.
   * @returns The bits read from the bit-stream.
   */
  readBits_(n: number, peek: boolean = false): number {
    let result = 0;
    let bitPos = this.#bitPos;
    let bitsRemaining = n;
    do {
      const mask = ((1 << bitsRemaining) - 1) & 0xff;
      const bits = ((this.#buffer[bitPos >>> 3] ?? 0) >>> (bitPos & 7)) & mask;
      result |= bits << (n - bitsRemaining);
      if ((bitPos & 7) + bitsRemaining > 7) {
        const posChange = 8 - (bitPos & 7);
        bitsRemaining -= posChange;
        bitPos += posChange;
      } else {
        bitPos += bitsRemaining;
        break;
      }
    } while (bitsRemaining);
    if (!peek) {
      this.#bitPos = bitPos;
    }
    return result;
  }

  readBit_(): 0 | 1 {
    const bit = (((this.#buffer[this.#bitPos >>> 3] ?? 0) >>> (this.#bitPos++ & 7)) & 1) as 0 | 1;
    return bit;
  }

  skip_(n: number): void {
    if (n < 1) {
      return;
    }
    this.#bitPos += n;
  }

  align32_(): void {
    const n = (32 - (this.#bitPos & 31)) & 31;
    this.skip_(n);
  }

  get bitsLeft_(): number {
    return this.#bufferBitLength - this.#bitPos;
  }

  applySign_(v: number): number {
    return this.readBit_() ? -v : v;
  }
}

export { BitReader };
