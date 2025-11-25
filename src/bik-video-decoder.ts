/**
 * Module holding video decoding logic for the BIK decoder.
 */

import type { FixedLengthArray, IntRange, Simplify, TupleOf } from "type-fest";
import {
  BIK_PATTERNS,
  BIK_QUANT,
  BIK_SCAN,
  BIK_TREE_CODES,
  BIK_TREE_LENS,
  RLE_LENGTHS,
} from "./bik-constants.ts";
import { BitReader } from "./bik-decoder-utils.ts";

const EMPTY_UINT8_ARRAY = new Uint8Array();

/**
 * Data structure describing a single decoded video frame. All values (including pixel values) are
 * not used by the decoder for any subsequent processing, so can be used by an application freely.
 */
export interface BikVideoFrame {
  /**
   * Coded width of the video frame (in pixels).
   */
  width: number;

  /**
   * Coded height of the video frame (in pixels).
   */
  height: number;

  /**
   * Pixel data for the video frame, encoded in Planar YUV 4:2:0 format with an optional alpha
   * channel. The planes are stored in the order: Y, U, V, alpha. Each of the Y and alpha planes
   * occupy 4 times as much space in the buffer as either the U or V plane (as would be expected
   * given the encoding format), and the total buffer size is set to be just enough to hold all
   * of the planes.
   */
  yuv: Uint8Array<ArrayBuffer>;

  /**
   * The number of pixels per line of the video frame, stored as an array of per-plane values in
   * the order: Y, U, V, alpha.
   */
  lineSize: number[];
}

interface Tree {
  /**
   * Index of the pre-defined variable length coding table to use.
   */
  table_: HuffTable;

  /**
   * Mapping of symbols decoded from the table to final decoded values.
   */
  symbolMap_: FixedLenUint8Array<16>;
}

/**
 * Stores an array of values (items) for a parameter used during block decoding. Each entry in
 * the array represents a decoded value for that parameter, stored in the order that the decoder
 * should read them.
 */
interface BlockParamValues {
  len_: number;
  tree_: Tree;
  items_: Uint8Array | Int16Array;
  curDec_: number;
  curPtr_: number;
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
 * A Huffman table can be used to decode a prefix code in a bit-stream by reading ahead
 * ("peeking at") a number of bits from the bit-stream equal to the length of the longest
 * prefix code in the table. A cache is then used to lookup the code and get the actual code
 * length and the decoded symbol.
 */
class HuffTable {
  // Symbols and lengths combined. Most significant 4 bits hold the symbol; least significant
  // 4 bits hold the length.
  #symbolsLens: Uint8Array;
  #maxBits: Simplify<typeof BIK_TREE_LENS>[number];

  // When this module is first imported, create all the pre-defined read-only Huffman table
  // structures we will need for Huffman decoding.
  static predefinedTables_: TupleOf<16, HuffTable> = new Array(16)
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
    this.#symbolsLens = new Uint8Array(tableSize);

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
          this.#symbolsLens[index] = (i << 4) | len;
        }
      }
    }
  }

  /**
   * Decode the next Huffman symbol in a bit-stream.
   * @param reader Bit-stream to read from.
   * @param tree Huffman tree to use for decoding.
   * @returns 4-bit value, Huffman-decoded from the bit-stream.
   */
  static getHuff_(reader: BitReader, tree: Tree): IntRange<0, 16> {
    const table = tree.table_;
    const peek = reader.readBits_(table.#maxBits, true); // peek ahead
    const entry = table.#symbolsLens[peek] as IntRange<0, 256>;
    reader.skip_(entry & 0xf);
    return tree.symbolMap_[entry >>> 4] as IntRange<0, 16>;
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

  // Value to add to a pointer to the data buffer to get to the same X position on the next line
  #stride = 0;

  // Output data buffer for all planes in the current frame
  #data = EMPTY_UINT8_ARRAY;

  // Output data buffer for all planes in the previous frame (for inter-frame decompression)
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
  // To reduce garbage collection when decoding multiple frames.
  #inputTreeBuf = new Uint8Array(16) as FixedLenUint8Array<16>;
  #outputTreeBuf = new Uint8Array(16) as FixedLenUint8Array<16>;
  #tmpCoeffIndex = new Int32Array(64) as FixedLenInt32Array<64>;
  #tmpCoeffList = new Int32Array(128) as FixedLenInt32Array<128>;
  #tmpModeList = new Int32Array(128) as FixedLenInt32Array<128>;
  #tmpScalingBuf = new Uint8Array(64) as FixedLenUint8Array<64>;
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
    const uvSize = ((width + 1) >>> 1) * ((height + 1) >>> 1);
    const frameSize = (numPixels << (hasAlpha ? 1 : 0)) + (uvSize << 1);

    this.#numPixels = numPixels;
    this.#uvSize = uvSize;
    this.#prevData = new Uint8Array(frameSize);

    const blocks = (numPixels + 63) >>> 6;
    const numBlockPixels = blocks << 6;
    for (let i = 0; i < NUM_BLOCK_PARAMS; i++) {
      (this.#blockParams[i as IntRange<0, typeof NUM_BLOCK_PARAMS>] as BlockParamValues) = {
        len_: 0,
        tree_: {
          table_: HuffTable.predefinedTables_[0],
          symbolMap_: new Uint8Array(16) as FixedLenUint8Array<16>,
        },
        items_:
          i > BIK_PARAM_PATTERN && i < BIK_PARAM_RUN
            ? new Int16Array(numBlockPixels)
            : new Uint8Array(numBlockPixels),
        curDec_: 0,
        curPtr_: 0,
      };
    }

    for (let i = 0; i < 16; i++) {
      this.#colHigh[i as IntRange<0, 16>] = {
        table_: HuffTable.predefinedTables_[0],
        symbolMap_: new Uint8Array(16) as FixedLenUint8Array<16>,
      };
    }
  }

  #createFrame(): BikVideoFrame {
    return {
      width: this.#width,
      height: this.#height,
      yuv: new Uint8Array(this.#prevData),
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

    this.#stride = frame.lineSize[planeIndex] ?? 0;
    const planeOffset =
      planeIndex === 0
        ? 0
        : planeIndex === 1
          ? numPixels
          : planeIndex === 2
            ? numPixels + uvSize
            : numPixels + (uvSize << 1);
    const blockLineIncr = this.#stride * 7;

    // Temporarily restrict the size of the data buffers for the current and previous frames to
    // the plane being decoded. Restore the buffers at the end of the function.
    const mainDataBuf = this.#data;
    this.#data = new Uint8Array(mainDataBuf.buffer, planeOffset, isChroma ? uvSize : numPixels);
    this.#dataPtr = 0;
    const prevMainDataBuf = this.#prevData;
    this.#prevData = new Uint8Array(
      prevMainDataBuf.buffer,
      planeOffset,
      isChroma ? uvSize : numPixels,
    );

    // `blockXPos` and `blockYPos` hold the coordinates of the block being processed (in units of
    // number of blocks)
    const blockTypeParam = blockParams[BIK_PARAM_BLOCK_TYPES];
    const blockTypes = blockTypeParam.items_;
    let blockYPos = 0;
    while (blockYPos++ < blockHeight) {
      this.#readBlockTypes(blockTypeParam);
      this.#readBlockTypes(blockParams[BIK_PARAM_SUB_BLOCK_TYPES]);
      this.#readColors(blockParams[BIK_PARAM_COLORS]);
      this.#readPatterns(blockParams[BIK_PARAM_PATTERN]);
      this.#readMotionValues(blockParams[BIK_PARAM_X_OFF]);
      this.#readMotionValues(blockParams[BIK_PARAM_Y_OFF]);
      this.#readDCs(blockParams[BIK_PARAM_INTRA_DC], false);
      this.#readDCs(blockParams[BIK_PARAM_INTER_DC], true);
      this.#readRuns(blockParams[BIK_PARAM_RUN]);

      let blockXPos = 0;
      while (blockXPos++ < blockWidth) {
        const blockType = blockTypes[blockTypeParam.curPtr_++];

        switch (blockType) {
          case BIK_BLOCK_TYPE_SKIP:
            // New frame starts as a copy of the previous frame, so no need to copy the data again
            break;
          case BIK_BLOCK_TYPE_SCALED:
            // Jump over a 16x16 block on an odd-numbered line as it's part of a 16x16 block that has
            // already been decoded on the previous (even-numbered) line.
            if (blockYPos & 1) {
              this.#decodeScaledBlock();
            }
            blockXPos++;
            this.#dataPtr += 16;
            continue;
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
            // Unrecognized block type
            throw new Error(`Invalid block type ${blockType}`);
        }

        this.#dataPtr += 8;
      }

      this.#dataPtr += blockLineIncr;
    }

    this.#reader.align32_();
    this.#prevData = prevMainDataBuf;
    this.#data = mainDataBuf;
  }

  #copyBlock(srcOffset: number) {
    // Skip the copy operation if we're copying from the block at the same position in the
    // previous frame, as the new frame starts as a copy of the previously decoded frame so
    // will already have the correct data for this block.
    const indexDiff = this.#dataPtr - srcOffset;
    if (!indexDiff) {
      return;
    }
    const strideMinusBlock = this.#stride - 8;
    let lineCount = 8;
    while (lineCount--) {
      const srcOffsetMax = srcOffset + 8;
      while (srcOffset < srcOffsetMax) {
        this.#data[srcOffset + indexDiff] = this.#prevData[srcOffset] as number;
        srcOffset++;
      }
      srcOffset += strideMinusBlock;
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
    const srcPos = this.#dataPtr + xOffset + yOffset * this.#stride;

    const block = this.#tmpDCTBuf;
    block.fill(0);
    this.#readCoeffsOrResidue(block);

    this.#copyBlock(srcPos);
    this.#addPixels8x8(block, this.#data, this.#dataPtr, this.#stride);
  }

  #decodeIntraBlock(block: Uint8Array, offset = 0, stride = 8) {
    const dctBlock = this.#tmpDCTBuf;
    dctBlock[0] = this.#getValue(BIK_PARAM_INTRA_DC);
    dctBlock.fill(0, 1);
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

    const dctBlock = this.#tmpDCTBuf;
    dctBlock[0] = this.#getValue(BIK_PARAM_INTER_DC);
    dctBlock.fill(0, 1);
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
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        this.#data[this.#dataPtr + y * this.#stride + x] = blockParamValues.items_[
          blockParamValues.curPtr_++
        ] as number;
      }
    }
  }

  #decodeScaledBlock() {
    const tmpScalingBuf = this.#tmpScalingBuf;
    const subBlk = this.#getValue(BIK_PARAM_SUB_BLOCK_TYPES);

    switch (subBlk) {
      case BIK_BLOCK_TYPE_RAW: {
        for (let i = 0; i < 64; i++) {
          tmpScalingBuf[i] = this.#getValue(BIK_PARAM_COLORS);
        }
        break;
      }
      case BIK_BLOCK_TYPE_INTRA:
        this.#decodeIntraBlock(tmpScalingBuf);
        break;
      case BIK_BLOCK_TYPE_FILL: {
        this.#decodeFillBlock(16);
        return;
      }
      case BIK_BLOCK_TYPE_RUN:
        this.#decodeRunBlock(tmpScalingBuf);
        break;
      case BIK_BLOCK_TYPE_PATTERN:
        this.#decodePatternBlock(tmpScalingBuf);
        break;
      default:
        // Unrecognized sub-block type
        throw new Error(`Invalid sub-block type ${subBlk}`);
    }

    // Copy 8x8 result to the destination buffer, enlarging it to 16x16 in the process.
    const dest = this.#data;
    const stride = this.#stride;
    let srcPos = 0;
    let destPosLine = this.#dataPtr;
    const maxDestPosLine = destPosLine + (stride << 4);
    const lineIncrement = (stride << 1) - 15;
    while (destPosLine < maxDestPosLine) {
      const value = tmpScalingBuf[srcPos++] as number;
      dest[destPosLine] = dest[stride + destPosLine++] = value;
      dest[destPosLine] = dest[stride + destPosLine] = value;
      destPosLine += srcPos & 0x7 ? 1 : lineIncrement;
    }
  }

  /**
   * For a tree with a pre-defined Huffman table, rearrange the symbols based on the symbol
   * order information read from the bit-stream.
   * @param tree Huffman tree
   */
  #readTree(tree: Tree): void {
    const reader = this.#reader;

    const tableNum = reader.readBits_(4) as IntRange<0, 16>;
    tree.table_ = HuffTable.predefinedTables_[tableNum];
    if (!tableNum) {
      // Linear symbol mapping for table 0.
      for (let i = 0; i < 16; i++) {
        tree.symbolMap_[i] = i;
      }
      return;
    }

    if (reader.readBit_()) {
      // Read the order of symbols from the bit-stream.
      let len = reader.readBits_(3);
      const tmp = this.#inputTreeBuf.fill(0);

      for (let i = 0; i <= len; i++) {
        tree.symbolMap_[i] = reader.readBits_(4);
        tmp[tree.symbolMap_[i] as number] = 1;
      }

      for (let i = 0; i < 16; i++) {
        if (!tmp[i]) {
          tree.symbolMap_[++len] = i;
        }
      }
    } else {
      // Shuffle the symbols.
      const len = reader.readBits_(2);
      let input = this.#inputTreeBuf;
      let output = this.#outputTreeBuf;

      // First iteration of the shuffle just swaps adjacent pairs, so use the optimized
      // implementation below.
      for (let i = 0; i < 16; i += 2) {
        const bit = this.#reader.readBit_();
        input[i] = i + bit;
        input[i + 1] = i + (bit ^ 1);
      }

      // Now perform the rest of the iterations of the shuffle (if any).
      for (let i = 1; i <= len; i++) {
        const size = 1 << i;
        for (let t = 0; t < 16; t += size << 1) {
          this.#mergeTreeData(output, input, t, size);
        }
        [input, output] = [output, input];
      }

      tree.symbolMap_.set(input);
    }

    return;
  }

  #mergeTreeData(dest: Uint8Array, src: Uint8Array, src1Index: number, size1: number): void {
    let src2Index = src1Index + size1;
    let size2 = size1;
    let destIndex = src1Index;

    while (size1 && size2) {
      if (this.#reader.readBit_()) {
        dest[destIndex++] = src[src2Index++] as number;
        size2--;
      } else {
        dest[destIndex++] = src[src1Index++] as number;
        size1--;
      }
    }

    while (size1--) {
      dest[destIndex++] = src[src1Index++] as number;
    }
    while (size2--) {
      dest[destIndex++] = src[src2Index++] as number;
    }
  }

  /**
   * Read Huffman tree information from the bit-stream for each block type in the current
   * plane.
   * @param width Coded width of the video (pixels).
   * @param blockWidth Coded width of the video (number of 8x8 blocks).
   */
  #readPlaneTrees(width: number, blockWidth: number): void {
    const adjustedWidth = (width + 7) & ~7;
    const extraLen = 511;
    const commonLen = (adjustedWidth >>> 3) + extraLen;
    for (const [blockParamNum, blockParamValues] of this.#blockParams.entries() as ArrayIterator<
      [IntRange<0, typeof NUM_BLOCK_PARAMS>, BlockParamValues]
    >) {
      // Initialize number of bits used to specify the number of coded entries for each block
      // parameter type in each row.
      blockParamValues.len_ =
        ~~Math.log2(
          (
            [
              commonLen, // BIK_PARAM_BLOCK_TYPES
              (adjustedWidth >>> 4) + extraLen, // BIK_PARAM_SUB_BLOCK_TYPES
              (blockWidth << 6) + extraLen, // BIK_PARAM_COLORS
              (blockWidth << 3) + extraLen, // BIK_PARAM_PATTERN
              commonLen, // BIK_PARAM_X_OFF
              commonLen, // BIK_PARAM_Y_OFF
              commonLen, // BIK_PARAM_INTRA_DC
              commonLen, // BIK_PARAM_INTER_DC
              blockWidth * 48 + extraLen, // BIK_PARAM_RUN
            ] as FixedLengthArray<number, typeof NUM_BLOCK_PARAMS>
          )[blockParamNum],
        ) + 1;

      if (blockParamNum === BIK_PARAM_COLORS) {
        for (const tree of this.#colHigh) {
          this.#readTree(tree);
        }
        this.#colLastValue = 0;
      }

      if (blockParamNum < BIK_PARAM_INTRA_DC || blockParamNum > BIK_PARAM_INTER_DC) {
        this.#readTree(blockParamValues.tree_);
      }

      blockParamValues.curDec_ = blockParamValues.curPtr_ = 0;
    }
  }

  /**
   * Calculate the number of block parameter values that should be read from the bit-stream.
   * @param blockParamValues State of the block parameter.
   * @returns Number of block parameter values.
   */
  #readCodedDataCount(blockParamValues: BlockParamValues): number {
    if (blockParamValues.curDec_ < 0 || blockParamValues.curDec_ > blockParamValues.curPtr_) {
      return 0;
    }
    const count = this.#reader.readBits_(blockParamValues.len_);
    if (count === 0) {
      blockParamValues.curDec_ = -1;
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
        blockParamValues.items_[blockParamValues.curDec_++] = v;
      }
    } else {
      let prevValue: IntRange<0, 12> = 0;
      for (let i = 0; i < count; i++) {
        const v = HuffTable.getHuff_(reader, blockParamValues.tree_);
        if (v < 12) {
          prevValue = v as IntRange<0, 12>;
          blockParamValues.items_[blockParamValues.curDec_++] = v as IntRange<0, 12>;
        } else {
          const runLength = RLE_LENGTHS[(v - 12) as IntRange<0, 4>];
          for (let j = 0; j < runLength; j++) {
            blockParamValues.items_[blockParamValues.curDec_++] = prevValue;
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

    const isRun = reader.readBit_();
    let loopCount = isRun ? 1 : count;
    do {
      const colHighValue = HuffTable.getHuff_(reader, this.#colHigh[this.#colLastValue] as Tree);
      let v = (HuffTable.getHuff_(reader, blockParamValues.tree_) |
        (colHighValue << 4)) as IntRange<0, 256>;
      this.#colLastValue = colHighValue;

      if (this.#version < 105) {
        v = (v > 127 ? 256 - v : v + 128) as IntRange<0, 256>;
      }

      if (isRun) {
        blockParamValues.items_.fill(
          v,
          blockParamValues.curDec_,
          blockParamValues.curDec_ + count,
        );
        blockParamValues.curDec_ += count;
      } else {
        blockParamValues.items_[blockParamValues.curDec_++] = v;
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
        HuffTable.getHuff_(reader, blockParamValues.tree_) |
        (HuffTable.getHuff_(reader, blockParamValues.tree_) << 4);
      blockParamValues.items_[blockParamValues.curDec_++] = v;
    }
  }

  #readMotionValues(blockParamValues: BlockParamValues) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;
    const items = blockParamValues.items_;
    const maxDec = blockParamValues.curDec_ + count;
    let v: number;

    if (reader.readBit_()) {
      v = reader.readBits_(4);
      if (v) {
        v = reader.applySign_(v);
      }
      v = (v << 24) >> 24; // sign extend the byte

      items.fill(v, blockParamValues.curDec_, maxDec);
    } else {
      while (blockParamValues.curDec_ < maxDec) {
        v = HuffTable.getHuff_(reader, blockParamValues.tree_);
        if (v) {
          v = reader.applySign_(v);
        }
        v = (v << 24) >> 24; // sign extend the byte
        items[blockParamValues.curDec_++] = v;
      }
    }
    blockParamValues.curDec_ = maxDec;
  }

  #readDCs(blockParamValues: BlockParamValues, hasSign: boolean) {
    const count = this.#readCodedDataCount(blockParamValues);
    if (!count) {
      return;
    }
    const reader = this.#reader;

    let v = reader.readBits_(hasSign ? 10 : 11);
    if (v && hasSign) {
      v = reader.applySign_(v);
    }

    const items = blockParamValues.items_ as Int16Array;
    items[blockParamValues.curDec_++] = v;

    let i = 1;
    while (i < count) {
      const len = Math.min(count - i, 8);
      const v2Size = reader.readBits_(4);

      if (v2Size) {
        for (let j = 0; j < len; j++) {
          let v2 = reader.readBits_(v2Size);
          if (v2) {
            v2 = reader.applySign_(v2);
          }
          v += v2;
          items[blockParamValues.curDec_++] = v;
        }
      } else {
        for (let j = 0; j < len; j++) {
          items[blockParamValues.curDec_++] = v;
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
        blockParamValues.items_[blockParamValues.curDec_++] = v;
      }
    } else {
      for (let i = 0; i < count; i++) {
        blockParamValues.items_[blockParamValues.curDec_++] = HuffTable.getHuff_(
          reader,
          blockParamValues.tree_,
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
    return blockParamValues.items_[blockParamValues.curPtr_++] ?? 0;
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
    let i = 0;

    // Set initial operations for the "VM"
    coeffList[64] = 4;
    coeffList[65] = 24;
    coeffList[66] = 44;
    modeList[64] = 0;
    modeList[65] = 0;
    modeList[66] = 0;
    if (isResidue) {
      listEnd = 68;
      masksCount = this.#reader.readBits_(7);
      coeffList[67] = 0;
      modeList[67] = 2;
    } else {
      coeffList[67] = 1;
      coeffList[68] = 2;
      coeffList[69] = 3;
      modeList[67] = 3;
      modeList[68] = 3;
      modeList[69] = 3;
    }

    // bit count for DCT coeffs; bit mask for residue
    let bits = isResidue ? 1 << reader.readBits_(3) : reader.readBits_(4) - 1;

    while (isResidue ? bits : bits >= 0) {
      if (isResidue) {
        for (i = 0; i < coeffCount; i++) {
          if (reader.readBit_()) {
            const curNzCoeff = coeffIndex[i] ?? 0;
            const value = block[curNzCoeff] ?? 0;
            (block[curNzCoeff] as number) = value < 0 ? value - bits : value + bits;
            if (!masksCount--) {
              return;
            }
          }
        }
      }

      let listPos = listStart;

      while (listPos < listEnd) {
        const ccoeff = coeffList[listPos] ?? 0;
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

            for (i = ccoeff; i < ccoeff + 4; i++) {
              if (reader.readBit_()) {
                coeffList[--listStart] = i;
                modeList[listStart] = 3;
              } else {
                if (isResidue) {
                  const offset = BIK_SCAN[i] ?? 0;
                  coeffIndex[coeffCount++] = offset;
                  block[offset] = reader.applySign_(bits);
                  if (!masksCount--) {
                    return;
                  }
                } else {
                  const offset = bits
                    ? reader.applySign_(reader.readBits_(bits) | (1 << bits))
                    : 1 - (reader.readBit_() << 1);
                  block[BIK_SCAN[i] ?? 0] = offset;
                  coeffIndex[coeffCount++] = i;
                }
              }
            }
            break;
          }

          case 1: {
            modeList[listPos] = 2;
            for (i = ccoeff + 4; i < ccoeff + 16; i += 4) {
              coeffList[listEnd] = i;
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

    if (!isResidue) {
      const quantOffset = (reader.readBits_(4) << 6) + quantStartIndex;
      block[0] = ((block[0] ?? 0) * (BIK_QUANT[quantOffset] ?? 0)) >> 11;
      while (coeffCount--) {
        const index = coeffIndex[coeffCount] ?? 0;
        const blockIndex = BIK_SCAN[index] ?? 0;
        block[blockIndex] =
          ((block[blockIndex] ?? 0) * (BIK_QUANT[quantOffset + index] ?? 0)) >> 11;
      }
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
    rawDest: Uint8Array | null,
    destOffset: number,
    column: boolean,
  ) {
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
  }

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
  #idctPut(block: Int32Array, dest: Uint8Array, destOffset: number, stride: number) {
    let i: number;

    for (i = 0; i < 8; i++) {
      this.#idct(block, i, null, i, true);
    }

    for (i = 0; i < 64; i += 8) {
      this.#idct(block, i, dest, destOffset, false);
      destOffset += stride;
    }
  }

  /**
   * Variant of {@link #idctPut} that adds the result of the transformation to the values in the
   * output buffer instead of overwriting them.
   */
  #idctAdd(block: Int32Array, dest: Uint8Array, destOffset: number, stride: number) {
    let i: number;

    for (i = 0; i < 8; i++) {
      this.#idct(block, i, null, i, true);
    }

    for (i = 0; i < 64; i += 8) {
      this.#idct(block, i, null, i, false);
    }

    this.#addPixels8x8(block, dest, destOffset, stride);
  }

  #addPixels8x8(block: Int32Array, dest: Uint8Array, destOffset: number, stride: number) {
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
  }

  /**
   * Decode a single encoded frame of video.
   * @param data Encoded frame.
   * @param existingFrame Decoded frame to re-use for the returned value.
   * @returns Decoded frame.
   */
  decodeFrame_(
    data: Uint8Array | Uint8Array,
    existingFrame: BikVideoFrame | null = null,
  ): BikVideoFrame {
    const reader = this.#reader;
    reader.reset_(data);
    let frame: BikVideoFrame;
    if (existingFrame) {
      frame = existingFrame;
      frame.yuv.set(this.#prevData);
    } else {
      frame = this.#createFrame();
    }
    this.#data = frame.yuv;

    if (this.#hasAlpha) {
      if (this.#version > 104) {
        reader.skip_(32);
      }
      this.#decodePlane(frame, 3);
    }

    if (this.#version > 104) {
      reader.skip_(32);
    }

    for (let plane = 0; plane < 3; plane++) {
      const planeIndex = (plane && this.#hasSwappedUVPlanes ? plane ^ 3 : plane) as TPlaneIndex;
      this.#decodePlane(frame, planeIndex);
      if (reader.bitsLeft_ < 1) break;
    }

    // Store a copy of the YUVA planes for frame-relative decoding with the next frame.
    this.#prevData.set(frame.yuv);
    this.#data = EMPTY_UINT8_ARRAY;
    this.#reader.reset_(EMPTY_UINT8_ARRAY);

    return frame;
  }
}
