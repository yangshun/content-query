import { Link } from "@void/react";
import type { Props } from "./index.server";

export default function HomePage({ guides }: Props) {
  return (
    <main className="home" id="main-content" tabIndex={-1}>
      <div className="home-intro">
        <h1>Documentation</h1>
        <p>Sample guides for keeping project notes organized and working with your team.</p>
      </div>
      <section className="guide-index" aria-labelledby="guides-heading">
        <h2 id="guides-heading">Guides</h2>
        <ol className="guide-list">
          {guides.map((guide, index) => (
            <li key={guide.id}>
              <Link className="guide-row" href={`/docs/${guide.id}`}>
                <span className="guide-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{guide.title}</h3>
                  <p>{guide.description}</p>
                </div>
                <span className="guide-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
