import { mergeConfig } from "vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import baseConfig from "../vite.config.ts";

const config: ViteUserConfig = defineConfig(
  mergeConfig(baseConfig, {
    platform: "browser",
    tsconfig: "./tsconfig.json",
  }),
);

export default config;
