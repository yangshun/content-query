import { Link, useLoaderData, useNavigate, type MetaFunction } from "react-router";
import { content } from "content-query:server";
import { navigateContentLink } from "../navigation";

export async function loader({ params }: { params: Record<string, string | undefined> }) {
  const id = (params["*"] ?? "").replace(/\/$/, "");
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
    throw new Response("Guide not found", { status: 404 });
  }
  const { html } = await content.render("guides", id);
  return { guide: { ...guide, html }, ...guide._adjacent };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  {
    title: loaderData
      ? `${loaderData.guide.title} | ContentQuery x React Router`
      : "Guide not found",
  },
  { name: "description", content: loaderData?.guide.description ?? "" },
];

export default function GuidePage() {
  const { guide, previous, next } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <main className="guide-main" id="main-content" tabIndex={-1}>
      <article>
        <header className="article-header">
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
        </header>
        <div
          className="prose"
          onClick={(event) => navigateContentLink(event, navigate)}
          dangerouslySetInnerHTML={{ __html: guide.html }}
        />
      </article>
      <nav className="page-navigation" aria-label="Previous and next guides">
        <div>
          {previous && (
            <Link rel="prev" to={`/docs/${previous.id}/`}>
              <span>← Previous</span>
              {previous.title}
            </Link>
          )}
        </div>
        <div className="next-page">
          {next && (
            <Link rel="next" to={`/docs/${next.id}/`}>
              <span>Next →</span>
              {next.title}
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
