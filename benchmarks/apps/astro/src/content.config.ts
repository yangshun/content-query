import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const collections = {
  entries: defineCollection({
    loader: glob({ base: "./content/entries", pattern: "**/*.md" }),
    schema: z.object({ title: z.string(), description: z.string(), order: z.number() }),
  }),
};
