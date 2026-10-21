import { defineHandler } from "void";
import { content } from "content-query:server";

export const prerender = true;

export const loader = defineHandler(async () => {
  const [count, entries] = await Promise.all([
    content.select().from("entries").count(),
    content.select("id", "title", "description").from("entries").orderBy("order").all(),
  ]);
  const first = entries[0];
  if (!first) {
    throw new Error("Generate the benchmark corpus before starting the app.");
  }
  return { count, entries, last: entries.at(-1) };
});
