import { defineCollection } from "content-query";
import { z } from "zod";
import { documentationSections } from "./src/docs-navigation";
import { examples } from "./src/feature-example-collection";

const guides = defineCollection({
  source: "./content/guides",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(documentationSections.map((section) => section.id)),
    order: z.number(),
  }),
});

export const collections = { guides, examples };
