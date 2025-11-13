import { defineConfig, type UserConfig } from "tsdown";
import { commonBuildInputOptions, commonBuildTestConfig } from "./common-build-test.config.ts";

const config: UserConfig[] = defineConfig([
  {
    ...commonBuildTestConfig,
    dts: true,
    entry: {
      unbikit: "./src/bik-decoder.ts",
    },
    format: ["esm", "commonjs"],
    fromVite: true, // import plugins from the Vite config
    inputOptions: commonBuildInputOptions,
  },
]);

export default config;
