import { defineHandler, defineHead, type InferProps } from "void";
import { content } from "content-query:server";

export const prerender = true;

export const loader = defineHandler(async () => {
  const guides = await content
    .select("id", "title", "description")
    .from("guides")
    .orderBy("order")
    .all();

  return { guides };
});

export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({
  title: "Documentation",
  meta: [
    {
      name: "description",
      content: "Sample guides for keeping project notes organized and working with your team.",
    },
  ],
}));
