import { defineHandler, defineHead, type InferProps } from "void";
import { guides } from "content-query:collections/guides";

export const prerender = true;

export const loader = defineHandler(async (context) => {
  const id = context.req.param("slug");
  if (!id) {
    return context.notFound();
  }

  const guide = await guides
    .byId(id)
    .select("id", "title", "description")
    .selectAdjacent((siblings) => siblings.orderBy("order").select("id", "title"))
    .withPayload("_rendered");

  if (!guide) {
    return context.notFound();
  }

  const { _adjacent, _payloads, ...metadata } = guide;
  return {
    guide: { ...metadata, html: _payloads._rendered.html },
    previous: _adjacent.previous,
    next: _adjacent.next,
  };
});

export type Props = InferProps<typeof loader>;

export const head = defineHead((_context, props: Props) => ({
  title: props.guide.title,
  meta: [{ name: "description", content: props.guide.description }],
}));

/** Queries the current collection instead of capturing entries during module initialization. */
export async function getPrerenderPaths() {
  const entries = await guides.select("id").orderBy("order").all();
  return entries.map((guide) => ({ slug: guide.id }));
}
