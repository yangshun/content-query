import { NavLink, Outlet, useLoaderData } from "react-router";
import { content } from "content-query:server";

export async function loader() {
  return {
    guides: await content.findMany("guides", {
      select: { id: true, title: true },
      orderBy: { order: "asc" },
    }),
  };
}

export default function DocsLayout() {
  const { guides } = useLoaderData<typeof loader>();
  return (
    <div className="docs-layout">
      <nav className="guide-nav" aria-label="Guide navigation">
        <p>Guides</p>
        <ul>
          {guides.map((guide) => (
            <li key={guide.id}>
              <NavLink to={`/docs/${guide.id}/`} end>
                {guide.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
