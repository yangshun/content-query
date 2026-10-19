import { content } from "../../.content-query/server.js";

/** Loads only metadata for the home index. */
export function loadHome() {
  return content.findMany("guides", {
    select: { id: true, title: true, description: true },
    orderBy: { order: "asc" },
  });
}

/** Loads sidebar metadata independently of the current article. */
export function loadNavigation() {
  return content.findMany("guides", {
    select: { id: true, title: true },
    orderBy: { order: "asc" },
  });
}

/** Renders one guide and selects its immediate neighbors. */
export async function loadGuide(id: string) {
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
    return null;
  }
  const { html } = await content.render("guides", id);
  return {
    guide: { id: guide.id, title: guide.title, description: guide.description, html },
    ...guide._adjacent,
  };
}
