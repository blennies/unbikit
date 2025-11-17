import mdx from "@astrojs/mdx";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import viteConfig from "./app/vite.config";

const config: ReturnType<typeof defineConfig> = defineConfig({
  base: "/unbikit/",
  experimental: {
    headingIdCompat: true,
  },
  integrations: [
    starlight({
      customCss: ["./src/styles/global.css", "@fontsource-variable/sora/index.css"],
      plugins: [
        starlightTypeDoc({
          entryPoints: ["src/bik-decoder.ts"],
          sidebar: { collapsed: false },
          tsconfig: "app/tsconfig.json",
          typeDoc: { name: "API Overview" },
        }),
        starlightThemeRapide(),
      ],
      sidebar: [
        {
          label: "⭐ Demo",
          link: "/demo",
        },
        {
          label: "Changelog",
          link: "/changelog",
        },
        {
          label: "License",
          link: "/license",
        },
        {
          label: "API Overview",
          link: "api/readme",
        },
        // Add the generated sidebar group to the sidebar.
        typeDocSidebarGroup,
      ],
      social: [
        {
          icon: "github",
          label: "GitHub repository",
          href: "https://github.com/blennies/unbikit",
        },
      ],
      title: "unbikit",
    }),
    mdx(),
  ],
  output: "static",
  outDir: "./dist-app",
  publicDir: "./app/public",
  root: "./app",
  site: "https://blennies.github.io/unbikit/",
  srcDir: "./app/src",
  // REVISIT: type mismatch with esbuild plugin type, but seems safe to ignore
  vite: { ...viteConfig } as any,
});

export default config;
