import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideContent } from "../content";
import { content } from "../../../.content-query/server.js";

type GuideProps = { params: Promise<{ slug: string[] }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const guides = await content.findMany("guides", {
    select: { id: true },
    orderBy: [{ order: "asc" }],
  });
  return guides.map((guide) => ({ slug: guide.id.split("/") }));
}

export async function generateMetadata({ params }: GuideProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await content.findFirst("guides", {
    where: { id: slug.join("/") },
    select: { title: true, description: true },
  });
  if (!guide) {
    notFound();
  }
  return { title: guide.title, description: guide.description };
}

export default async function GuidePage({ params }: GuideProps) {
  const { slug } = await params;
  const id = slug.join("/");
  const guide = await content.findFirst("guides", {
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      _adjacent: { orderBy: { order: "asc" }, select: { id: true, title: true } },
    },
  });
  if (!guide) {
    notFound();
  }

  const { html } = await content.render("guides", id);
  const { previous, next } = guide._adjacent;

  return (
    <main className="guide-main" id="main-content" tabIndex={-1}>
      <article>
        <header className="article-header">
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
        </header>
        <GuideContent html={html} />
      </article>
      <nav className="page-navigation" aria-label="Previous and next guides">
        <div>
          {previous && (
            <Link href={`/docs/${previous.id}/`} rel="prev">
              <span>← Previous</span>
              {previous.title}
            </Link>
          )}
        </div>
        <div className="next-page">
          {next && (
            <Link href={`/docs/${next.id}/`} rel="next">
              <span>Next →</span>
              {next.title}
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
