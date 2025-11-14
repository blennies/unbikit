import esbuild from "rollup-plugin-esbuild";
import { defineConfig, type Plugin, type ViteUserConfigExport } from "vitest/config";
import { commonBuildInputOptions, commonBuildTestConfig } from "./common-build-test.config.ts";

const config: ViteUserConfigExport = defineConfig(() => {
  // const isProduction = mode === "production";

  return {
    ...commonBuildTestConfig,
    plugins: [
      esbuild({
        mangleCache: {
          align32_: "u",
          applySign_: "i",
          bitPos_: "A",
          bitsLeft_: "f",
          calculate_: "c",
          curDec_: "e",
          curPtr_: "a",
          getHuff_: "r",
          items_: "s",
          pos_: "b",
          readBit_: "n",
          readBits_: "t",
          reset_: "l",
          restorePos_: "y",
          savePos_: "d",
          skip_: "h",
          tell_: "m",
          tree_: "o",
        },
        mangleProps:
          /^(align32|applySign|bitPos|bitsLeft|calculate|curDec|curPtr|getHuff|items|pos|readBits?|reset|restorePos|savePos|skip|tell|tree)_$/,
        mangleQuoted: true,
        platform: "neutral",
        reserveProps: /^postMessage$/,
        target: "es2022",
      }) as Plugin,
    ],
    rolldownOptions: commonBuildInputOptions,
    test: {
      coverage: { exclude: ["./tests/**/*"] },
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
