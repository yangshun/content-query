import { defineCollection } from "content-query";
import { z } from "zod";
import { markdownExample } from "./feature-example-data";

/** Prepares the homepage's Markdown example with ContentQuery's actual renderer. */
export const examples = defineCollection({
  schema: z.object({ title: z.string() }),
  loader: {
    name: "homepage-examples",
    async load(context) {
      const rendered = await context.renderMarkdown(markdownExample);
      context.store.set({
        id: "hello-world",
        data: { title: "Hello, world" },
        body: markdownExample,
        rendered,
      });
    },
  },
});
