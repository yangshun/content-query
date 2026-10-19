import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getGuides = createServerFn({ method: "GET" }).handler(async () => {
  const { content } = await import("content-query:server");
  return content.findMany("guides", {
    select: { id: true, title: true, description: true },
    orderBy: { order: "asc" },
  });
});

export const Route = createFileRoute("/")({
  loader: () => getGuides(),
  head: () => ({
    meta: [
      { title: "Documentation | ContentQuery x TanStack Start" },
      {
        name: "description",
        content: "Sample guides for keeping project notes organized and working with your team.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const guides = Route.useLoaderData();
  return (
    <main className="home" id="main-content" tabIndex={-1}>
      <div className="home-intro">
        <h1>Documentation</h1>
        <p>Sample guides for keeping project notes organized and working with your team.</p>
      </div>
      <section className="guide-index" aria-labelledby="guides-heading">
        <h2 id="guides-heading">Guides</h2>
        <ol className="guide-list">
          {guides.map((guide, index) => (
            <li key={guide.id}>
              <Link className="guide-row" to="/docs/$" params={{ _splat: guide.id }}>
                <span className="guide-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{guide.title}</h3>
                  <p>{guide.description}</p>
                </div>
                <span className="guide-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
