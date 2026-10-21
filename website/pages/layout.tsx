import { Link, useParams, useShared } from "@void/react";
import { useId, useState, type ReactNode } from "react";
import type { NavigationShared } from "../middleware/01.docs";
import { ContentUpdates } from "../src/content-updates";
import { documentationSections } from "../src/docs-navigation";
import "../src/styles.css";

export default function Layout({ children }: { children: ReactNode }) {
  const { guideNavigation, isDocsPage } = useShared<NavigationShared>();
  const { slug } = useParams();
  const firstGuideId = guideNavigation[0]?.id;
  const currentGuideId = slug || firstGuideId;
  const navigationId = useId();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="site-layout">
      <ContentUpdates />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="site-brand" href="/" onClick={() => setIsMenuOpen(false)}>
          <svg aria-hidden="true" className="brand-mark" fill="none" viewBox="0 0 24 24">
            <path d="M6 3.5h9l4 4v13H6zM15 3.5v5h4M3 7v13.5h12" />
            <path d="M9 12h7M9 15.5h5" />
          </svg>
          ContentQuery
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <Link
            className="nav-link"
            href="/docs/introduction"
            aria-current={isDocsPage ? "page" : undefined}
          >
            Documentation
          </Link>
          <a className="nav-link" href="https://github.com/yangshun/content-query">
            GitHub
          </a>
        </nav>
      </header>
      <main className="site-content site-page" id="main-content" tabIndex={-1}>
        <div className={isDocsPage ? "docs-shell" : "home-shell"}>
          {isDocsPage ? (
            <aside className="docs-sidebar">
              <button
                aria-controls={navigationId}
                aria-expanded={isMenuOpen}
                className="docs-sidebar-trigger"
                onClick={() => setIsMenuOpen((open) => !open)}
                type="button"
              >
                <span>Documentation</span>
                <span aria-hidden="true">{isMenuOpen ? "−" : "+"}</span>
              </button>
              <nav
                className="docs-sidebar-content"
                data-open={isMenuOpen}
                id={navigationId}
                aria-label="Guide navigation"
              >
                {documentationSections.map((section) => {
                  const guides = guideNavigation.filter((guide) => guide.section === section.id);
                  if (guides.length === 0) {
                    return null;
                  }

                  return (
                    <div className="sidebar-group" key={section.id}>
                      <p className="sidebar-group-title">{section.title}</p>
                      <ul className="sidebar-items">
                        {guides.map((guide) => (
                          <li key={guide.id}>
                            <Link
                              className="sidebar-link"
                              href={`/docs/${guide.id}`}
                              aria-current={guide.id === currentGuideId ? "page" : undefined}
                              onClick={() => setIsMenuOpen(false)}
                            >
                              {guide.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </nav>
            </aside>
          ) : null}
          {children}
        </div>
      </main>
      <footer className="site-footer">
        <p>
          ContentQuery by <a href="https://github.com/yangshun">Yangshun Tay</a>
        </p>
        <a href="https://github.com/yangshun/content-query">GitHub</a>
        <p>Built with Void</p>
      </footer>
    </div>
  );
}
