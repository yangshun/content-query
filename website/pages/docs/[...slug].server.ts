import { eq } from "content-query/query";
import { defineHandler, defineHead, type InferProps } from "void";
import { content } from "content-query:server";

export const prerender = true;

export const loader = defineHandler(async (context) => {
  const id = context.req.param("slug");
  const query = content
    .select("id", "title", "description")
    .from("guides")
    .orderBy("order")
    .selectAdjacent((siblings) => siblings.orderBy("order").select("id", "title"));
  const guide = await (id ? query.where((fields) => eq(fields.id, id)) : query).first();

  if (!guide) {
    return context.notFound();
  }

  const { html, headings } = await content.render("guides", guide.id);
  return {
    guide: { ...guide, html },
    headings,
    previous: guide._adjacent.previous,
    next: guide._adjacent.next,
  };
});

export type Props = InferProps<typeof loader>;

export const head = defineHead((_context, props: Props) => ({
  title: props.guide.title,
  meta: [{ name: "description", content: props.guide.description }],
}));

/** Queries the current collection instead of capturing entries during module initialization. */
export async function getPrerenderPaths() {
  const guides = await content.select("id").from("guides").orderBy("order").all();
  return guides.map((guide) => ({ slug: guide.id }));
}
