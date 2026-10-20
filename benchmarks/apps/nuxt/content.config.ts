import { defineCollection, defineContentConfig } from "@nuxt/content";
import { z } from "zod";

export default defineContentConfig({
  collections: {
    entries: defineCollection({
      type: "page",
      source: "entries/**/*.md",
      schema: z.object({ title: z.string(), description: z.string(), order: z.number() }),
    }),
  },
});
