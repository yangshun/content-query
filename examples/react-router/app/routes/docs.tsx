import { NavLink, Outlet, useLoaderData } from "react-router";
import { guides } from "content-query:collections/guides";

export async function loader() {
  return {
    guides: await guides.findMany({
      columns: { id: true, title: true },
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
