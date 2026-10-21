import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getNavigation = createServerFn({ method: "GET" }).handler(async () => {
  const { content } = await import("content-query:server");
  return content.query.guides.findMany({
    columns: { id: true, title: true },
    orderBy: { order: "asc" },
  });
});

export const Route = createFileRoute("/docs")({
  loader: () => getNavigation(),
  staleTime: Infinity,
  component: DocsLayout,
});

function DocsLayout() {
  const guides = Route.useLoaderData();
  return (
    <div className="docs-layout">
      <nav className="guide-nav" aria-label="Guide navigation">
        <p>Guides</p>
        <ul>
          {guides.map((guide) => (
            <li key={guide.id}>
              <Link
                to="/docs/$"
                params={{ _splat: guide.id }}
                activeOptions={{ exact: true }}
                activeProps={{ "aria-current": "page" }}
              >
                {guide.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
