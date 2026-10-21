# ContentQuery

Typed collections and queries for Markdown, JSON, YAML, and TOML. ContentQuery validates your content at build time and produces portable data your application can query and render on the server.

Use it with your existing framework. Your application owns its routes, layouts, and public URLs; production reads prepared content without loading the original source files.

## Features

- **Typed schemas.** Validate metadata with bundled schema builders or any Standard Schema V1 provider, with inferred TypeScript types.
- **Flexible sources.** Load local files, use Astro-compatible content loaders, or write your own loader.
- **Queries and relationships.** Select fields, filter, sort, paginate, and load related entries with validated references.
- **Markdown rendering.** Get HTML, headings, and syntax highlighting separately from metadata queries.
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

The Vite integration supports Vite 8, and the Next.js integration supports Next.js 16. Both integrations are optional; standalone builds and queries require neither framework.

## Documentation

- [Quick start](./website/content/guides/quick-start.md)
- [Framework examples](./examples/README.md)
- [API and usage](./docs/API.md)
- [Guides and reference](./docs/README.md)

## Contributing

See the [contributor guide](./CONTRIBUTING.md) for setup, development, and checks. For performance measurements, see the [benchmark suite](./benchmarks/README.md) and [results](./benchmarks/RESULTS.md).

Released under the [MIT license](./LICENSE).
