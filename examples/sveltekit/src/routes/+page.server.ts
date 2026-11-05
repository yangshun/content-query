import { guides } from "content-query:collections/guides";

export async function load() {
  return {
    guides: await guides.findMany({
      columns: { id: true, title: true, description: true },
      orderBy: { order: "asc" },
    }),
  };
}
