import { defineCollection } from "content-query";
import { z } from "zod";

export const collections = {
  guides: defineCollection({
    source: "./content/guides",
    schema: z.object({ title: z.string(), description: z.string(), order: z.number() }),
  }),
};
