import { useState } from "react";
import {
  exampleAuthors,
  examplePosts,
  relationshipExampleCode,
  relationshipQueryCode,
} from "../feature-example-data";
import { Checkbox, Choices, CodeExample, DataResult } from "./shared";

const relationshipPosts = examplePosts.slice(0, 3);

export function RelationshipsExample() {
  const [includeAuthor, setIncludeAuthor] = useState(false);
  const [authorId, setAuthorId] = useState("ada");
  const author = exampleAuthors.find((entry) => entry.id === authorId)!;
  const posts = relationshipPosts.filter((post) => post.authorId === author.id);
  const fullQuery = relationshipQueryCode.replace('"ada"', JSON.stringify(author.id));
  const query = includeAuthor
    ? fullQuery
    : fullQuery.replace('  .with("author", (author) => author.select("name"))\n', "");
  return (
    <div className="feature-example" aria-label="Relationships example">
      <div className="relationship-columns">
        <div>
          <div className="example-record-groups" data-connected={includeAuthor}>
            <section className="example-record-group" aria-label="Posts">
              <h3>posts</h3>
              <ul>
                {relationshipPosts.map((post) => (
                  <li key={post.id} data-selected={post.authorId === authorId}>
                    {post.title}
                    <small>
                      authorId: <code>{post.authorId}</code>
                    </small>
                  </li>
                ))}
              </ul>
            </section>
            <section className="example-record-group" aria-label="Authors">
              <h3>authors</h3>
              <ul>
                {exampleAuthors.map((entry) => (
                  <li key={entry.id} data-selected={entry.id === authorId}>
                    {entry.name}
                    <small>
                      id: <code>{entry.id}</code>
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        <CodeExample label="Relationship definition" code={relationshipExampleCode} />
        <div>
          <div className="relationship-query-controls">
            <Choices
              label="Post author"
              value={authorId}
              onChange={setAuthorId}
              options={exampleAuthors.map((entry) => ({
                value: entry.id,
                label: entry.name.split(" ")[0] ?? entry.name,
              }))}
            />
            <Checkbox checked={includeAuthor} onChange={setIncludeAuthor}>
              Include author name
            </Checkbox>
          </div>
          <CodeExample
            label="Query"
            code={query}
            highlight={includeAuthor ? [".with(", ".where("] : [".where("]}
          />
        </div>
        <div>
          <DataResult
            label="Related posts result"
            value={posts.map((post) => ({
              title: post.title,
              ...(includeAuthor ? { author: { name: author.name } } : {}),
            }))}
          />
        </div>
      </div>
    </div>
  );
}
