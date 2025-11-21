/**
 * Bit-stream reader.
 *
 * Provides read-only bit access to a `Uint8Array` or `Uint8ArrayClamped` buffer.
 */
class BitReader {
  #buffer: Uint8Array | Uint8ClampedArray;
  #pos = 0;
  #bitPos = 0;

  constructor(buffer: Uint8Array | Uint8ClampedArray) {
    this.#buffer = buffer;
  }

  reset_(buffer: Uint8Array | Uint8ClampedArray): void {
    this.#buffer = buffer;
    this.#pos = 0;
    this.#bitPos = 0;
  }

  readBits_(n: number, peek: boolean = false): number {
    let result = 0;
    let pos = this.#pos;
    let bitPos = this.#bitPos;
    let bitsRead = 0;
    let bitsRemaining = n;
    do {
      const mask = ((1 << bitsRemaining) - 1) & 0xff;
      const bits = ((this.#buffer[pos] ?? 0) >>> bitPos) & mask;
      result |= bits << bitsRead;
      const newBitPos = bitPos + bitsRemaining;
      if (newBitPos > 7) {
        const bitChange = 8 - bitPos;
        bitsRead += bitChange;
        bitsRemaining -= bitChange;
        pos++;
        bitPos = 0;
      } else {
        bitPos = newBitPos;
        break;
      }
    } while (bitsRead < n);
    if (!peek) {
      this.#pos = pos;
      this.#bitPos = bitPos;
    }
    return result;
  }

  readBit_(): 0 | 1 {
    const bit = (((this.#buffer[this.#pos] ?? 0) >>> this.#bitPos++) & 1) as 0 | 1;
    if (this.#bitPos > 7) {
      this.#pos++;
      this.#bitPos = 0;
    }
    return bit;
  }

  tell_(): number {
    return (this.#pos << 3) + this.#bitPos;
  }

  skip_(n: number): void {
    if (n < 1) {
      return;
    }
    this.#bitPos += n;
    while (this.#bitPos > 7) {
      this.#pos++;
      this.#bitPos -= 8;
    }
  }

  align32_(): void {
    const n = (32 - (this.tell_() & 31)) & 31;
    this.skip_(n);
  }

  bitsLeft_(): number {
    return ((this.#buffer.length - this.#pos) << 3) - this.#bitPos;
  }

  applySign_(v: number): number {
    return this.readBit_() ? -v : v;
  }
}

export { BitReader };
