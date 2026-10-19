import { useState } from "react";
import { computedExampleCode } from "../feature-example-data";
import { Choices, CodeExample } from "./shared";

export function ComputedFieldsExample() {
  const [words, setWords] = useState("600");
  const readingMinutes = Math.ceil(Number(words) / 200);
  return (
    <div className="feature-example" aria-label="Computed fields example">
      <div className="computed-example">
        <div className="computed-article">
          <h3>Hello, world</h3>
          <p className="example-reading-time" role="status" aria-label="Reading time result">
            <strong>{readingMinutes}</strong> min read
          </p>
          <Choices
            label="Article length"
            value={words}
            onChange={setWords}
            options={[
              { value: "200", label: "200 words" },
              { value: "600", label: "600 words" },
              { value: "1000", label: "1,000 words" },
            ]}
          />
        </div>
        <div>
          <CodeExample
            label="Computed field"
            code={computedExampleCode}
            highlight={["Math.ceil"]}
          />
          <details className="example-details">
            <summary>Query the computed field</summary>
            <CodeExample
              label="Typed query"
              code={
                'const post = await content\n  .query("posts")\n  .select("title", "readingMinutes")\n  .first();'
              }
              highlight={[".select("]}
            />
          </details>
        </div>
      </div>
    </div>
  );
}
