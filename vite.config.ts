import esbuild from "rollup-plugin-esbuild";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import {
  commonBuildInputOptions,
  commonBuildTestConfig,
  commonEsbuildOptions,
} from "./common-build-test.config.ts";

const coverage = process.env.npm_lifecycle_event === "test:coverage";

const config: ViteUserConfig = defineConfig({
  ...commonBuildTestConfig,
  // Disable esbuild when generating coverage figures, to improve coverage accuracy
  plugins: coverage
    ? []
    : [
        esbuild({
          ...commonEsbuildOptions,
        }),
      ],
  // output: { minify: true },
  rolldownOptions: commonBuildInputOptions,
  test: {
    coverage: { exclude: ["./tests/**/*"] },
    // globalSetup: "tests/global-setup.ts",
    // projects: [
    //   { extends: true, test: { name: "dev" } },
    //   { extends: true, test: { name: "prod" } },
    // ],
    // typecheck: { enabled: true },
    // fileParallelism: false,
    // execArgv: ["--cpu-prof", "--cpu-prof-dir=test-runner-profile"],
  },
} as ViteUserConfig);

export default config;
