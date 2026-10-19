import { Link, useRouter } from "@void/react";
import { navigateContentLink } from "../../src/navigation";
import type { Props } from "./[...slug].server";

export default function GuidePage({ guide, headings, previous, next }: Props) {
  const router = useRouter();

  return (
    <>
      <article className="docs-article">
        <header className="article-header">
          <h1>{guide.title}</h1>
          <p className="page-description">{guide.description}</p>
        </header>
        <div
          className="article-body"
          onClick={(event) => navigateContentLink(event, (href) => router.visit(href))}
          dangerouslySetInnerHTML={{ __html: guide.html }}
        />
        <nav className="doc-pagination" aria-label="Previous and next guides">
          {previous ? (
            <Link
              className="doc-pagination-link"
              data-direction="previous"
              href={`/docs/${previous.id}`}
              rel="prev"
            >
              <span className="doc-pagination-label">← Previous</span>
              <span className="doc-pagination-title">{previous.title}</span>
            </Link>
          ) : (
            <div />
          )}
          {next && (
            <Link
              className="doc-pagination-link"
              data-direction="next"
              href={`/docs/${next.id}`}
              rel="next"
            >
              <span className="doc-pagination-label">Next →</span>
              <span className="doc-pagination-title">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      {headings.length > 0 ? (
        <aside className="docs-toc">
          <p className="toc-title">On this page</p>
          <nav aria-label="On this page">
            {headings.map((heading) => (
              <a
                className="toc-link"
                data-depth={heading.depth}
                href={`#${heading.slug}`}
                key={heading.slug}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        </aside>
      ) : null}
    </>
  );
}
