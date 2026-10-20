import { allEntries } from "content-collections";

const entries = allEntries.toSorted((left, right) => left.order - right.order);
const entriesById = new Map(entries.map((entry) => [entry._meta.path, entry]));
if (!entries.length) {
  throw new Error("Generate the benchmark corpus before starting the app.");
}

export const prerenderPaths = ["/", ...entries.map((entry) => `/entries/${entry._meta.path}/`)];

export function App({ pathname }: { pathname: string }) {
  if (pathname !== "/") {
    const id = decodeURIComponent(pathname.replace(/^\/entries\//, "").replace(/\/$/, ""));
    const entry = entriesById.get(id);
    if (!entry) {
      throw new Error(`Unknown benchmark entry: ${id}`);
    }
    return (
      <main data-benchmark-entry={id}>
        <a href="/">All entries</a>
        <h1 data-benchmark-title>{entry.title}</h1>
        <p data-benchmark-description>{entry.description}</p>
        <article dangerouslySetInnerHTML={{ __html: entry.html }} />
      </main>
    );
  }
  return (
    <main data-benchmark-count={entries.length}>
      <h1>Vite + React + Content Collections</h1>
      <p>{entries.length} entries</p>
      <p>
        Final entry: <span data-benchmark-last>{entries.at(-1)?.title}</span>
      </p>
      <h2>All entries</h2>
      <ol data-benchmark-index>
        {entries.map((entry) => (
          <li key={entry._meta.path}>
            <a href={`/entries/${entry._meta.path}/`}>{entry.title}</a>
            <p>{entry.description}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
