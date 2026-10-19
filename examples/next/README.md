# ContentQuery x Next.js

A small Next.js App Router documentation site in `content-query/examples/next`, backed by ContentQuery. It uses the same sample project-notebook guides as the Void example, with a homepage index, Markdown articles, ordered navigation, page metadata, and missing-guide handling.

## Development

Use the repository's Node.js 24.21.0 runtime and Vite+ CLI. From the repository root:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @voidpress/content-query-next dev
```

Open [localhost:3000](http://localhost:3000). `vp run` executes the Next.js script; `vp dev` would start Vite instead.

Content is built once when the development server starts. Restart it after changing Markdown, collection schemas, or loader configuration. This example deliberately uses one-shot builds; it does not install a Next.js content watcher.

## Production

```sh
vp run --filter content-query build
vp run --filter @voidpress/content-query-next build
```

`next.config.mjs` awaits `buildContent()` from `content-query/build` before development and production compilation, then disposes the content session. Invalid content fails startup or the build. Content builds run through ContentQuery's public API without a Vite plugin or framework adapter.

Next.js exports `/`, the three `/docs/<guide-id>/` pages, and a `404.html` page to `out/`. Deploy that directory to a static host. The exported site needs no Node.js server, Markdown source files, collection configuration, or ContentQuery compiler. `next start` does not serve static exports.

## Content and routing

- `content-query.config.ts` defines a Markdown collection with the string `source` shorthand with a Zod metadata schema.
- `.content-query/` holds the generated ESM runtime and its inferred TypeScript declarations, including `CollectionKey`, `CollectionData`, and `Collections`. It is ignored by Git and regenerated automatically before compilation.
- Queries are inline in `app/page.tsx` and `app/docs/[...slug]/page.tsx`, which import `.content-query/server.js` directly. Next.js's `server-only` marker prevents client components from importing these server modules.
- The homepage queries selected metadata without rendering any guide bodies. `generateMetadata()` also selects metadata only.
- `generateStaticParams()` maps collection IDs to catch-all route segments. Nested files such as `content/guides/reference/shortcuts.md` become `/docs/reference/shortcuts/`.
- `app/docs/layout.tsx` loads only sidebar IDs/titles and persists across guide navigation. Its small client `sidebar.tsx` updates the active link from `usePathname`; the article page does not load or pass navigation entries.
- The guide page awaits its route parameters, renders the requested Markdown body, and selects previous/next links with an independent `_adjacent` sibling scope. Detail queries use the object API; the index also demonstrates fluent queries. `dynamicParams = false` rejects paths outside the generated collection.
- Source Markdown is trusted repository content. Server Components load and render it; the client presentation component handles internal link clicks. Application code owns routing and presentation.

To add a guide, create a Markdown file under `content/guides/` with `title`, `description`, and numeric `order` frontmatter. Rebuild to publish its route.

This follows Next.js's [async configuration](https://next.org/docs/app/api-reference/config/next-config-js), [static export](https://next.org/docs/app/guides/static-exports), and [generateStaticParams](https://next.org/docs/app/api-reference/functions/generate-static-params) APIs.

## Verification

```sh
vp check
vp test run
vp run --filter @voidpress/content-query-next build
```

The integration suite prepares and builds a real Next.js consumer through `next.config.mjs`, then checks its exported index, metadata, Markdown rendering, adjacent guides, nested routes, and 404 page after removing source content and configuration. It also checks that invalid content blocks compilation.

The root layout imports its local stylesheet, hardlinked to the common [`../shared/styles.css`](../shared/styles.css) in this workspace, giving all five examples the same header, footer, home index, sidebar, article typography, and responsive layout. Queries stay inline in Server Components and route metadata functions. `app/docs/content.tsx` is a small client presentation boundary that routes internal Markdown links through Next.js while keeping the docs layout mounted.

The example is self-contained: its stylesheet and browser navigation helper (where needed) are local files. Hardlinks keep the common copies synchronized in this workspace. Git stores ordinary file contents, so copying or checking out an example does not require sibling shared files.
