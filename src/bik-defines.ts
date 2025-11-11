export const BIK_DEFINES = {
  "import.meta.vitest": undefined,

  /**
   * DCT transform values.
   *
   * Multiplied by 2,048 so they can be used in approximate integer calculations with reasonably
   * high precision, and then restored with a right shift of 11 bits.
   */

  // C0 rounded from Math.SQRT2 * 2048 ~= 2896.30
  DCT_C0: 2896,
  // C1 rounded from (Math.sqrt(2 + Math.SQRT2) - Math.sqrt(2 - Math.SQRT2)) * 2048 ~= 2216.74
  DCT_C1: 2217,
  // C2 rounded from Math.sqrt(2 + Math.SQRT2) * 2048 ~= 3784.21
  DCT_C2: 3784,
  // C3 rounded from -(Math.sqrt(2 + Math.SQRT2) + Math.sqrt(2 - Math.SQRT2)) * 2048 ~= -5351.68
  DCT_C3: -5352,

  /**
   * Block type constants
   */
  BIK_BLOCK_TYPE_SKIP: 0,
  BIK_BLOCK_TYPE_SCALED: 1,
  BIK_BLOCK_TYPE_MOTION: 2,
  BIK_BLOCK_TYPE_RUN: 3,
  BIK_BLOCK_TYPE_RESIDUE: 4,
  BIK_BLOCK_TYPE_INTRA: 5,
  BIK_BLOCK_TYPE_FILL: 6,
  BIK_BLOCK_TYPE_INTER: 7,
  BIK_BLOCK_TYPE_PATTERN: 8,
  BIK_BLOCK_TYPE_RAW: 9,

  /**
   * Block parameter indices
   */
  BIK_PARAM_BLOCK_TYPES: 0,
  BIK_PARAM_SUB_BLOCK_TYPES: 1,
  BIK_PARAM_COLORS: 2,
  BIK_PARAM_PATTERN: 3,
  BIK_PARAM_X_OFF: 4,
  BIK_PARAM_Y_OFF: 5,
  BIK_PARAM_INTRA_DC: 6,
  BIK_PARAM_INTER_DC: 7,
  BIK_PARAM_RUN: 8,
  NUM_BLOCK_PARAMS: 9,
} as const;

// // Import defines into the global namespace if the code has not been bundled.
// if (!(import.meta as unknown as Record<string, boolean>).builtInDefines) {
//   Object.assign(globalThis, BIK_DEFINES);
// }
