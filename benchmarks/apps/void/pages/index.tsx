import type { InferProps } from "void";
import type { loader } from "./index.server";

export default function HomePage({ count, entries, last }: InferProps<typeof loader>) {
  return (
    <main data-benchmark-count={count}>
      <h1>Void + ContentQuery</h1>
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
