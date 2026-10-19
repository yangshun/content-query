import { Link } from "@void/react";
import type { ReactNode } from "react";
import { ContentUpdates } from "../src/content-updates";
import "../src/styles.css";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <ContentUpdates />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="wordmark" href="/">
          ContentQuery x Void
        </Link>
        <Link className="header-link" href="/">
          Documentation
        </Link>
      </header>
      {children}
      <footer className="site-footer">
        <span>ContentQuery x Void</span>
        <span>Documentation example.</span>
      </footer>
    </div>
  );
}
