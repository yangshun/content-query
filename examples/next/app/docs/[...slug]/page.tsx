import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideContent } from "../content";
import { guides } from "#content-query/guides";

type GuideProps = { params: Promise<{ slug: string[] }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const entries = await guides.findMany({
    columns: { id: true },
    orderBy: { order: "asc" },
  });

  return entries.map((guide) => ({ slug: guide.id.split("/") }));
}

export async function generateMetadata({ params }: GuideProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await guides.findFirst({
    where: { id: slug.join("/") },
    columns: { title: true, description: true },
  });

  if (!guide) {
    notFound();
  }

  return { title: guide.title, description: guide.description };
}

export default async function GuidePage({ params }: GuideProps) {
  const { slug } = await params;
  const id = slug.join("/");
  const guide = await guides.findFirst({
    where: { id },
    adjacent: { orderBy: { order: "asc" }, columns: { id: true, title: true } },
    columns: { id: true, title: true, description: true },
    // One query returns metadata, neighbors, and both built-in payloads from the same revision.
    payloads: { _rendered: true, _body: true },
  });

  if (!guide) {
    notFound();
  }

  const { _rendered: rendered, _body: body } = guide._payloads;
  const { previous, next } = guide._adjacent;

  return (
    <main className="guide-main" id="main-content" tabIndex={-1}>
      <article>
        <header className="article-header">
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
        </header>
        <GuideContent html={rendered.html} />
        {body !== undefined && (
          <details className="prose markdown-source">
            <summary>Markdown source</summary>
            <pre>
              <code>{body}</code>
            </pre>
          </details>
        )}
      </article>
      <nav className="page-navigation" aria-label="Previous and next guides">
        <div>
          {previous && (
            <Link href={`/docs/${previous.id}`} rel="prev">
              <span>← Previous</span>
              {previous.title}
            </Link>
          )}
        </div>
        <div className="next-page">
          {next && (
            <Link href={`/docs/${next.id}`} rel="next">
              <span>Next →</span>
              {next.title}
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
