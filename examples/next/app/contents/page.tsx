import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { content } from "#content-query";

export const metadata: Metadata = {
  title: "Contents",
  description: "Every guide and its sections on one page.",
};

export default async function ContentsPage() {
  // Requesting a payload in a list query loads it for every returned row, after ordering.
  // This page needs each guide's headings, so it opts into the rendered payload explicitly.
  const guides = await content.query.guides.findMany({
    columns: { id: true, title: true },
    orderBy: { order: "asc" },
    payloads: { _rendered: true },
  });

  return (
    <main className="home" id="main-content" tabIndex={-1}>
      <div className="home-intro">
        <h1>Contents</h1>
        <p>Every guide and its sections, from the guides' rendered headings.</p>
      </div>
      <ol className="contents-list">
        {guides.map((guide) => (
          <li key={guide.id}>
            <Link href={`/docs/${guide.id}`}>{guide.title}</Link>
            <ul>
              {guide._payloads._rendered.headings
                .filter((heading) => heading.depth === 2)
                .map((heading) => (
                  <li key={heading.slug}>
                    <Link href={`/docs/${guide.id}#${heading.slug}`}>{heading.text}</Link>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}
