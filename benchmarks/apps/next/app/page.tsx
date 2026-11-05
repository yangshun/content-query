import "server-only";
import Link from "next/link";
import { entries } from "#content-query/entries";

export default async function HomePage() {
  const rows = await entries.select("id", "title", "description").orderBy("order").all();
  if (!rows.length) {
    throw new Error("Generate the benchmark corpus before starting the app.");
  }
  return (
    <main data-benchmark-count={rows.length}>
      <h1>Next.js + ContentQuery</h1>
      <p>{rows.length} entries</p>
      <p>
        Final entry: <span data-benchmark-last>{rows.at(-1)?.title}</span>
      </p>
      <h2>All entries</h2>
      <ol data-benchmark-index>
        {rows.map((entry) => (
          <li key={entry.id}>
            <Link href={`/entries/${entry.id}/`}>{entry.title}</Link>
            <p>{entry.description}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
