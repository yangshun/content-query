# ContentQuery + SvelteKit

Server metadata queries use `content.select(...fields).from(collection)`. The relational API is available as `content.query.<collection>.findMany({ columns, with, where })`; bodies and rendered HTML are loaded separately.

Collection schemas use `schema` from `content-query/schema`, which supplies Zod-backed builders without a separate Zod dependency.

A small documentation site using native SvelteKit server data loading and portable ContentQuery content. The listing selects metadata only; detail pages explicitly render Markdown and select previous/next guides through `_adjacent`.

The Vite config passes `contentQuery()` directly to `plugins`; the shared workspace catalog keeps the plugin and host toolchain types compatible.

## Run locally

From the repository root, use Node.js 24.21.0 and Vite+:

```sh
vp install
vp run --filter content-query build
vp run --filter @content-query/example-sveltekit dev
```

## Build

```sh
vp run --filter @content-query/example-sveltekit build
```

The example prerenders the homepage and guide pages. ContentQuery's Vite integration prepares content before compilation, generates `.content-query/types.d.ts`, and keeps its server runtime out of client modules. Content files live under `content/guides`; the application owns URLs, metadata, and HTML presentation. Nested guide IDs map to catch-all routes. Missing guides return a 404.

Queries are inline in SvelteKit's required `+page.server.ts` and `+layout.server.ts` modules. `src/routes/docs/+layout.server.ts` fetches navigation for the persistent docs layout; the article loader fetches only the article and its neighbors. `$app/state` keeps the active sidebar link current. There is no separate content-loading helper. Generated data and declarations are ignored by Git.

Development subscribes to `content-query:client` and calls `refreshAll()` after publication. The generated `content-query:server` types include `CollectionKey`, `CollectionData`, and `Collections`; there is no handwritten declaration file. `source: "./content/guides"` defaults to Markdown. The production output is `build/`.

Run `vp test run examples/sveltekit/tests` from the repository root to build an isolated copy, add a nested guide, and verify ordered metadata, Markdown, and previous/next links after deleting the source files.

The root layout imports its local stylesheet, hardlinked to the common [`../shared/styles.css`](../shared/styles.css) in this workspace. All examples use the same site shell, home index, docs sidebar, article typography, footer, and responsive layout. Sidebar metadata is loaded independently of child article data.

The example is self-contained: its stylesheet and browser navigation helper (where needed) are local files. Hardlinks keep the common copies synchronized in this workspace. Git stores ordinary file contents, so copying or checking out an example does not require sibling shared files.
