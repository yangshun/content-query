import { defineCollection } from "content-query";
import { z } from "zod";

export const collections = {
  entries: defineCollection({
    source: "./content/entries",
    schema: z.object({ title: z.string(), description: z.string(), order: z.number() }),
  }),
};
