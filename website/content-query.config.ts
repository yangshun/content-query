import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
import { documentationSections } from "./src/docs-navigation";
import { examples } from "./src/feature-example-collection";

const guides = defineCollection({
  source: "./content/guides",
  schema: schema.object({
    title: schema.string(),
    description: schema.string(),
    section: schema.enum(documentationSections.map((section) => section.id)),
    order: schema.number(),
  }),
});

export const collections = { guides, examples };
