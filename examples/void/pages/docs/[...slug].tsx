import { Link, useRouter } from "@void/react";
import { navigateContentLink } from "../../src/navigation";
import type { Props } from "./[...slug].server";

export default function GuidePage({ guide, previous, next }: Props) {
  const router = useRouter();

  return (
    <main className="guide-main" id="main-content" tabIndex={-1}>
      <article>
        <header className="article-header">
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
        </header>
        <div
          className="prose"
          onClick={(event) => navigateContentLink(event, (href) => router.visit(href))}
          dangerouslySetInnerHTML={{ __html: guide.html }}
        />
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
