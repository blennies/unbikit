/**
 * Configuration options shared between build/test tools.
 */
import { BIK_DEFINES } from "./src/bik-defines.ts";

const commonBuildTestConfig = {
  attw: true,
  define: Object.assign(
    Object.fromEntries(Object.entries(BIK_DEFINES).map(([value, item]) => [value, item + ""])),
  ) as Record<string, string>,
  platform: "neutral",
  publint: true,
  target: "es2022",
  treeshake: true,
  tsconfig: "./tsconfig.json",
  unused: true,
} as const;

const commonBuildInputOptions = {
  checks: {
    circularDependency: true,
  },
  preserveEntrySignatures: "allow-extension",
} as const;

export { commonBuildInputOptions, commonBuildTestConfig };
