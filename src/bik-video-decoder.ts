import type { IntRange, TupleOf } from "type-fest";
import {
  BIK_PATTERNS,
  BIK_QUANT,
  BIK_SCAN,
  BIK_TREE_CODES,
  BIK_TREE_LENS,
  RLE_LENGTHS,
} from "./bik-constants.ts";
import { BitReader } from "./bik-decoder-utils.ts";

// // Import defines into the global namespace if the code has not been bundled and we are running
// // in a Worker thread (as expected).
// if (
//   !(import.meta as unknown as Record<string, boolean>).builtInDefines &&
//   typeof WorkerGlobalScope !== "undefined" &&
//   globalThis instanceof WorkerGlobalScope
// ) {
//   await import("./bik-defines.ts");
// }

const EMPTY_UINT8_ARRAY = new Uint8Array();

/**
 * Data structure describing a single decoded video frame. All values (including pixel values) are
 * not used by the decoder for any subsequent processing, so can be used by an application freely.
 */
export interface BikVideoFrame {
  width: number;
  height: number;
  yuv: Uint8Array<ArrayBuffer>;
  lineSize: number[];
}

interface Tree {
  /**
   * Index of the pre-defined variable length code table to use.
   */
  tableNum: IntRange<0, 16>;

  /**
   * Mapping of symbols decoded from the table to final decoded values.
   */
  symbolMap: FixedLenUint8Array<16>;
}

/**
 * Stores an array of values (items) for a parameter used during block decoding for a particular
 * row (video width / block width) of blocks.
 */
interface BlockParamValues {
  len: number;
  tree: Tree;
  items: Uint8Array;
  curDec: number;
  curPtr: number;
}

interface FixedLenInt32Array<T extends number> extends Int32Array {
  length: T;
}
interface FixedLenUint8Array<T extends number> extends Uint8Array {
  length: T;
}

// Plane index maps to: Y, U, V, Alpha
type TPlaneIndex = IntRange<0, 4>;

/**
 * Huffman table implementation for variable length coding.
 *
 * A Huffman table can be used to decode a prefix code in a bit-stream by reading a number of bits
 * from the bit-stream equal to the length of the longest prefix code in the table. A cache is
 * then used to lookup the code and get the actual code length and the decoded symbol.
 */
class HuffTable {
  #symbols: Array<IntRange<0, 16>>[number][];
  #lens: (typeof BIK_TREE_LENS)[number][];
  #maxBits: (typeof BIK_TREE_LENS)[number];

  // When this module is first imported, create all the pre-defined read-only Huffman table
  // structures we will need for Huffman decoding.
  static #predefinedTables: TupleOf<16, HuffTable> = new Array(16)
    .fill(null)
    .map((_, bikTreeIndex) => new HuffTable(bikTreeIndex as IntRange<0, 16>)) as TupleOf<
    16,
    HuffTable
  >;

  constructor(bikTreeIndex: IntRange<0, 16>) {
    const referenceTableOffset = (bikTreeIndex << 4) as IntRange<0, 240, 16>;
    const maxBits = BIK_TREE_LENS[referenceTableOffset + 15] as (typeof BIK_TREE_LENS)[number];

    this.#maxBits = maxBits;
    const tableSize = 1 << maxBits;
    this.#symbols = new Array(tableSize);
    this.#lens = new Array(tableSize);

    for (let i = 0; i < 16; i++) {
      const code = BIK_TREE_CODES[
        referenceTableOffset + (i as IntRange<0, 16>)
      ] as (typeof BIK_TREE_CODES)[number];

      const len = BIK_TREE_LENS[
        referenceTableOffset + (i as IntRange<0, 16>)
      ] as (typeof BIK_TREE_LENS)[number];

      const numEntries = 1 << (maxBits - len);

      for (let j = 0; j < numEntries; j++) {
        const index = (j << len) | code;
        if (index < tableSize) {
          this.#symbols[index] = i as IntRange<0, 16>;
          this.#lens[index] = len;
        }
      }
    }
  }

  #decode(reader: BitReader): IntRange<0, 16> {
    // Peek at the bits
    const savedPos = reader.savePos_();
    const peek = reader.readBits_(this.#maxBits);
    reader.restorePos_(savedPos);

    const len = this.#lens[peek] ?? 0;
    const symbol = this.#symbols[peek];

    if (typeof symbol === "undefined") {
      throw new Error(`HuffTable decode error: invalid code ${peek}`);
    }

    reader.skip_(len);
    return symbol;
  }

  /**
   * Decode the next Huffman symbol in a bit-stream.
   * @param reader Bit-stream to read from.
   * @param tree Huffman tree to use for decoding.
   * @returns 4-bit value, Huffman-decoded from the bit-stream.
   */
  static getHuff(reader: BitReader, tree: Tree): IntRange<0, 16> {
    const symbol = HuffTable.#predefinedTables[tree.tableNum].#decode(reader);
    return (tree.symbolMap[symbol] ?? 0) as IntRange<0, 16>;
  }
}

export class BikVideoDecoder {
  // Information from the video header
  // ---------------------------------
  #width: number;
  #height: number;
  #version: number;
  #hasAlpha: boolean;
  #hasSwappedUVPlanes: boolean;

  // Calculated from the video header information
  #numPixels: number;
  #uvSize: number;

  // Frame decode state
  // ------------------

  // Decoded data from the previous frame (for inter-frame decompression)
  #prevFrame = EMPTY_UINT8_ARRAY;

  // Coordinates of the current block (in number of blocks)
  #blockXPos = 0;
  #blockYPos = 0;

  // Value to add to a pointer to the data buffer to get to the same X position on the next line
  #stride = 0;

  // Output data buffer for all planes in the current frame
  #data = EMPTY_UINT8_ARRAY;

  // Output data buffer for all planes in the previous frame
  #prevData = EMPTY_UINT8_ARRAY;

  // Current write position in the output data buffer
  #dataPtr = 0;

  // Input bit-stream for the current frame
  #reader = new BitReader(EMPTY_UINT8_ARRAY);

  #blockParams = new Array<BlockParamValues>(NUM_BLOCK_PARAMS) as TupleOf<
    typeof NUM_BLOCK_PARAMS,
    BlockParamValues
  >;
  #colHigh = new Array(16) as TupleOf<16, Tree>;
  #colLastValue = 0;

  // Re-usable buffers
  // -----------------
  // Reduce garbage collection when decoding multiple frames.
  #inputTreeBuf = new Uint8Array(16) as FixedLenUint8Array<16>;
  #outputTreeBuf = new Uint8Array(16) as FixedLenUint8Array<16>;
  #tmpCoeffIndex = new Int32Array(64) as FixedLenInt32Array<64>;
  #tmpCoeffList = new Int32Array(128) as FixedLenInt32Array<128>;
  #tmpModeList = new Int32Array(128) as FixedLenInt32Array<128>;
  #tmpScalingBuf = new Uint8Array(64) as FixedLenUint8Array<64>;
  #tmpDCTBlockBuf = new Int32Array(64) as FixedLenInt32Array<64>;
  #tmpDCTBuf = new Int32Array(64) as FixedLenInt32Array<64>;

  constructor(
    width: number,
    height: number,
    version: number,
    hasAlpha: boolean,
    hasSwappedUVPlanes: boolean,
  ) {
    this.#width = width;
    this.#height = height;
    this.#version = version;
    this.#hasAlpha = hasAlpha;
    this.#hasSwappedUVPlanes = hasSwappedUVPlanes;

    const numPixels = width * height;
    const uvSize = numPixels >>> 2;
    const frameSize = (numPixels << (hasAlpha ? 1 : 0)) + (uvSize << 1);

    this.#numPixels = numPixels;
    this.#uvSize = uvSize;
    this.#prevFrame = new Uint8Array(frameSize);

    const blocks = (numPixels + 63) >>> 6;
    for (let i = 0; i < NUM_BLOCK_PARAMS; i++) {
      (this.#blockParams[i as IntRange<0, typeof NUM_BLOCK_PARAMS>] as BlockParamValues) = {
        len: 0,
        tree: { tableNum: 0, symbolMap: new Uint8Array(16) as FixedLenUint8Array<16> },
        items: new Uint8Array(blocks * 64),
        curDec: 0,
        curPtr: 0,
      };
    }

    for (let i = 0; i < 16; i++) {
      this.#colHigh[i as IntRange<0, 16>] = {
        tableNum: 0,
        symbolMap: new Uint8Array(16) as FixedLenUint8Array<16>,
      };
    }
  }

  decodeFrame(
    data: Uint8Array | Uint8Array,
    existingFrame: BikVideoFrame | null = null,
  ): BikVideoFrame {
    const reader = this.#reader;
    reader.reset_(data);
    const frame = existingFrame ?? this.#createFrame();

    if (this.#hasAlpha) {
      if (this.#version >= 105) {
        reader.skip_(32);
      }
      this.#decodePlane(frame, 3);
    }

    if (this.#version >= 105) {
      reader.skip_(32);
    }

    for (let plane = 0; plane < 3; plane++) {
      const planeIndex = (plane && this.#hasSwappedUVPlanes ? plane ^ 3 : plane) as TPlaneIndex;
      this.#decodePlane(frame, planeIndex);
      if (reader.bitsLeft_() <= 0) break;
    }

    // Store a copy of the YUVA planes for frame-relative decoding with the next frame.
    this.#prevFrame.set(frame.yuv);
    this.#data = EMPTY_UINT8_ARRAY;
    this.#reader.reset_(EMPTY_UINT8_ARRAY);

    return frame;
  }

  #createFrame(): BikVideoFrame {
    const numPixels = this.#width * this.#height;
    const uvSize = numPixels >>> 2;
    return {
      width: this.#width,
      height: this.#height,
      yuv: new Uint8Array((numPixels << (this.#hasAlpha ? 1 : 0)) + (uvSize << 1)),
      lineSize: [this.#width, this.#width >>> 1, this.#width >>> 1, this.#width],
    };
  }

  #decodePlane(frame: BikVideoFrame, planeIndex: TPlaneIndex) {
    const blockParams = this.#blockParams;
    const width = this.#width;
    const height = this.#height;
    const numPixels = this.#numPixels;
    const uvSize = this.#uvSize;

    const isChroma = planeIndex === 1 || planeIndex === 2;
    const planeWidth = isChroma ? Math.ceil(width / 2) : width;
    const blockWidth = isChroma ? Math.ceil(width / 16) : Math.ceil(width / 8);
    const blockHeight = isChroma ? Math.ceil(height / 16) : Math.ceil(height / 8);

    this.#readPlaneTrees(planeWidth, blockWidth);

    const planeOffset =
      planeIndex === 0
        ? 0
        : planeIndex === 1
          ? numPixels
          : planeIndex === 2
            ? numPixels + uvSize
            : numPixels + (uvSize << 1);

    this.#stride = frame.lineSize[planeIndex] ?? 0;
    this.#data = frame.yuv;
    this.#prevData = this.#prevFrame;
    this.#dataPtr = planeOffset;

    const blockLineIncr = this.#stride * 7;

    for (this.#blockYPos = 0; this.#blockYPos < blockHeight; this.#blockYPos++) {
      this.#readBlockTypes(blockParams[BIK_PARAM_BLOCK_TYPES]);
      this.#readBlockTypes(blockParams[BIK_PARAM_SUB_BLOCK_TYPES]);
      this.#readColors(blockParams[BIK_PARAM_COLORS]);
      this.#readPatterns(blockParams[BIK_PARAM_PATTERN]);
      this.#readMotionValues(blockParams[BIK_PARAM_X_OFF]);
      this.#readMotionValues(blockParams[BIK_PARAM_Y_OFF]);
      this.#readDCs(blockParams[BIK_PARAM_INTRA_DC], false);
      this.#readDCs(blockParams[BIK_PARAM_INTER_DC], true);
      this.#readRuns(blockParams[BIK_PARAM_RUN]);

      for (this.#blockXPos = 0; this.#blockXPos < blockWidth; this.#blockXPos++) {
        const blockType = this.#getValue(BIK_PARAM_BLOCK_TYPES);

        switch (blockType) {
          case BIK_BLOCK_TYPE_SKIP:
            this.#copyBlock(this.#dataPtr);
            break;
          case BIK_BLOCK_TYPE_SCALED:
            this.#decodeScaledBlock();
            this.#dataPtr += 8;
            break;
          case BIK_BLOCK_TYPE_MOTION:
            this.#decodeMotionBlock();
            break;
          case BIK_BLOCK_TYPE_RUN:
            this.#decodeRunBlock(this.#data, this.#dataPtr, this.#stride);
            break;
          case BIK_BLOCK_TYPE_RESIDUE:
            this.#decodeResidueBlock();
            break;
          case BIK_BLOCK_TYPE_INTRA:
            this.#decodeIntraBlock(this.#data, this.#dataPtr, this.#stride);
            break;
          case BIK_BLOCK_TYPE_FILL:
            this.#decodeFillBlock();
            break;
          case BIK_BLOCK_TYPE_INTER:
            this.#decodeInterBlock();
            break;
          case BIK_BLOCK_TYPE_PATTERN:
            this.#decodePatternBlock(this.#data, this.#dataPtr, this.#stride);
            break;
          case BIK_BLOCK_TYPE_RAW:
            this.#decodeRawBlock();
            break;
          default:
            throw new Error(`Unrecognised block type ${blockType}`);
        }

        this.#dataPtr += 8;
      }

      this.#dataPtr += blockLineIncr;
    }

    this.#reader.align32_();
  }

  #copyBlock(srcOffset: number) {
    let blockStride = 0;
    for (let y = 0; y < 8; y++) {
      const destIndex = this.#dataPtr + blockStride;
      const srcIndex = srcOffset + blockStride;
      for (let x = 0; x < 8; x++) {
        this.#data[destIndex + x] = this.#prevData[srcIndex + x] ?? 0;
      }
      blockStride += this.#stride;
    }
  }

  #decodeMotionBlock() {
    const xOffset = this.#getValue(BIK_PARAM_X_OFF);
    const yOffset = this.#getValue(BIK_PARAM_Y_OFF);
    const ref = this.#dataPtr + xOffset + yOffset * this.#stride;
    this.#copyBlock(ref);
  }

  #decodeRunBlock(block: Uint8Array, offset = 0, stride = 8) {
    let i = 0;
    let scanIndex = this.#reader.readBits_(4) << 6;

    do {
      const run = this.#getValue(BIK_PARAM_RUN) + 1;
      i += run;

      if (this.#reader.readBit_()) {
        // Decode a run of a single color
        const v = this.#getValue(BIK_PARAM_COLORS);
        for (let j = 0; j < run; j++) {
          const pos = BIK_PATTERNS[scanIndex++] ?? 0;
          block[offset + (pos >>> 3) * stride + (pos & 7)] = v;
        }
      } else {
        // Decode a sequence of colors
        for (let j = 0; j < run; j++) {
          const pos = BIK_PATTERNS[scanIndex++] ?? 0;
          block[offset + (pos >>> 3) * stride + (pos & 7)] = this.#getValue(BIK_PARAM_COLORS);
        }
      }
    } while (i < 63);

    if (i === 63) {
      // Decode one more pixel in the block
      const pos = BIK_PATTERNS[scanIndex] ?? 0;
      block[offset + (pos >>> 3) * stride + (pos & 7)] = this.#getValue(BIK_PARAM_COLORS);
    }
  }

  #decodeResidueBlock() {
    const xOffset = this.#getValue(BIK_PARAM_X_OFF);
    const yOffset = this.#getValue(BIK_PARAM_Y_OFF);
    const ref = this.#dataPtr + xOffset + yOffset * this.#stride;
    this.#copyBlock(ref);

    const block = this.#tmpDCTBuf;
    block.fill(0);
    this.#readCoeffsOrResidue(block);
    this.#addPixels8x8(block, this.#data, this.#dataPtr, this.#stride);
  }

  #decodeIntraBlock(block: Uint8Array, offset = 0, stride = 8) {
    const dctBlock = this.#tmpDCTBlockBuf;
    dctBlock.fill(0, 1);
    dctBlock[0] = this.#getValue(BIK_PARAM_INTRA_DC);
    this.#readCoeffsOrResidue(dctBlock, 0);
    this.#idctPut(dctBlock, block, offset, stride);
  }

  #decodeFillBlock(size = 8) {
    const v = this.#getValue(BIK_PARAM_COLORS);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        this.#data[this.#dataPtr + y * this.#stride + x] = v;
      }
    }
  }

  #decodeInterBlock() {
    const xOffset = this.#getValue(BIK_PARAM_X_OFF);
    const yOffset = this.#getValue(BIK_PARAM_Y_OFF);
    const ref = this.#dataPtr + xOffset + yOffset * this.#stride;
    this.#copyBlock(ref);

    const dctBlock = this.#tmpDCTBlockBuf;
    dctBlock.fill(0, 1);
    dctBlock[0] = this.#getValue(BIK_PARAM_INTER_DC);
    this.#readCoeffsOrResidue(dctBlock, 1024);
    this.#idctAdd(dctBlock, this.#data, this.#dataPtr, this.#stride);
  }

  #decodePatternBlock(block: Uint8Array, offset = 0, stride = 8) {
    const col: TupleOf<2, number> = [
      this.#getValue(BIK_PARAM_COLORS),
      this.#getValue(BIK_PARAM_COLORS),
    ];
    for (let i = 0; i < 8; i++) {
      let v = this.#getValue(BIK_PARAM_PATTERN);
      for (let j = 0; j < 8; j++) {
        block[offset + i * stride + j] = col[(v & 1) as IntRange<0, 2>];
        v >>= 1;
      }
    }
  }

  #decodeRawBlock() {
    const blockParamValues = this.#blockParams[BIK_PARAM_COLORS];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        this.#data[this.#dataPtr + i * this.#stride + j] =
          blockParamValues.items[blockParamValues.curPtr++] ?? 0;
      }
    }
  }

  #decodeScaledBlock() {
    this.#blockXPos++;

    // Jump over 16x16 blocks on odd-numbered lines as they are part of a 16x16 block that has
    // already been decoded on the previous (even-numbered) line.
    if (this.#blockYPos & 1) {
      return;
    }

    const tmpScalingBuf = this.#tmpScalingBuf;
    const subBlk = this.#getValue(BIK_PARAM_SUB_BLOCK_TYPES);

    switch (subBlk) {
      case BIK_BLOCK_TYPE_RUN:
        this.#decodeRunBlock(tmpScalingBuf);
        break;
      case BIK_BLOCK_TYPE_INTRA:
        this.#decodeIntraBlock(tmpScalingBuf);
        break;
      case BIK_BLOCK_TYPE_FILL: {
        this.#decodeFillBlock(16);
        return;
      }
      case BIK_BLOCK_TYPE_PATTERN:
        this.#decodePatternBlock(tmpScalingBuf);
        break;
      case BIK_BLOCK_TYPE_RAW: {
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            tmpScalingBuf[i + (j << 3)] = this.#getValue(BIK_PARAM_COLORS);
          }
        }
        break;
      }
      default:
        throw new Error(`Unrecognised sub-block type ${subBlk}`);
    }

    // Copy 8x8 result to the destination buffer, enlarging it to 16x16 in the process
    const dest = this.#data;
    let srcPos = 0;
    let destPosLine0 = this.#dataPtr;
    let destPosLine1 = this.#dataPtr + this.#stride;
    const lineIncrement = this.#stride << 1;
    for (let j = 0; j < 8; j++) {
      let halfWordOffset = 0;
      for (let i = 0; i < 8; i++) {
        const v = tmpScalingBuf[srcPos++] ?? 0;
        dest[destPosLine0 + halfWordOffset] = v;
        dest[destPosLine1 + halfWordOffset++] = v;
        dest[destPosLine0 + halfWordOffset] = v;
        dest[destPosLine1 + halfWordOffset++] = v;
      }
      destPosLine0 += lineIncrement;
      destPosLine1 += lineIncrement;
    }
  }

  #readTree(tree: Tree) {
    const reader = this.#reader;

    tree.tableNum = reader.readBits_(4) as IntRange<0, 16>;
    if (!tree.tableNum) {
      // Linear symbol mapping
      for (let i = 0; i < 16; i++) {
        tree.symbolMap[i] = i;
      }
      return;
    }

    if (reader.readBit_()) {
      // Read the order of symbols from the bit-stream
      let len = reader.readBits_(3);
      const tmp = this.#inputTreeBuf.fill(0);

      for (let i = 0; i <= len; i++) {
        tree.symbolMap[i] = reader.readBits_(4);
        tmp[tree.symbolMap[i] ?? 0] = 1;
      }

      for (let i = 0; i < 16; i++) {
        if (!tmp[i]) {
          tree.symbolMap[++len] = i;
        }
      }
    } else {
      // Shuffle the symbols
      const len = reader.readBits_(2);
      let input = this.#inputTreeBuf;
      let output = this.#outputTreeBuf;

      for (let i = 0; i < 16; i++) {
        input[i] = i;
      }

      for (let i = 0; i <= len; i++) {
        const size = 1 << i;
        for (let t = 0; t < 16; t += size << 1) {
          this.#mergeTreeData(output, input, t, size);
        }
        [input, output] = [output, input];
      }

      tree.symbolMap.set(input);
    }

    return;
  }

  #mergeTreeData(dest: Uint8Array, src: Uint8Array, offset: number, size: number) {
    let src1Index = offset;
    let src2Index = offset + size;
    let size1 = size;
    let size2 = size;
    let destIndex = offset;

    while (size1 && size2) {
      if (!this.#reader.readBit_()) {
        dest[destIndex++] = src[src1Index++] ?? 0;
        size1--;
      } else {
        dest[destIndex++] = src[src2Index++] ?? 0;
        size2--;
      }
    }

    while (size1--) {
      dest[destIndex++] = src[src1Index++] ?? 0;
    }
    while (size2--) {
      dest[destIndex++] = src[src2Index++] ?? 0;
    }
  }

  #setBlockParamValuesLen(blockParamNum: IntRange<0, typeof NUM_BLOCK_PARAMS>, rawValue: number) {
    this.#blockParams[blockParamNum].len = ~~Math.log2(rawValue) + 1;
  }

  /**
   * Read Huffman trees for each block type in the current plane.
   * @param adjustedWidth
   */
  #readPlaneTrees(width: number, blockWidth: number) {
    const adjustedWidth = (width + 7) & ~7;

    // Initialize number of bits used to specify the number of coded entries for each block
    // parameter type in each row.
    this.#setBlockParamValuesLen(BIK_PARAM_SUB_BLOCK_TYPES, (adjustedWidth >>> 4) + 511);
    this.#setBlockParamValuesLen(BIK_PARAM_COLORS, blockWidth * 64 + 511);
    const commonLen = (adjustedWidth >>> 3) + 511;
    this.#setBlockParamValuesLen(BIK_PARAM_BLOCK_TYPES, commonLen);
    this.#setBlockParamValuesLen(BIK_PARAM_X_OFF, commonLen);
    this.#setBlockParamValuesLen(BIK_PARAM_Y_OFF, commonLen);
    this.#setBlockParamValuesLen(BIK_PARAM_INTRA_DC, commonLen);
    this.#setBlockParamValuesLen(BIK_PARAM_INTER_DC, commonLen);
    this.#setBlockParamValuesLen(BIK_PARAM_PATTERN, (blockWidth << 3) + 511);
    this.#setBlockParamValuesLen(BIK_PARAM_RUN, blockWidth * 48 + 511);

    for (const [blockParamNum, blockParamValues] of this.#blockParams.entries()) {
      if (blockParamNum === BIK_PARAM_COLORS) {
        for (let i = 0; i < 16; i++) {
          this.#readTree(this.#colHigh[i as IntRange<0, 16>]);
        }
        this.#colLastValue = 0;
      }

      if (blockParamNum !== BIK_PARAM_INTRA_DC && blockParamNum !== BIK_PARAM_INTER_DC) {
        this.#readTree(blockParamValues.tree);
      }

      blockParamValues.curDec = 0;
      blockParamValues.curPtr = 0;
    }
  }

  #readCodedDataCount(blockParamValues: BlockParamValues): number {
    if (blockParamValues.curDec < 0 || blockParamValues.curDec > blockParamValues.curPtr) {
      return 0;
    }
    const count = this.#reader.readBits_(blockParamValues.len);
    if (count === 0) {
      blockParamValues.curDec = -1;
    }
    return count;
  }

  #readBlockTypes(blockParamValues: BlockParamValues) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    if (reader.readBit_()) {
      const v = reader.readBits_(4);
      for (let i = 0; i < count; i++) {
        blockParamValues.items[blockParamValues.curDec++] = v;
      }
    } else {
      let prevValue: IntRange<0, 12> = 0;
      for (let i = 0; i < count; i++) {
        const v = HuffTable.getHuff(reader, blockParamValues.tree);
        if (v < 12) {
          prevValue = v as IntRange<0, 12>;
          blockParamValues.items[blockParamValues.curDec++] = v as IntRange<0, 12>;
        } else {
          const runLength = RLE_LENGTHS[(v - 12) as IntRange<0, 4>];
          for (let j = 0; j < runLength; j++) {
            blockParamValues.items[blockParamValues.curDec++] = prevValue;
          }
          i += runLength - 1;
        }
      }
    }
  }

  #readColors(blockParamValues: BlockParamValues) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    const isRun = !!reader.readBit_();
    let loopCount = isRun ? 1 : count;
    do {
      const colHighValue = HuffTable.getHuff(reader, this.#colHigh[this.#colLastValue] as Tree);
      let v = (HuffTable.getHuff(reader, blockParamValues.tree) | (colHighValue << 4)) as IntRange<
        0,
        256
      >;
      this.#colLastValue = colHighValue;

      if (this.#version < 105) {
        const sign = v & 0x80 ? 0xff : 0;
        v = ((v & 0x7f) ^ sign) - sign;
        v += 0x80;
      }

      if (isRun) {
        blockParamValues.items.fill(v, blockParamValues.curDec, blockParamValues.curDec + count);
        blockParamValues.curDec += count;
      } else {
        blockParamValues.items[blockParamValues.curDec++] = v;
      }
    } while (--loopCount);
  }

  #readPatterns(blockParamValues: BlockParamValues) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    for (let i = 0; i < count; i++) {
      const v =
        HuffTable.getHuff(reader, blockParamValues.tree) |
        (HuffTable.getHuff(reader, blockParamValues.tree) << 4);
      blockParamValues.items[blockParamValues.curDec++] = v;
    }
  }

  #readMotionValues(blockParamValues: BlockParamValues) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    if (reader.readBit_()) {
      let v = reader.readBits_(4);
      if (v) {
        v = reader.applySign_(v);
      }

      for (let i = 0; i < count; i++) {
        blockParamValues.items[blockParamValues.curDec++] = v & 0xff;
      }
    } else {
      for (let i = 0; i < count; i++) {
        let v: number = HuffTable.getHuff(reader, blockParamValues.tree);
        if (v) {
          v = reader.applySign_(v);
        }
        blockParamValues.items[blockParamValues.curDec++] = v & 0xff;
      }
    }
  }

  #readDCs(blockParamValues: BlockParamValues, hasSign: boolean) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    const view = new DataView(
      blockParamValues.items.buffer,
      blockParamValues.items.byteOffset,
      blockParamValues.items.byteLength,
    );

    let v = reader.readBits_(hasSign ? 10 : 11);
    if (v && hasSign) {
      v = reader.applySign_(v);
    }

    view.setInt16(blockParamValues.curDec, v, true);
    blockParamValues.curDec += 2;

    for (let i = 1; i < count; ) {
      const len = Math.min(count - i, 8);
      const bsize = reader.readBits_(4);

      if (bsize) {
        for (let j = 0; j < len; j++) {
          let v2 = reader.readBits_(bsize);
          if (v2) {
            v2 = reader.applySign_(v2);
          }
          v += v2;
          view.setInt16(blockParamValues.curDec, v, true);
          blockParamValues.curDec += 2;
        }
      } else {
        for (let j = 0; j < len; j++) {
          view.setInt16(blockParamValues.curDec, v, true);
          blockParamValues.curDec += 2;
        }
      }

      i += len;
    }
  }

  #readRuns(blockParamValues: BlockParamValues) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    if (reader.readBit_()) {
      const v = reader.readBits_(4);
      for (let i = 0; i < count; i++) {
        blockParamValues.items[blockParamValues.curDec++] = v;
      }
    } else {
      for (let i = 0; i < count; i++) {
        blockParamValues.items[blockParamValues.curDec++] = HuffTable.getHuff(
          reader,
          blockParamValues.tree,
        );
      }
    }
  }

  /**
   * Get the next block parameter value for the current line.
   * @param blockParamNum Index of the block parameter.
   * @returns Next value for the block parameter.
   */
  #getValue(blockParamNum: IntRange<0, typeof NUM_BLOCK_PARAMS>): number {
    const blockParamValues = this.#blockParams[blockParamNum];

    if (blockParamNum < BIK_PARAM_X_OFF || blockParamNum === BIK_PARAM_RUN) {
      return blockParamValues.items[blockParamValues.curPtr++] ?? 0;
    }
    if (blockParamNum < BIK_PARAM_INTRA_DC) {
      return ((blockParamValues.items[blockParamValues.curPtr++] ?? 0) << 24) >> 24; // sign extend the byte
    }
    const view = new DataView(
      blockParamValues.items.buffer,
      blockParamValues.items.byteOffset,
      blockParamValues.items.byteLength,
    );
    const val = view.getInt16(blockParamValues.curPtr, true);
    blockParamValues.curPtr += 2;
    return val;
  }

  /**
   * Mini-VM (virtual machine) to decode and optionally unquantize a block of integer values.
   * Updates the block in-place with the decoded/unquantized values.
   *
   * Block is decoded as a "residue" block of small values when to quantization table is
   * supplied, otherwise the block is decoded and unquantized to DCT coefficients.
   * @param block Block to decode/unquantize (updated in-place).
   * @param quant Quantization lookup table to use.
   */
  #readCoeffsOrResidue(block: Int32Array, quantStartIndex: number = -1) {
    const isResidue = quantStartIndex < 0;
    const reader = this.#reader;
    const coeffIndex = this.#tmpCoeffIndex; // not actually coefficients for "residue" blocks
    const coeffList = this.#tmpCoeffList;
    const modeList = this.#tmpModeList;
    let listStart = 64;
    let listEnd = 70;
    let masksCount = 0;
    let coeffCount = 0;

    coeffList.set([4, 24, 44], 64);
    modeList.set([0, 0, 0], 64);
    if (isResidue) {
      listEnd = 68;
      masksCount = this.#reader.readBits_(7);
      coeffList[67] = 0;
      modeList[67] = 2;
    } else {
      coeffList.set([1, 2, 3], 67);
      modeList.set([3, 3, 3], 67);
    }

    // bit count for DCT coeffs; bit mask for residue
    let bits = isResidue ? 1 << reader.readBits_(3) : reader.readBits_(4) - 1;

    while (isResidue ? bits : bits >= 0) {
      if (isResidue) {
        for (let i = 0; i < coeffCount; i++) {
          if (!reader.readBit_()) continue;

          const curNzCoeff = coeffIndex[i] ?? 0;
          if ((block[curNzCoeff] ?? 0) < 0) {
            (block[curNzCoeff] as number) -= bits;
          } else {
            (block[curNzCoeff] as number) += bits;
          }

          if (!masksCount--) {
            return;
          }
        }
      }

      let listPos = listStart;

      while (listPos < listEnd) {
        let ccoeff = coeffList[listPos] ?? 0;
        const mode = modeList[listPos] ?? 0;
        if (!(mode | ccoeff) || !reader.readBit_()) {
          listPos++;
          continue;
        }

        switch (mode) {
          case 0:
          case 2: {
            if (mode === 0) {
              coeffList[listPos] = ccoeff + 4;
              modeList[listPos] = 1;
            } else {
              coeffList[listPos] = 0;
              modeList[listPos++] = 0;
            }

            for (let i = 0; i < 4; i++, ccoeff++) {
              if (reader.readBit_()) {
                coeffList[--listStart] = ccoeff;
                modeList[listStart] = 3;
              } else {
                if (isResidue) {
                  const offset = BIK_SCAN[ccoeff] ?? 0;
                  coeffIndex[coeffCount++] = offset;
                  block[offset] = reader.applySign_(bits);
                  if (!masksCount--) {
                    return;
                  }
                } else {
                  const offset = bits
                    ? reader.applySign_(reader.readBits_(bits) | (1 << bits))
                    : 1 - (reader.readBit_() << 1);
                  block[BIK_SCAN[ccoeff] ?? 0] = offset;
                  coeffIndex[coeffCount++] = ccoeff;
                }
              }
            }
            break;
          }

          case 1: {
            modeList[listPos] = 2;
            for (let i = 0; i < 3; i++) {
              ccoeff += 4;
              coeffList[listEnd] = ccoeff;
              modeList[listEnd++] = 2;
            }
            break;
          }

          case 3: {
            coeffList[listPos] = 0;
            modeList[listPos++] = 0;
            if (isResidue) {
              const offset = BIK_SCAN[ccoeff] ?? 0;
              coeffIndex[coeffCount++] = offset;
              block[offset] = reader.applySign_(bits);
              if (!masksCount--) {
                return;
              }
            } else {
              const offset = bits
                ? reader.applySign_(reader.readBits_(bits) | (1 << bits))
                : 1 - (reader.readBit_() << 1);
              block[BIK_SCAN[ccoeff] ?? 0] = offset;
              coeffIndex[coeffCount++] = ccoeff;
            }
            break;
          }
        }
      }

      bits = isResidue ? bits >>> 1 : bits - 1;
    }

    if (isResidue) {
      return;
    }
    const quantIndex = reader.readBits_(4);
    const quantOffset = (quantIndex << 6) + quantStartIndex;
    block[0] = ((block[0] ?? 0) * (BIK_QUANT[quantOffset] ?? 0)) >> 11;
    for (let i = 0; i < coeffCount; i++) {
      const index = coeffIndex[i] ?? 0;
      block[BIK_SCAN[index] ?? 0] =
        ((block[BIK_SCAN[index] ?? 0] ?? 0) * (BIK_QUANT[quantOffset + index] ?? 0)) >> 11;
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
  #idct(
    src: Int32Array,
    srcOffset: number,
    dest: Uint8Array | Int32Array,
    destOffset: number,
    column: boolean,
  ) {
    const indexShift = column ? 3 : 0;
    const constantToAdd = column ? 0 : 0x7f;
    const destShift = column ? 0 : 8;

    const x0 = src[srcOffset] ?? 0;
    const x1 = src[srcOffset + (1 << indexShift)] ?? 0;
    const x2 = src[srcOffset + (2 << indexShift)] ?? 0;
    const x3 = src[srcOffset + (3 << indexShift)] ?? 0;
    const x4 = src[srcOffset + (4 << indexShift)] ?? 0;
    const x5 = src[srcOffset + (5 << indexShift)] ?? 0;
    const x6 = src[srcOffset + (6 << indexShift)] ?? 0;
    const x7 = src[srcOffset + (7 << indexShift)] ?? 0;

    const a0 = x0 + x4;
    const a1 = x0 - x4;
    const a2 = x2 + x6;
    const a3 = (DCT_C0 * (x2 - x6)) >> 11;
    const a4 = x5 + x3;
    const a5 = x5 - x3;
    const a6 = x1 + x7;
    const a7 = x1 - x7;

    const a0c = a0 + constantToAdd;
    const a1c = a1 + constantToAdd;

    const b0 = a4 + a6;
    const b1 = (DCT_C2 * (a5 + a7)) >> 11;
    const b2 = ((DCT_C3 * a5) >> 11) - b0 + b1;
    const b3 = ((DCT_C0 * (a6 - a4)) >> 11) - b2;
    const b4 = ((DCT_C1 * a7) >> 11) + b3 - b1;

    dest[destOffset] = (a0c + a2 + b0) >> destShift;
    dest[destOffset + (1 << indexShift)] = (a1c + a3 - a2 + b2) >> destShift;
    dest[destOffset + (2 << indexShift)] = (a1c - a3 + a2 + b3) >> destShift;
    dest[destOffset + (3 << indexShift)] = (a0c - a2 - b4) >> destShift;
    dest[destOffset + (4 << indexShift)] = (a0c - a2 + b4) >> destShift;
    dest[destOffset + (5 << indexShift)] = (a1c - a3 + a2 - b3) >> destShift;
    dest[destOffset + (6 << indexShift)] = (a1c + a3 - a2 - b2) >> destShift;
    dest[destOffset + (7 << indexShift)] = (a0c + a2 - b0) >> destShift;
  }

  /**
   * 2D DCT-III (inverse of DCT-II, sometimes just called IDCT).
   *
   * Fast approximation using signed integers. Optimized for 8x8 element blocks.
   * Based on the Arai-Agui-Nakajima (AAN) algorithm.
   *
   * Runs the 1D variant on each column and row of th
   * @param block Input buffer containing the 64 (8x8) coefficients to transform.
   * @param dest Output buffer to write the result of the transformation to.
   * @param destOffset Offset in the output buffer to write the output of the transformation to.
   * @param stride Amount to add to `destOffset` to get the next block row in the output
   *   buffer.
   */
  #idctPut(block: Int32Array, dest: Uint8Array, destOffset: number, stride: number) {
    const tmp = this.#tmpDCTBuf;

    for (let i = 0; i < 8; i++) {
      this.#idct(block, i, tmp, i, true);
    }

    for (let i = 0; i < 8; i++) {
      this.#idct(tmp, i * 8, dest, destOffset + i * stride, false);
    }
  }

  /**
   * Variant of {@link #idctPut} that adds the result of the transformation to the values in the
   * output buffer instead of overwriting them.
   */
  #idctAdd(block: Int32Array, dest: Uint8Array, destOffset: number, stride: number) {
    const tmp = this.#tmpDCTBuf;

    for (let i = 0; i < 8; i++) {
      this.#idct(block, i, tmp, i, true);
    }

    for (let i = 0; i < 8; i++) {
      this.#idct(tmp, i * 8, block, i * 8, false);
    }

    this.#addPixels8x8(block, dest, destOffset, stride);
  }

  #addPixels8x8(block: Int32Array, dest: Uint8Array, destOffset: number, stride: number) {
    let destPos = destOffset;
    let blockPos = 0;

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        dest[destPos + j] = (dest[destPos + j] ?? 0) + (block[blockPos++] ?? 0);
      }
      destPos += stride;
    }
  }
}
