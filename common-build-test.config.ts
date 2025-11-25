/**
 * Configuration options shared between build/test tools.
 */

import type { ESBuildOptions } from "vite";
import { BIK_DEFINES } from "./src/bik-defines.ts";

// Minify names of props internal to the package that most minifiers can't automatically mangle.
//
// Regenerate with:
//   pnpm esbuild --bundle --outfile=test.js --mangle-cache=mangle.json --mangle-props='_$' ./src/bik-decoder.ts
const MANGLE_CACHE = {
  align32_: "o",
  applySign_: "e",
  bitsLeft_: "p",
  calculate_: "k",
  curDec_: "b",
  curPtr_: "j",
  decodeFrame_: "t",
  decode_: "s",
  getHuff_: "f",
  items_: "d",
  len_: "q",
  open_: "u",
  predefinedTables_: "l",
  readBit_: "c",
  readBits_: "a",
  reset_: "n",
  skip_: "i",
  symbolMap_: "g",
  table_: "m",
  tell_: "r",
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
  mangleProps: /_$/,
  mangleQuoted: true,
  platform: "neutral",
  reserveProps: /^postMessage$/,
  target: "es2022",
};

export { commonBuildInputOptions, commonBuildTestConfig, commonEsbuildOptions };
