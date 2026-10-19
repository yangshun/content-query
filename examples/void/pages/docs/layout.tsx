import { Link, useParams, useShared } from "@void/react";
import type { ReactNode } from "react";
import type { NavigationShared } from "../../middleware/01.docs";

export default function DocsLayout({ children }: { children: ReactNode }) {
  const { guideNavigation } = useShared<NavigationShared>();
  const { slug } = useParams();
  return (
    <div className="docs-layout">
      <nav className="guide-nav" aria-label="Guide navigation">
        <p>Guides</p>
        <ul>
          {guideNavigation.map((guide) => (
            <li key={guide.id}>
              <Link
                href={`/docs/${guide.id}`}
                aria-current={slug === guide.id ? "page" : undefined}
              >
                {guide.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
