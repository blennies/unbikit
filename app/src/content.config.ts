import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

type Docs = ReturnType<typeof defineCollection>;
const docs: Docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema(),
});

export const collections: { docs: Docs } = {
  docs,
};
