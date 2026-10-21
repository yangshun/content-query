import { error } from "@sveltejs/kit";
import { content } from "content-query:server";

export async function entries() {
  return (await content.query.guides.findMany({ columns: { id: true } })).map(({ id }) => ({
    slug: id,
  }));
}

export async function load({ params }: { params: { slug: string } }) {
  const id = params.slug.replace(/\/$/, "");
  const guide = await content.query.guides.findFirst({
    where: { id },
    adjacent: { orderBy: { order: "asc" }, columns: { id: true, title: true } },
    columns: { id: true, title: true, description: true },
  });
  if (!guide) {
    error(404, "Guide not found");
  }
  const { html } = await content.render("guides", id);
  return { guide: { ...guide, html }, ...guide._adjacent };
}
