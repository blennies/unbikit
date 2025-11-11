declare interface VideoFrameBufferInit {
  transfer: ArrayBuffer[];
}

declare const BIK_BLOCK_TYPE_SKIP: 0;
declare const BIK_BLOCK_TYPE_SCALED: 1;
declare const BIK_BLOCK_TYPE_MOTION: 2;
declare const BIK_BLOCK_TYPE_RUN: 3;
declare const BIK_BLOCK_TYPE_RESIDUE: 4;
declare const BIK_BLOCK_TYPE_INTRA: 5;
declare const BIK_BLOCK_TYPE_FILL: 6;
declare const BIK_BLOCK_TYPE_INTER: 7;
declare const BIK_BLOCK_TYPE_PATTERN: 8;
declare const BIK_BLOCK_TYPE_RAW: 9;

declare const BIK_PARAM_BLOCK_TYPES: 0;
declare const BIK_PARAM_SUB_BLOCK_TYPES: 1;
declare const BIK_PARAM_COLORS: 2;
declare const BIK_PARAM_PATTERN: 3;
declare const BIK_PARAM_X_OFF: 4;
declare const BIK_PARAM_Y_OFF: 5;
declare const BIK_PARAM_INTRA_DC: 6;
declare const BIK_PARAM_INTER_DC: 7;
declare const BIK_PARAM_RUN: 8;

declare const NUM_BLOCK_PARAMS: 9;

declare const DCT_C0: number;
declare const DCT_C1: number;
declare const DCT_C2: number;
declare const DCT_C3: number;
