import { defineHandler, defineHead, type InferProps } from "void";
import { examples } from "content-query:collections/examples";

export const prerender = true;

export const loader = defineHandler(async () => {
  const example = await examples.findFirst({
    where: { id: "hello-world" },
    columns: {},
    payloads: { _rendered: true },
  });
  if (!example) {
    throw new Error('The "hello-world" rendering example is missing.');
  }
  return { renderedExample: example._payloads._rendered };
});

export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({
  title: "Typed content for your application",
  meta: [
    {
      name: "description",
      content:
        "Turn Markdown and structured data into typed collections, queries, and rendered content. Use ContentQuery with your framework, Vite, or a standalone build.",
    },
  ],
}));
