---
title: Computed fields
description: Add reading time, word counts, excerpts, and custom queryable values during preparation.
section: defining-content
order: 12
---

Computed fields become ordinary queryable metadata. Use reusable helpers or write a resolver alongside the collection's schema.

## Reusable text helpers

Import helpers from `content-query/computed` in your build-only configuration:

```ts
import { defineCollection } from "content-query";
import { excerpt, readingTime, wordCount } from "content-query/computed";
import { schema } from "content-query/schema";

const posts = defineCollection({
  source: "./content/posts",
  schema: schema.object({ title: schema.string() }),
  computed: {
    readingMinutes: readingTime({ wordsPerMinute: 200 }),
    wordCount: wordCount(),
    excerpt: excerpt({ maxLength: 160 }),
  },
});

export const collections = { posts };
```

Each helper supplies a result schema and resolver. You choose the field names, and the inferred results are selectable, filterable, and sortable like other metadata:

```ts
const posts = await content
  .query("posts")
  .select("title", "readingMinutes", "wordCount", "excerpt")
  .all();
```

| Helper          | Result                                                                  | Defaults                                                    |
| --------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `readingTime()` | Whole minutes, rounded up; `0` for empty text                           | `wordsPerMinute: 200`                                       |
| `wordCount()`   | Estimated word count using the `reading-time` package's word boundaries | No additional options                                       |
| `excerpt()`     | Plain text, shortened at a word boundary when possible                  | `maxLength: 160`, including the trailing `…` when shortened |

Excerpt length counts Unicode graphemes, so emoji and combining characters stay intact. A single long word can be shortened to fit. Reading speed must be finite and positive, and maximum length must be a positive safe integer.

## Text from other sources

Helpers default to the captured `readBody()` text and `format: "markdown"`. They also accept `format: "text"` or `format: "html"`. Markdown processing removes syntax and link destinations while retaining prose, code, and image alternatives. HTML processing decodes entities, separates blocks, and ignores comments, head/script/style/template/noscript elements, and elements with the `hidden` attribute. Text mode preserves literal syntax and entities. All modes normalize whitespace; HTML processing does not evaluate CSS or execute scripts.

For JSON, YAML, or CMS fields, use a synchronous or asynchronous `from` selector. Supply its data type from your schema:

```ts
import { defineCollection } from "content-query";
import { excerpt } from "content-query/computed";
import { file } from "content-query/loaders";
import { schema } from "content-query/schema";

const articleSchema = schema.object({ description: schema.string() });

const articles = defineCollection({
  loader: file("./content/articles.json"),
  schema: articleSchema,
  computed: {
    summary: excerpt<schema.infer<typeof articleSchema>>({
      from: ({ data }) => data.description,
      format: "text",
      maxLength: 160,
    }),
  },
});

export const collections = { articles };
```

Selectors receive the same resolver context as custom fields, including `source`, `readBody()`, and `signal`. For loader-specific metadata, supply its type as the second helper type argument, such as `wordCount<ArticleData, CmsSource>(options)`. Missing text (`undefined`) produces zero reading time/words or an empty excerpt; other non-string input fails preparation with field diagnostics.

Helpers run during preparation even with `retainBody: false`. Only their computed results enter deployed metadata; the helper functions and parsers are build-only. They do not initialize syntax highlighting. Queryable headings and table-of-contents helpers remain future work.

## Custom computed fields

Write a result schema and resolver for other derived values:

```ts
computed: {
  upperTitle: {
    schema: schema.string(),
    resolve: ({ data }) => data.title.toUpperCase(),
  },
}
```

## When computation runs

Resolvers run during preparation and can be asynchronous. Their results are validated by the field schema and stored for runtime queries.

Resolvers receive the registry key `collection`, entry `id`, validated `data`, optional loader-defined `source` metadata, captured `readBody()` text when available, and cancellation `signal`. They work on one entry; collection-wide calculations belong in application queries.

## Loader-specific source metadata

The loader determines the shape of `source`. Built-in `glob()` and collection `source` shorthand provide `{ filePath }`. Multi-record `file()` also provides `key`, the original object key or array index as a string. Paths are relative to the application root and use forward slashes, such as `content/posts/hello-world.md`. They preserve the original filename even when the entry has a custom ID.

For example, store the source location as queryable metadata:

```ts
computed: {
  sourceFile: {
    schema: schema.string().optional(),
    resolve: ({ source }) => source?.filePath,
  },
  entryKey: {
    schema: schema.string(),
    resolve: ({ collection, id }) => `${collection}/${id}`,
  },
}
```

For a custom loader, declare its source metadata type once:

```ts
import { defineCollection } from "content-query";
import type { Loader } from "content-query/loaders";
import { schema } from "content-query/schema";

const cms: Loader<{ documentId: string; url: string }> = {
  name: "my-cms",
  async load({ store }) {
    store.set({
      id: "hello",
      data: { title: "Hello" },
      source: { documentId: "doc-123", url: "https://example.com/hello" },
    });
  },
};

const posts = defineCollection({
  loader: cms,
  schema: schema.object({ title: schema.string() }),
  computed: {
    canonicalUrl: {
      schema: schema.string().optional(),
      resolve: ({ source }) => source?.url,
    },
  },
});
```

`source` is inferred from the loader, while `data` is inferred from the collection schema. Source metadata is optional, so use a presence check or optional chaining. A file path is not a field on this CMS source type. Metadata from untyped loaders remains `unknown` until narrowed.

Optional source metadata is a ContentQuery extension. Existing Astro loaders work unchanged and may omit it; Astro's own store does not retain this extra field. The standard Astro `filePath` entry field remains separate. Loader authors validate external metadata and provide only supported data values. Each resolver receives its own detached metadata copy, and only explicitly computed results enter deployed content.

Metadata-only updates recompute affected entries. As with Astro, an unchanged supplied digest skips a store update; loader digests must therefore include source metadata used by computed fields.

Use [field selection](/docs/querying-content#field-selection) to request a computed field in your query results.
