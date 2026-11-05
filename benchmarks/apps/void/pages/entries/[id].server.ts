import { defineHandler } from "void";
import { entries } from "content-query:collections/entries";
import { eq } from "content-query/query";

export const prerender = true;

export const loader = defineHandler(async (context) => {
  const id = context.req.param("id");
  if (!id) {
    return context.notFound();
  }
  const entry = await entries
    .select("id", "title", "description")
    .where((fields) => eq(fields.id, id))
    .withPayload("_rendered")
    .first();
  if (!entry) {
    return context.notFound();
  }
  const { _payloads, ...metadata } = entry;
  return { entry: metadata, html: _payloads._rendered.html };
});

export async function getPrerenderPaths() {
  const rows = await entries.select("id").orderBy("order").all();
  return rows.map(({ id }) => ({ id }));
}
