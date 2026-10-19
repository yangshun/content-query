import { useState } from "react";
import {
  queryExampleCode,
  queryExamplePosts,
  type QueryExampleOptions,
} from "../feature-example-data";
import { Checkbox, CodeExample, DataResult, SamplePosts, ValidationFeedback } from "./shared";

export function TypedQueriesExample() {
  const [includeDraft, setIncludeDraft] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const options: QueryExampleOptions = {
    excludeDrafts: false,
    sort: "id-asc",
    limit: null,
    fields: includeDraft ? "title-and-draft" : "title",
  };
  const query = invalid
    ? queryExampleCode(options).replace(/\.select\([^\n]+/, '.select("title", "drafft")')
    : queryExampleCode(options);
  return (
    <div className="feature-example" aria-label="Typed queries example">
      <div className="typed-query-panels">
        <div className="typed-query-data">
          <SamplePosts label="Typed query sample posts" mutedTitles={[]} />
        </div>
        <div className="typed-query-editor">
          <div className="typed-query-controls">
            <Checkbox checked={includeDraft} onChange={setIncludeDraft}>
              Include draft field
            </Checkbox>
            <Checkbox checked={invalid} onChange={setInvalid}>
              Try a misspelled field
            </Checkbox>
          </div>
          <CodeExample
            label="Typed query"
            code={query}
            highlight={[".select("]}
            invalid={invalid}
          />
        </div>
        <div className="typed-query-output">
          {invalid ? (
            <ValidationFeedback
              label="Typed query error"
              valid={false}
              title="Unknown field"
              details={[
                { label: "Field", value: "drafft" },
                { label: "Did you mean", value: "draft" },
              ]}
            />
          ) : (
            <DataResult label="Typed query result" value={queryExamplePosts(options)} />
          )}
        </div>
      </div>
    </div>
  );
}
