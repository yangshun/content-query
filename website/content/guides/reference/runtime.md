---
title: Runtime API
description: Query prepared metadata and request bodies and rendered content on the server.
section: reference
order: 53
---

## Collection entries

Each collection has its own generated entry. It exports one value, the collection, named after it, plus that collection's types. A module's imports therefore list every collection its queries load.

| Host                                        | Import                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| [Vite](/docs/integrations/vite)             | `import { posts } from "content-query:collections/posts"`              |
| [Next.js](/docs/integrations/next)          | `import { posts } from "#content-query/posts"`                         |
| [Standalone](/docs/integrations/standalone) | `import { posts } from "./.content-query/collections/posts/server.js"` |

The export name and import path segment is the collection name when it is a valid identifier. Otherwise ContentQuery converts it: `blog-posts` becomes `blogPosts`, imported from `#content-query/blogPosts`; a leading digit gets an `_` prefix; and reserved words, `default`, and Windows device names such as `con` and `aux` get a `Collection` suffix. Export names that collide, ignoring letter case, fail the build.

A [build session](/docs/integrations/standalone#build-api) exposes the same collections as `session.collections.posts`, keyed by collection name.

## Generated output

The generated backend writes one directory per collection:

```text
.content-query/
  package.json
  types.d.ts
  collections/
    posts/
      server.js
      server.d.ts
```

Each `collections/<export name>/` directory also holds that collection's data modules. `types.d.ts` declares the Vite virtual modules. Include `.content-query/**/*.d.ts` in `tsconfig.json`.

## Collection methods

| Method                                                                                   | Purpose                                                                                                              |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `select`, `where`, `orderBy`, `limit`, `offset`, `with`, `withPayload`, `selectAdjacent` | Start a fluent query, which selects nothing until `.select(...fields)` or another request.                           |
| `byId(id)`                                                                               | Start a fluent query for one entry, which awaits to that entry or `undefined`.                                       |
| `findMany(options)`, `findFirst(options)`, `paginate(options)`                           | Relational queries.                                                                                                  |
| `count(options?)`                                                                        | Filtered parent count before pagination; `count()` counts every entry.                                               |
| `using(...collections)`                                                                  | A handle that also loads the given collections, for [relationships](/docs/relationships#supply-related-collections). |

Await a selected fluent builder directly or call `.all()` / `.execute()` to return an array. A builder runs only when awaited; the terminals below start it immediately. `.first()` returns one entry or `undefined`; `.count()` returns the matching parent count and needs no selection. `.paginate({ page, size })` and `.paginate({ size, after })` return one [page](/docs/querying-content#pagination) with page-number or cursor details.

The relational methods use `columns`, `with`, `where`, `orderBy`, `limit`, `offset`, `adjacent`, and `payloads` options. Queries return only what they select, not even `id` implicitly: omitting `columns` selects no fields, and a query must select fields, relationships, payloads, or adjacency.

A [`queryStyle`](/docs/reference/configuration#query-style) export can disable one set of starters.

## Payloads

| Payload     | Value                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `_body`     | Retained text, or `undefined` when the entry has none.                                         |
| `_rendered` | `{ html, headings }`; entries without a rendering path reject the query with `not-renderable`. |

Request payloads with relational `payloads: { _rendered: true }` or fluent `.withPayload("_rendered")`. Results carry them under `_payloads`. Payloads load after filtering and pagination, from the same revision, and are unavailable in counts and adjacent entries. JSON, YAML, and TOML sources and `file()` collections offer no built-in payloads, and `BodyLoader` collections offer only `_body`.

Collections can also declare [custom payloads](/docs/payloads). Request one without variants with `true`, or name every variant key: `payloads: { detail: { locale: "fr-FR" } }` or `.withPayload("detail", { locale: "fr-FR" })`. A combination the entry lacks rejects with `variant-not-found`. A key can list [fallback values](/docs/payloads#fallback-variants) to try in order, such as `{ locale: ["fr-FR", "en-US"] }`.

## Generated types

Each entry exports types named `Content` plus its export name, capitalized and made singular by dropping one trailing `s` that does not follow another `s`:

| Collection       | Entry type             | Payload type                  |
| ---------------- | ---------------------- | ----------------------------- |
| `posts`          | `ContentPost`          | `ContentPostPayload`          |
| `projectsTracks` | `ContentProjectsTrack` | `ContentProjectsTrackPayload` |
| `coding`         | `ContentCoding`        | `ContentCodingPayload`        |

`ContentPost` is a full entry: its ID, validated metadata, and computed fields. `ContentCodingPayload<"detail">` is one payload's value. For an irregular plural, set `typeName` on the collection; `defineCollection({ ..., typeName: "Category" })` generates `ContentCategory`. Two collections that generate the same type name fail the build.

Queries return only the fields they select. Pass those field names to type the results, for example as component props:

```ts
import { guides, type ContentGuide } from "content-query:collections/guides";

type GuideLink = ContentGuide<"id" | "title">;

const links: GuideLink[] = await guides.select("id", "title").all();
```

A picked entry has every selected key, and an optional field that an entry omits reads as `undefined`, so it matches what the query returns. Field names the collection does not define are type errors.

### Field descriptions

To describe a field, write a JSDoc comment above it in the schema or above a computed field's name:

```ts
schema: schema.object({
  /** The headline, also used as the page title. */
  title: schema.string(),
}),
```

Editors show the comment when you hover `title` on `ContentGuide`, on `ContentGuide<"id" | "title">`, and on any query result that selects it, including related entries and `_adjacent` neighbors. Zod's `.describe()` and `.meta()` store descriptions at runtime only, so they don't show up in types.

To import only types, such as in a Client Component, write `import type { ContentPost } from "#content-query/posts"`. That spelling works under every TypeScript configuration; a plain `import { ContentPost }` also works unless `verbatimModuleSyntax` is on. For helpers that accept collections, `content-query/runtime` exports the `Collection`, `CollectionHandles`, and `AnyCollection` types.

Keep runtime imports on the server. See [querying content](/docs/querying-content) and [rendering content](/docs/rendering-content) for usage.
