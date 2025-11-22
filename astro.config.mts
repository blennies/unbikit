import mdx from "@astrojs/mdx";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import viteConfig from "./app/vite.config";

const [publicStarlightTypeDoc, publicTypeDocSidebarGroup] = createStarlightTypeDocPlugin();

const config: ReturnType<typeof defineConfig> = defineConfig({
  base: "/unbikit/",
  experimental: {
    headingIdCompat: true,
  },
  integrations: [
    starlight({
      components: {
        Footer: "./src/components/Footer.astro",
      },
      customCss: ["./src/styles/global.css", "@fontsource-variable/sora/index.css"],
      favicon: "/favicon.svg",
      head: [
        // Add favicon (logo) fallback
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/unbikit/favicon.ico",
            sizes: "32x32",
          },
        },
      ],
      logo: { src: "./src/images/unbikit-logo.svg", alt: "logo of unbikit" },
      plugins: [
        publicStarlightTypeDoc({
          entryPoints: ["src/bik-decoder.ts"],
          sidebar: { collapsed: false, label: "Module" },
          tsconfig: "app/tsconfig.json",
          typeDoc: { name: "API Overview" },
        }),
        starlightThemeRapide(),
      ],
      sidebar: [
        {
          label: "Start",
          items: [
            {
              label: "Getting Started",
              link: "/getting-started",
            },
            {
              label: "⭐ Demo",
              link: "/demo",
              badge: { variant: "success", text: "new!" },
            },
          ],
        },

        {
          label: "API",
          items: [{ label: "Overview", link: "/api/readme" }, publicTypeDocSidebarGroup],
        },

        {
          label: "Reference",
          items: [
            {
              label: "Development",
              link: "/development",
            },
            {
              label: "Changelog",
              link: "/changelog",
            },
            {
              label: "License",
              link: "/license",
            },
          ],
        },
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
