import { defineCollection } from "content-query";
import { schema } from "content-query/schema";

export const collections = {
  entries: defineCollection({
    source: "./content/entries",
    schema: schema.object({
      title: schema.string(),
      description: schema.string(),
      order: schema.number(),
    }),
  }),
};
