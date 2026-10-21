import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getEntry = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { content } = await import("content-query:server");
    const entry = await content.query.entries.findFirst({
      where: { id },
      columns: { id: true, title: true, description: true },
    });
    if (!entry) {
      throw notFound();
    }
    const { html } = await content.render("entries", id);
    return { entry, html };
  });

export const Route = createFileRoute("/entries/$id")({
  loader: ({ params }) => getEntry({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.entry.title ?? "Entry not found" }] }),
  component: EntryPage,
});

function EntryPage() {
  const { entry, html } = Route.useLoaderData();
  return (
    <main data-benchmark-entry={entry.id}>
      <a href="/">All entries</a>
      <h1 data-benchmark-title>{entry.title}</h1>
      <p data-benchmark-description>{entry.description}</p>
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
