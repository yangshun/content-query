import { content } from "content-query:server";

export async function load() {
  return {
    guides: await content.findMany("guides", {
      select: { id: true, title: true },
      orderBy: { order: "asc" },
    }),
  };
}
