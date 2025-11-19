/**
 * Configuration options shared between build/test tools.
 */

import { objectKeys } from "ts-extras";
import type { ESBuildOptions } from "vite";
import { BIK_DEFINES } from "./src/bik-defines.ts";

// Minify names of props internal to the package that most minifiers can't automatically mangle.
const MANGLE_CACHE = {
  align32_: "n",
  applySign_: "e",
  bitPos_: "t",
  bitsLeft_: "o",
  calculate_: "k",
  curDec_: "b",
  curPtr_: "i",
  decodeFrame_: "w",
  decode_: "v",
  getHuff_: "f",
  items_: "c",
  len_: "p",
  pos_: "s",
  readBit_: "d",
  readBits_: "a",
  reset_: "m",
  restorePos_: "u",
  savePos_: "r",
  skip_: "j",
  symbolMap_: "g",
  tableNum_: "l",
  tell_: "q",
  tree_: "h",
} as const;

const defines: Record<string, string> = Object.assign(
  Object.fromEntries(Object.entries(BIK_DEFINES).map(([value, item]) => [value, `${item}`])),
);

const commonBuildTestConfig = {
  define: defines as Record<string, string>,
  platform: "neutral",
  target: "es2022",
  treeshake: true,
  tsconfig: "./tsconfig.json",
} as const;

const commonBuildInputOptions = {
  checks: {
    circularDependency: true,
  },
  preserveEntrySignatures: "allow-extension",
} as const;

const commonEsbuildOptions: ESBuildOptions = {
  // Defines must be resolved by both esbuild _and_ Rolldown to avoid issues in certain cases,
  // such as when building the demo with Vite.
  define: defines,
  mangleCache: MANGLE_CACHE,
  mangleProps: new RegExp(`^${objectKeys(MANGLE_CACHE).join("|")}$`),
  mangleQuoted: true,
  platform: "neutral",
  reserveProps: /^postMessage$/,
  target: "es2022",
};

export { commonBuildInputOptions, commonBuildTestConfig, commonEsbuildOptions };
