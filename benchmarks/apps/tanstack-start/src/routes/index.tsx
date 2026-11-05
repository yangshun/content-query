import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getEntries = createServerFn({ method: "GET" }).handler(async () => {
  const { entries } = await import("content-query:collections/entries");
  const rows = await entries.select("id", "title", "description").orderBy("order").all();
  if (!rows.length) {
    throw new Error("Generate the benchmark corpus before starting the app.");
  }
  return { count: rows.length, entries: rows, last: rows.at(-1) };
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
