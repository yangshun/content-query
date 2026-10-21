import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getEntries = createServerFn({ method: "GET" }).handler(async () => {
  const { content } = await import("content-query:server");
  const entries = await content
    .select("id", "title", "description")
    .from("entries")
    .orderBy("order")
    .all();
  if (!entries.length) {
    throw new Error("Generate the benchmark corpus before starting the app.");
  }
  return { count: entries.length, entries, last: entries.at(-1) };
});

export const Route = createFileRoute("/")({
  loader: () => getEntries(),
  head: () => ({ meta: [{ title: "TanStack Start + ContentQuery benchmark" }] }),
  component: HomePage,
});

function HomePage() {
  const { count, entries, last } = Route.useLoaderData();
  return (
    <main data-benchmark-count={count}>
      <h1>TanStack Start + ContentQuery</h1>
      <p>{count} entries</p>
      <p>
        Final entry: <span data-benchmark-last>{last?.title}</span>
      </p>
      <h2>All entries</h2>
      <ol data-benchmark-index>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={`/entries/${entry.id}/`}>{entry.title}</a>
            <p>{entry.description}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
