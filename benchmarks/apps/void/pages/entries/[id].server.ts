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
    .query("entries")
    .where((fields) => eq(fields.id, id))
    .select("id", "title", "description")
    .first();
  if (!entry) {
    return context.notFound();
  }
  const { html } = await content.render("entries", entry.id);
  return { entry, html };
});

export async function getPrerenderPaths() {
  const entries = await content.query("entries").select("id").orderBy("order").all();
  return entries.map(({ id }) => ({ id }));
}
