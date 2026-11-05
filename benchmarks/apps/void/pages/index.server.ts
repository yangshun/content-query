import { defineHandler } from "void";
import { entries } from "content-query:collections/entries";

export const prerender = true;

export const loader = defineHandler(async () => {
  const [count, rows] = await Promise.all([
    entries.count(),
    entries.select("id", "title", "description").orderBy("order").all(),
  ]);
  const first = rows[0];
  if (!first) {
    throw new Error("Generate the benchmark corpus before starting the app.");
  }
  return { count, entries: rows, last: rows.at(-1) };
});
