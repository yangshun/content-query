import { defineHandler, defineHead, type InferProps } from "void";
import { guides } from "content-query:collections/guides";

export const prerender = true;

export const loader = defineHandler(async () => {
  return {
    guides: await guides.select("id", "title", "description").orderBy("order").all(),
  };
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
