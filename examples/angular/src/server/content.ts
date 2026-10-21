import { content } from "../../.content-query/server.js";

/** Loads only metadata for the home index. */
export function loadHome() {
  return content.query.guides.findMany({
    columns: { id: true, title: true, description: true },
    orderBy: { order: "asc" },
  });
}

/** Loads sidebar metadata independently of the current article. */
export function loadNavigation() {
  return content.query.guides.findMany({
    columns: { id: true, title: true },
    orderBy: { order: "asc" },
  });
}

/** Renders one guide and selects its immediate neighbors. */
export async function loadGuide(id: string) {
  const guide = await content.query.guides.findFirst({
    where: { id },
    adjacent: { orderBy: { order: "asc" }, columns: { id: true, title: true } },
    columns: { id: true, title: true, description: true },
  });
  if (!guide) {
    return null;
  }
  const { html } = await content.render("guides", id);
  return {
    guide: { id: guide.id, title: guide.title, description: guide.description, html },
    ...guide._adjacent,
  };
}
