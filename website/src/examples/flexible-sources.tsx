import { useState } from "react";
import { examplePosts, sourceExamples } from "../feature-example-data";
import { CodeExample, DataResult } from "./shared";
import { SourceFormatLogo } from "./source-format-logo";

export function FlexibleSourcesExample() {
  const [format, setFormat] = useState<(typeof sourceExamples)[number]["format"]>("markdown");
  const source = sourceExamples.find((option) => option.format === format)!;
  return (
    <div className="feature-example" aria-label="Flexible sources example">
      <div className="source-format-panels">
        <div className="source-format-controls" role="group" aria-label="Source format">
          {sourceExamples.map((option) => (
            <button
              aria-pressed={option.format === format}
              key={option.format}
              onClick={() => setFormat(option.format)}
              type="button"
            >
              <SourceFormatLogo format={option.format} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <div className="source-format-files">
          <CodeExample
            label={`content/posts/${source.filename}`}
            code={source.code}
            language={source.format}
          />
          <CodeExample
            label="content-query.config.ts"
            code={`source: {\n  type: "${format}",\n  directory: "./content/posts",\n}`}
            highlight={["type:"]}
          />
        </div>
        <div className="source-format-output">
          <DataResult label="Prepared source result" value={examplePosts[0]!} />
        </div>
      </div>
    </div>
  );
}
