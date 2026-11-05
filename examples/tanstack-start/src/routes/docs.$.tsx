import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { navigateContentLink } from "../navigation";
import { createServerFn } from "@tanstack/react-start";

const getGuide = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { guides } = await import("content-query:collections/guides");
    const guide = await guides.findFirst({
      where: { id },
      adjacent: { orderBy: { order: "asc" }, columns: { id: true, title: true } },
      columns: { id: true, title: true, description: true },
      payloads: { _rendered: true },
    });
    if (!guide) {
      throw notFound();
    }
    const { _adjacent, _payloads, ...metadata } = guide;
    return { guide: { ...metadata, html: _payloads._rendered.html }, ..._adjacent };
  });

export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => getGuide({ data: (params._splat ?? "").replace(/\/$/, "") }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.guide.title} | ContentQuery x TanStack Start`
          : "Guide not found",
      },
      { name: "description", content: loaderData?.guide.description ?? "" },
    ],
  }),
  component: GuidePage,
});

function GuidePage() {
  const { guide, previous, next } = Route.useLoaderData();
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
          onClick={(event) => navigateContentLink(event, (href) => router.navigate({ href }))}
          dangerouslySetInnerHTML={{ __html: guide.html }}
        />
      </article>
      <nav className="page-navigation" aria-label="Previous and next guides">
        <div>
          {previous && (
            <Link rel="prev" to="/docs/$" params={{ _splat: previous.id }}>
              <span>← Previous</span>
              {previous.title}
            </Link>
          )}
        </div>
        <div className="next-page">
          {next && (
            <Link rel="next" to="/docs/$" params={{ _splat: next.id }}>
              <span>Next →</span>
              {next.title}
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
