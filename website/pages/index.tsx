import { Link } from "@void/react";
import { ContentFlowDiagram } from "../src/content-flow";
import { ComputedFieldsExample } from "../src/examples/computed-fields";
import { FlexibleSourcesExample } from "../src/examples/flexible-sources";
import { MarkdownRenderingExample } from "../src/examples/markdown-rendering";
import { QuerySyntaxExample } from "../src/examples/query-syntax";
import { RelationshipsExample } from "../src/examples/relationships";
import { SourceToDataExample } from "../src/examples/source-to-data";
import { TypedCollectionsExample } from "../src/examples/typed-collections";
import { TypedQueriesExample } from "../src/examples/typed-queries";
import { WorkflowsExample } from "../src/examples/workflows";
import type { Props } from "./index.server";
import "../src/homepage.css";

export default function Homepage({ renderedExample }: Props) {
  const features = [
    {
      id: "source-to-data",
      title: "From source to data",
      description:
        "Start with a content file, define its schema, and query the fields your application needs.",
      href: "/docs/how-it-works",
      example: <SourceToDataExample />,
    },
    {
      id: "query-syntax",
      title: "Flexible type-safe query syntax",
      description:
        "Compare fluent chains and object-based queries. The same controls update both examples and their shared result.",
      href: "/docs/querying-content",
      example: <QuerySyntaxExample />,
    },
    {
      id: "typed-queries",
      title: "Typed queries",
      description: "Select the fields you need. Catch misspelled fields before running your code.",
      href: "/docs/querying-content",
      example: <TypedQueriesExample />,
    },
    {
      id: "relationships",
      title: "Relationships",
      description:
        "Connect posts to their authors. Select related fields in one query, with authored references checked during preparation.",
      href: "/docs/relationships",
      example: <RelationshipsExample />,
    },
    {
      id: "flexible-sources",
      title: "Flexible sources",
      description:
        "Markdown, JSON, YAML, or TOML. Different formats, the same query API. Use Astro-compatible or custom loaders for other sources.",
      href: "/docs/sources-and-loaders",
      example: <FlexibleSourcesExample />,
    },
    {
      id: "typed-collections",
      title: "Typed collections",
      description:
        "Validate content with Zod or another Standard Schema library. Query results follow your schema.",
      href: "/docs/collections-and-schemas",
      example: <TypedCollectionsExample />,
    },
    {
      id: "computed-fields",
      title: "Computed fields",
      description:
        "Add reading times and other derived fields during preparation. Select them alongside authored metadata.",
      href: "/docs/computed-fields",
      example: <ComputedFieldsExample />,
    },
    {
      id: "markdown-rendering",
      title: "Markdown rendering",
      description:
        "Get HTML, syntax highlighting, and headings for your table of contents. Article output stays separate from metadata queries.",
      href: "/docs/rendering-content",
      example: <MarkdownRenderingExample rendered={renderedExample} />,
    },
    {
      id: "workflows",
      title: "Vite or standalone",
      description:
        "Keep content fresh during development, or prepare portable artifacts for your build. Your framework owns routes and rendering.",
      href: "/docs/integrations/vite",
      example: <WorkflowsExample />,
    },
  ];

  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <h1 id="home-title">
            From content files
            <br />
            <span>to typed queries.</span>
          </h1>
          <p className="home-description">
            Turn Markdown and structured data into validated collections, connected queries, and
            rendered articles. Bring your own framework.
          </p>
          <div className="home-actions">
            <Link className="home-primary-link" href="/docs/quick-start">
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link className="home-text-link" href="/docs/introduction">
              Read the docs
            </Link>
          </div>
        </div>
        <ContentFlowDiagram />
      </section>
      <div className="home-features">
        {features.map((feature) => (
          <section
            className="home-feature"
            id={feature.id}
            key={feature.id}
            aria-labelledby={`${feature.id}-title`}
          >
            <div className="home-feature-description">
              <div>
                <h2 id={`${feature.id}-title`}>{feature.title}</h2>
                <p>{feature.description}</p>
              </div>
              <Link className="home-text-link" href={feature.href}>
                Learn more <span aria-hidden="true">→</span>
              </Link>
            </div>
            {feature.example}
          </section>
        ))}
      </div>
      <section className="home-start" aria-labelledby="home-start-title">
        <div>
          <h2 id="home-start-title">Make your first collection.</h2>
          <p>Start with a Markdown file and a schema.</p>
        </div>
        <Link className="home-primary-link" href="/docs/quick-start">
          Follow the quick start <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
