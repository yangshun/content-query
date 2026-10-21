import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { content } from "#content-query";
import { eq } from "content-query/query";

export const dynamicParams = false;

/** Enumerates the entire collection for Next.js's native static export. */
export async function generateStaticParams() {
  return content.select("id").from("entries").orderBy("order").all();
}

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await content
    .select("id", "title", "description")
    .from("entries")
    .where((fields) => eq(fields.id, id))
    .first();
  if (!entry) {
    notFound();
  }
  const { html } = await content.render("entries", id);
  return (
    <main data-benchmark-entry={id}>
      <Link href="/">All entries</Link>
      <h1 data-benchmark-title>{entry.title}</h1>
      <p data-benchmark-description>{entry.description}</p>
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
