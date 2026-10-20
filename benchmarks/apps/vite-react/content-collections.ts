import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMarkdown } from "@content-collections/markdown";
import { z } from "zod";

const entries = defineCollection({
  name: "entries",
  directory: "./content/entries",
  include: "**/*.md",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    content: z.string(),
  }),
  transform: async (entry, context) => ({
    ...entry,
    html: await compileMarkdown(context, entry),
  }),
});

export default defineConfig({ content: [entries] });
