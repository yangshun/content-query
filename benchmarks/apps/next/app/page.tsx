import "server-only";
import Link from "next/link";
import { content } from "#content-query";

export default async function HomePage() {
  const entries = await content
    .query("entries")
    .select("id", "title", "description")
    .orderBy("order")
    .all();
  if (!entries.length) {
    throw new Error("Generate the benchmark corpus before starting the app.");
  }
  return (
    <main data-benchmark-count={entries.length}>
      <h1>Next.js + ContentQuery</h1>
      <p>{entries.length} entries</p>
      <p>
        Final entry: <span data-benchmark-last>{entries.at(-1)?.title}</span>
      </p>
      <h2>All entries</h2>
      <ol data-benchmark-index>
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link href={`/entries/${entry.id}/`}>{entry.title}</Link>
            <p>{entry.description}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
