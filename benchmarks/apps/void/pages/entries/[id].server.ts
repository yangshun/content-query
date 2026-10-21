import { defineHandler } from "void";
import { content } from "content-query:server";
import { eq } from "content-query/query";

export const prerender = true;

export const loader = defineHandler(async (context) => {
  const id = context.req.param("id");
  if (!id) {
    return context.notFound();
  }
  const entry = await content
    .select("id", "title", "description")
    .from("entries")
    .where((fields) => eq(fields.id, id))
    .first();
  if (!entry) {
    return context.notFound();
  }
  const { html } = await content.render("entries", entry.id);
  return { entry, html };
});

export async function getPrerenderPaths() {
  const entries = await content.select("id").from("entries").orderBy("order").all();
  return entries.map(({ id }) => ({ id }));
}
