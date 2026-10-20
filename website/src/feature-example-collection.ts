import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
import { markdownExample } from "./feature-example-data";

/** Prepares the homepage's Markdown example with ContentQuery's actual renderer. */
export const examples = defineCollection({
  schema: schema.object({ title: schema.string() }),
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
