import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { onContentUpdate } from "content-query:client";
import "../styles.css";

export const Route = createRootRoute({ component: Root, notFoundComponent: NotFound });

function NotFound() {
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

function Root() {
  const router = useRouter();
  useEffect(() => onContentUpdate(() => router.invalidate()), [router]);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        <div className="site-shell">
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <header className="site-header">
            <Link className="wordmark" to="/">
              ContentQuery x TanStack Start
            </Link>
            <Link className="header-link" to="/">
              Documentation
            </Link>
          </header>
          <Outlet />
          <footer className="site-footer">
            <span>ContentQuery x TanStack Start</span>
            <span>Documentation example.</span>
          </footer>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
