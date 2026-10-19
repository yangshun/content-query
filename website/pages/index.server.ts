import { defineHandler, defineHead, type InferProps } from "void";
import { content } from "content-query:server";

export const prerender = true;

export const loader = defineHandler(async () => ({
  renderedExample: await content.render("examples", "hello-world"),
}));

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
