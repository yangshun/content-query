import { defineCollection } from "content-query";
import { schema } from "content-query/schema";

const guides = defineCollection({
  source: "./content/guides",
  schema: schema.object({
    title: schema.string(),
    description: schema.string(),
    order: schema.number(),
  }),
});

export const collections = { guides };
