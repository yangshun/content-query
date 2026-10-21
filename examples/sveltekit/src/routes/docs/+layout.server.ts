import { content } from "content-query:server";

export async function load() {
  return {
    guides: await content.query.guides.findMany({
      columns: { id: true, title: true },
      orderBy: { order: "asc" },
    }),
  };
}
