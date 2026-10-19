import { error } from "@sveltejs/kit";
import { content } from "content-query:server";

export async function entries() {
  return (await content.findMany("guides", { select: { id: true } })).map(({ id }) => ({
    slug: id,
  }));
}

export async function load({ params }: { params: { slug: string } }) {
  const id = params.slug.replace(/\/$/, "");
  const guide = await content.findFirst("guides", {
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      _adjacent: { orderBy: { order: "asc" }, select: { id: true, title: true } },
    },
  });
  if (!guide) {
    error(404, "Guide not found");
  }
  const { html } = await content.render("guides", id);
  return { guide: { ...guide, html }, ...guide._adjacent };
}
