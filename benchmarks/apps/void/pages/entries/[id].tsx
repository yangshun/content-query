import type { InferProps } from "void";
import type { loader } from "./[id].server";

export default function EntryPage({ entry, html }: InferProps<typeof loader>) {
  return (
    <main data-benchmark-entry={entry.id}>
      <a href="/">All entries</a>
      <h1 data-benchmark-title>{entry.title}</h1>
      <p data-benchmark-description>{entry.description}</p>
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
