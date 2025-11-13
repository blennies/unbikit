import esbuild from "rollup-plugin-esbuild";
import { defineConfig, type Plugin, type ViteUserConfigExport } from "vitest/config";
import { commonBuildInputOptions, commonBuildTestConfig } from "./common-build-test.config.ts";

const config: ViteUserConfigExport = defineConfig(({ mode }) => {
  // const isProduction = mode === "production";

  return {
    ...commonBuildTestConfig,
    plugins: [
      esbuild({
        mangleCache: {
          align32: "u",
          applySign: "i",
          bitPos: "A",
          bitsLeft: "f",
          calculate: "c",
          curDec: "e",
          curPtr: "a",
          getHuff: "r",
          items: "s",
          pos: "b",
          readBit: "n",
          readBits: "t",
          reset: "l",
          restorePos: "y",
          savePos: "d",
          skip: "h",
          tell: "m",
          tree: "o",
        },
        mangleProps:
          /^align32|applySign|bitPos|bitsLeft|calculate|curDec|curPtr|getHuff|items|pos|readBits?|reset|restorePos|savePos|skip|tell|tree$/,
        mangleQuoted: true,
        platform: "neutral",
        reserveProps: /^postMessage$/,
        target: "es2022",
      }) as Plugin,
    ],
    rolldownOptions: commonBuildInputOptions,
    test: {
      // globalSetup: "tests/global-setup.ts",
      // projects: [
      //   { extends: true, test: { name: "dev" } },
      //   { extends: true, test: { name: "prod" } },
      // ],
      // typecheck: { enabled: true },
    },
  };
});

export default config;
