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

  readBits_(n: number): number {
    let result = 0;
    let bitsRead = 0;
    let bitsRemaining = n;
    do {
      const mask = ((1 << bitsRemaining) - 1) & 0xff;
      const bits = ((this.#buffer[this.#pos] ?? 0) >>> this.#bitPos) & mask;
      result |= bits << bitsRead;
      const newBitPos = this.#bitPos + bitsRemaining;
      if (newBitPos >= 8) {
        const bitChange = 8 - this.#bitPos;
        bitsRead += bitChange;
        bitsRemaining -= bitChange;
        this.#pos++;
        this.#bitPos = 0;
      } else {
        this.#bitPos = newBitPos;
        break;
      }
    } while (bitsRead < n);
    return result;
  }

  readBit_(): number {
    const bit = ((this.#buffer[this.#pos] ?? 0) >>> this.#bitPos++) & 1;
    if (this.#bitPos >= 8) {
      this.#pos++;
      this.#bitPos = 0;
    }
    return bit;
  }

  tell_(): number {
    return this.#pos * 8 + this.#bitPos;
  }

  skip_(n: number): void {
    this.#bitPos += n;
    while (this.#bitPos >= 8) {
      this.#pos++;
      this.#bitPos -= 8;
    }
  }

  align32_(): void {
    const n = (32 - (this.tell_() & 31)) & 31;
    if (n > 0) this.skip_(n);
  }

  bitsLeft_(): number {
    return (this.#buffer.length - this.#pos) * 8 - this.#bitPos;
  }

  applySign_(v: number): number {
    return this.readBit_() ? -v : v;
  }

  savePos_(): { pos: number; bitPos: number } {
    return { pos: this.#pos, bitPos: this.#bitPos };
  }

  restorePos_({ pos, bitPos }: { pos: number; bitPos: number }): void {
    this.#pos = pos;
    this.#bitPos = bitPos;
  }
}

export { BitReader };
