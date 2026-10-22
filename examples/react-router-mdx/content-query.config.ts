import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
import { mdx } from "@content-query/mdx";

export const collections = {
  guides: defineCollection({
    loader: mdx({ base: "./content/guides" }),
    schema: schema.object({
      title: schema.string(),
      description: schema.string(),
      order: schema.number(),
    }),
  }),
};
