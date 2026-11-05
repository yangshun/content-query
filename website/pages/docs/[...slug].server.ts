import { eq } from "content-query/query";
import { defineHandler, defineHead, type InferProps } from "void";
import { guides } from "content-query:collections/guides";

export const prerender = true;

export const loader = defineHandler(async (context) => {
  const id = context.req.param("slug");
  const query = guides
    .select("id", "title", "description")
    .orderBy("order")
    .selectAdjacent((siblings) => siblings.orderBy("order").select("id", "title"))
    .withPayload("_rendered");
  const guide = await (id ? query.where((fields) => eq(fields.id, id)) : query).first();

  if (!guide) {
    return context.notFound();
  }

  const { _adjacent, _payloads, ...metadata } = guide;
  const { html, headings } = _payloads._rendered;
  return {
    guide: { ...metadata, html },
    headings,
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
