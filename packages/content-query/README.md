# ContentQuery

Typed collections and queries for Markdown, JSON, YAML, and TOML. ContentQuery validates your content at build time and produces portable data your application can query and render on the server.

Use it with your existing framework. Your application owns its routes, layouts, and public URLs; production reads prepared content without loading the original source files.

## Features

- **Typed schemas.** Validate metadata with bundled schema builders or any Standard Schema V1 provider, with inferred TypeScript types.
- **Flexible sources.** Load local files, use Astro-compatible content loaders, or write your own loader.
- **Queries and relationships.** Select fields, filter, sort, paginate, and load related entries with validated references.
- **Per-collection entries.** Import each collection from its own generated module with named types such as `ContentPost`, so a route bundles and traces only the collections it uses.
- **Markdown rendering.** Request HTML, headings, and syntax highlighting as query payloads, loaded only when a query asks for them.
- **Custom payloads.** Declare schema-validated per-entry data, optionally by variant such as locale, resolved during the build from tracked related files, and loaded only when a query names it. Development edits re-resolve only the variants whose files changed.
- **Optional MDX companion.** [`@content-query/mdx`](https://github.com/yangshun/content-query/tree/main/packages/mdx) supplies React islands and ordinary React document modules with Vite SSR. Core has no MDX or React dependency.
- **Framework integrations.** Use Vite, Next.js, or the standalone CLI, with content updates during development.

## Usage

Requires Node.js 22.12 or later. Install ContentQuery:

```sh
npm install content-query
```

Define `content-query.config.ts`:

```ts
import { defineCollection } from "content-query";
import { schema } from "content-query/schema";

export const collections = {
  posts: defineCollection({
    source: "./content/posts",
    schema: schema.object({
      title: schema.string(),
      draft: schema.boolean().default(false),
    }),
  }),
};
```

Add Markdown files with `title` frontmatter under `content/posts/`, then build:

```sh
npx content-query build
```

Each collection gets its own generated entry, which exports the collection under its name. Query it from server code:

```ts
import { posts } from "./.content-query/collections/posts/server.js";
import { eq } from "content-query/query";

const summaries = await posts
  .select("id", "title")
  .where((fields) => eq(fields.draft, false))
  .orderBy("title");

const post = await posts.findFirst({
  where: { id: summaries[0]!.id },
  payloads: { _rendered: true },
});
const { html, headings } = post!._payloads._rendered;
```

Built-in payloads are `_body` and `_rendered`. JSON, YAML, and TOML sources and `file()` collections have none, and a custom `BodyLoader` offers only `_body`. A query for a missing entry returns `undefined`.

An entry imports only its own collection's data, so a route that imports `posts` never bundles or traces another collection. With Vite, import from `content-query:collections/posts`. Elsewhere, such as in Next.js, map the entries in `package.json` to import `{ posts }` from `#content-query/posts` at any directory depth:

```json
{
  "imports": {
    "#content-query/*": "./.content-query/collections/*/server.js"
  }
}
```

Queries return only the data they select, not even `id` implicitly. A query must select fields, include a relationship, request a payload, or select adjacent entries; otherwise it fails to type-check and throws an `invalid-query` error. Counts need no selection.

To follow a relationship, pass its target collection to `using()`. Nothing related loads implicitly:

```ts
import { authors } from "#content-query/authors";
import { posts } from "#content-query/posts";

const withAuthors = await posts.using(authors).findMany({
  columns: { title: true },
  with: { author: { columns: { name: true } } },
});
```

A relationship whose target was not supplied is a type error and throws `invalid-query`. Nested relationships need every collection they reach, such as `posts.using(authors, publishers)`. Self-relationships need nothing.

Each entry also exports the collection's types. `ContentPost` is a full entry; pass the selected fields to type query results, such as props for a list component:

```ts
import type { ContentPost } from "#content-query/posts";

type PostLink = ContentPost<"id" | "title">; // What select("id", "title") returns.
```

To describe a field, write a JSDoc comment above it in the schema or above a computed field's name. Editors show the comment when you hover that field on `ContentPost`, on `ContentPost<"id" | "title">`, and on query results:

```ts
schema: schema.object({
  /** The headline, also used as the page title. */
  title: schema.string(),
}),
```

Zod's `.describe()` and `.meta()` store descriptions at runtime only, so they don't show up in types.

Type names are `Content` plus the export name, capitalized and made singular by dropping one trailing `s` (`jobs` gives `ContentJob`, `coding` gives `ContentCoding`). Set `typeName: "Category"` in `defineCollection()` for irregular plurals. Declared payloads are typed as `ContentPostPayload<"detail">`. Collection names that are not identifiers are converted for the export and import path, such as `blog-posts` to `blogPosts`; two collections that would share an export or type name fail the build.

Paginate root queries in one call. `paginate({ page: 2, size: 10 })` returns `items`, `total`, `page`, `pageCount`, `hasNextPage`, and `hasPreviousPage` for numbered archive pages. `paginate({ size: 10, after: previous.endCursor })` returns cursor pages with `startCursor` and `endCursor` for "load more" lists. Both work in fluent queries and in `posts.paginate()`; see [pagination](https://github.com/yangshun/content-query/blob/main/docs/API.md#pagination).

Add `.content-query/` to `.gitignore`. Follow the quick start for a complete walkthrough, or choose a framework example below.

## Documentation

- [Quick start](https://github.com/yangshun/content-query/blob/main/website/content/guides/quick-start.md)
- [Framework examples](https://github.com/yangshun/content-query/blob/main/examples/README.md)
- [API and usage](https://github.com/yangshun/content-query/blob/main/docs/API.md)
- [Guides and reference](https://github.com/yangshun/content-query/blob/main/docs/README.md)

The Vite integration supports Vite 8, and the Next.js integration supports Next.js 15 and 16. Both integrations are optional; standalone builds and queries require neither framework.

To allow only one query API, export `queryStyle` from the config: `export const queryStyle = "relational";` keeps `posts.findMany()`, `findFirst()`, `paginate()`, and `count(options)`, and `"fluent"` keeps `posts.select()` and the other fluent starters. `count()` without options works in both. Generated types report the disabled API in the editor, and the runtime throws an `invalid-query` error for it. See [query style](https://github.com/yangshun/content-query/blob/main/docs/API.md#query-style).

Pass `contentQuery()` directly to Vite or Vite+'s `plugins` array. No `Plugin` type cast is needed; workspace consumers share the pinned toolchain versions in the dependency catalog.

Repository development checks package types and isolated consumers with [tsrs](https://github.com/oxc-project/tsrs). Run `vp run check` in the package directory for formatting, linting, and type checks; build tools use the shared TypeScript 6 compatibility package for its `6.0.3` JavaScript API. Native TypeScript `7.1.0-beta` is available at the repository root as `vp exec tsc`.

Build integrations can reuse the active source session without reading schemas or bodies. `ContentSession.sources()` from `content-query/build` returns an immutable `{ revision, entries: [{ collection, id, filePath? }] }` snapshot; `session.subscribe(listener)` reports successful publications (`{ type: "ready", snapshot }`) and errors (`{ type: "error", error }`) and returns an unsubscribe function. Revisions are opaque and session-scoped. In Vite, `contentQuery().api.prepare()` asynchronously prepares the shared session and returns its source snapshot, and `.api.subscribe()` forwards subsequent events. The [MDX architecture](https://github.com/yangshun/content-query/blob/main/docs/MDX-ARCHITECTURE.md) documents its use by companion integrations.

`prepare()` waits for pending preparation and rejects while validation errors are active. Successful unchanged reads reuse the frozen snapshot; publications supply a new revision. Subscribers can observe errors and recovery, and unsubscribing stops subsequent notifications. Development integrations should let core display recoverable errors without aborting the server or replacing the host's refresh subscription.

Released under the [MIT license](https://github.com/yangshun/content-query/blob/main/LICENSE).
