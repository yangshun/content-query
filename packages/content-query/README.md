# ContentQuery

Typed collections and queries for Markdown, JSON, YAML, and TOML. ContentQuery validates your content at build time and produces portable data your application can query and render on the server.

Use it with your existing framework. Your application owns its routes, layouts, and public URLs; production reads prepared content without loading the original source files.

## Features

- **Typed schemas.** Validate metadata with bundled schema builders or any Standard Schema V1 provider, with inferred TypeScript types.
- **Flexible sources.** Load local files, use Astro-compatible content loaders, or write your own loader.
- **Queries and relationships.** Select fields, filter, sort, paginate, and load related entries with validated references.
- **Markdown rendering.** Get HTML, headings, and syntax highlighting separately from metadata queries.
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

Query the generated module from server code:

```ts
import { content } from "./.content-query/server.js";
import { eq } from "content-query/query";

const posts = await content
  .select("id", "title")
  .from("posts")
  .where((fields) => eq(fields.draft, false))
  .orderBy("title");
```

Add `.content-query/` to `.gitignore`. Follow the quick start for a complete walkthrough, or choose a framework example below.

## Documentation

- [Quick start](https://github.com/yangshun/content-query/blob/main/website/content/guides/quick-start.md)
- [Framework examples](https://github.com/yangshun/content-query/blob/main/examples/README.md)
- [API and usage](https://github.com/yangshun/content-query/blob/main/docs/API.md)
- [Guides and reference](https://github.com/yangshun/content-query/blob/main/docs/README.md)

The Vite integration supports Vite 8, and the Next.js integration supports Next.js 16. Both integrations are optional; standalone builds and queries require neither framework.

Pass `contentQuery()` directly to Vite or Vite+'s `plugins` array. No `Plugin` type cast is needed; workspace consumers share the pinned toolchain versions in the dependency catalog.

Build integrations can reuse the active source session without reading schemas or bodies. `ContentSession.sources()` from `content-query/build` returns an immutable `{ revision, entries: [{ collection, id, filePath? }] }` snapshot; `session.subscribe(listener)` reports successful publications (`{ type: "ready", snapshot }`) and errors (`{ type: "error", error }`) and returns an unsubscribe function. Revisions are opaque and session-scoped. In Vite, `contentQuery().api.prepare()` asynchronously prepares the shared session and returns its source snapshot, and `.api.subscribe()` forwards subsequent events. The [MDX architecture](https://github.com/yangshun/content-query/blob/main/docs/MDX-ARCHITECTURE.md) documents its use by companion integrations.

`prepare()` waits for pending preparation and rejects while validation errors are active. Successful unchanged reads reuse the frozen snapshot; publications supply a new revision. Subscribers can observe errors and recovery, and unsubscribing stops subsequent notifications. Development integrations should let core display recoverable errors without aborting the server or replacing the host's refresh subscription.

Released under the [MIT license](https://github.com/yangshun/content-query/blob/main/LICENSE).
