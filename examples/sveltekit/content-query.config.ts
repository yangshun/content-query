import { defineCollection } from "content-query";
import { schema } from "content-query/schema";

export const collections = {
  guides: defineCollection({
    source: "./content/guides",
    schema: schema.object({
      title: schema.string(),
      description: schema.string(),
      order: schema.number(),
    }),
  }),
};
