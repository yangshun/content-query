import { useState } from "react";
import {
  examplePosts,
  queryExampleCode,
  queryExamplePosts,
  type QueryExampleOptions,
} from "../feature-example-data";
import { Checkbox, CodeExample, DataResult, SamplePosts } from "./shared";

const initialOperations = { filter: false, select: true, sort: false, limit: false };

export function QuerySyntaxExample() {
  const [operations, setOperations] = useState(initialOperations);
  const options: QueryExampleOptions = {
    excludeDrafts: operations.filter,
    sort: operations.sort ? "title-desc" : "id-asc",
    limit: operations.limit ? 2 : null,
    fields: operations.select ? "title" : "title-and-draft",
  };
  const posts = queryExamplePosts(options);
  const highlight = [
    ...(operations.filter ? [".where(", "where:"] : []),
    ...(operations.select ? [".select(", "select:"] : []),
    ...(operations.sort ? [".orderBy(", "orderBy:"] : []),
    ...(operations.limit ? [".limit(", "limit:"] : []),
  ];
  return (
    <div className="feature-example" aria-label="Flexible query syntax example">
      <div className="query-comparison">
        <div className="query-comparison-panel">
          <SamplePosts
            mutedTitles={examplePosts
              .filter((post) => !posts.some((result) => result.title === post.title))
              .map((post) => post.title)}
          />
        </div>
        <div className="query-comparison-panel">
          <div className="example-query-controls" role="group" aria-label="Query operations">
            {(
              [
                { id: "filter", label: "Exclude drafts" },
                { id: "select", label: "Select title only" },
                { id: "sort", label: "Title Z–A" },
                { id: "limit", label: "First 2 posts" },
              ] as const
            ).map((operation) => (
              <Checkbox
                key={operation.id}
                checked={operations[operation.id]}
                onChange={(enabled) =>
                  setOperations((current) => ({ ...current, [operation.id]: enabled }))
                }
              >
                {operation.label}
              </Checkbox>
            ))}
          </div>
          <button
            className="example-reset"
            onClick={() => setOperations(initialOperations)}
            type="button"
          >
            Reset
          </button>
        </div>
        <div className="query-comparison-panel">
          <CodeExample label="Fluent" code={queryExampleCode(options)} highlight={highlight} />
          <CodeExample
            label="Object"
            code={queryExampleCode(options, "prisma-style")}
            highlight={highlight}
          />
        </div>
        <div className="query-comparison-panel">
          <DataResult label="Shared query result" value={posts} />
        </div>
      </div>
    </div>
  );
}
