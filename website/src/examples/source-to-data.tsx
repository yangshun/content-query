import { sourceToDataExample } from "../feature-example-data";
import { CodeExample, DataResult } from "./shared";

export function SourceToDataExample() {
  return (
    <div className="feature-example" aria-label="Source to data example">
      <div className="source-to-data">
        <div className="source-to-data-stage">
          <CodeExample
            label={`content/posts/${sourceToDataExample.filename}`}
            code={sourceToDataExample.source}
            language="markdown"
          />
        </div>
        <div className="source-to-data-stage">
          <CodeExample label="content-query.config.ts" code={sourceToDataExample.schema} />
        </div>
        <div className="source-to-data-stage">
          <CodeExample label="app.ts" code={sourceToDataExample.query} />
        </div>
        <div className="source-to-data-stage">
          <DataResult label="Source to data result" value={sourceToDataExample.data} />
        </div>
      </div>
    </div>
  );
}
