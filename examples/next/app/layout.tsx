import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "Documentation | ContentQuery x Next.js",
    template: "%s | ContentQuery x Next.js",
  },
  description: "Sample guides for keeping project notes organized and working with your team.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="site-shell">
          <header className="site-header">
            <Link className="wordmark" href="/">
              ContentQuery x Next.js
            </Link>
            <Link className="header-link" href="/">
              Documentation
            </Link>
          </header>
          {children}
          <footer className="site-footer">
            <span>ContentQuery x Next.js</span>
            <span>Documentation example.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
