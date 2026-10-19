import { useState } from "react";
import type { ContentRenderResult } from "content-query";
import { markdownExample } from "../feature-example-data";
import { Choices, CodeExample, CodeResult, DataResult } from "./shared";

export function MarkdownRenderingExample({ rendered }: { rendered: ContentRenderResult }) {
  const [view, setView] = useState<"preview" | "html" | "headings">("preview");
  return (
    <div className="feature-example" aria-label="Markdown rendering example">
      <div className="markdown-controls">
        <Choices
          label="Markdown output"
          value={view}
          onChange={setView}
          options={[
            { value: "preview", label: "Article preview" },
            { value: "html", label: "HTML" },
            { value: "headings", label: "Headings" },
          ]}
        />
      </div>
      <div className="markdown-panels">
        <CodeExample
          label="content/posts/hello-world.md"
          code={markdownExample}
          language="markdown"
        />
        {view === "preview" ? (
          <div
            className="example-preview"
            aria-label="Rendered article preview"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        ) : view === "html" ? (
          <CodeResult label="Rendered HTML" code={rendered.html} language="html" />
        ) : (
          <DataResult label="Headings result" value={rendered.headings} />
        )}
      </div>
      <details className="example-details">
        <summary>Render API</summary>
        <CodeExample
          label="content.render()"
          code={'const article = await content.render(\n  "examples",\n  "hello-world",\n);'}
        />
      </details>
    </div>
  );
}
