import { useEffect, type ReactNode } from "react";
import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRevalidator,
} from "react-router";
import { onContentUpdate } from "content-query:client";
import { useLoadMetrics } from "./load-metrics";
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
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const revalidator = useRevalidator();
  const loadMetrics = useLoadMetrics();
  useEffect(() => onContentUpdate(() => revalidator.revalidate()), [revalidator]);
  return (
    <>
      <header className="site-header">
        <Link to="/">ContentQuery MDX</Link>
      </header>
      <Outlet context={loadMetrics} />
    </>
  );
}

export function ErrorBoundary() {
  return (
    <main>
      <h1>Guide not found</h1>
      <Link to="/">Browse guides</Link>
    </main>
  );
}
