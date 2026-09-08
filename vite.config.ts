import esbuild from "rollup-plugin-esbuild";
import { defineConfig, type ViteUserConfig } from "vitest/config";

import {
  commonBuildInputOptions,
  commonBuildTestConfig,
  commonEsbuildOptions,
} from "./common-build-test.config.ts";

const benchmark = process.env.npm_lifecycle_event === "bench";

const config: ViteUserConfig = defineConfig({
  ...commonBuildTestConfig,
  // Disable esbuild when generating coverage figures, to improve coverage accuracy
  plugins: [
    esbuild({
      ...commonEsbuildOptions,
    }),
  ],
  build: { rolldownOptions: commonBuildInputOptions },
  // output: { minify: true },
  test: {
    benchmark: {
      include: ["./tests/main.bench.ts"],
    },
    coverage: {
      autoAttachSubprocess: true,
      exclude: ["./tests/common.ts"],
      excludeAfterRemap: true,
      provider: "istanbul" as const,
    },
    experimental: { viteModuleRunner: !benchmark },
    typecheck: { enabled: true },
    // globalSetup: "tests/global-setup.ts",
    // projects: [
    //   { extends: true, test: { name: "dev" } },
    //   { extends: true, test: { name: "prod" } },
    // ],
    // fileParallelism: false,
    // execArgv: ["--cpu-prof", "--cpu-prof-dir=test-runner-profile"],
  },
});

export default config;
