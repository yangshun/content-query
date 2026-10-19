import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRevalidator,
} from "react-router";
import { useEffect, type ReactNode } from "react";
import { onContentUpdate } from "content-query:client";
import "./styles.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <div className="site-shell">
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <header className="site-header">
            <Link className="wordmark" to="/">
              ContentQuery x React Router
            </Link>
            <Link className="header-link" to="/">
              Documentation
            </Link>
          </header>
          {children}
          <footer className="site-footer">
            <span>ContentQuery x React Router</span>
            <span>Documentation example.</span>
          </footer>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const revalidator = useRevalidator();
  useEffect(() => onContentUpdate(() => revalidator.revalidate()), [revalidator]);
  return <Outlet />;
}

export function ErrorBoundary() {
  return (
    <main className="home" id="main-content" tabIndex={-1}>
      <div className="home-intro">
        <h1>Guide not found.</h1>
        <p>This guide is unavailable. Browse the documentation to find what you need.</p>
        <p>
          <Link to="/">Back to the guides</Link>
        </p>
      </div>
    </main>
  );
}
