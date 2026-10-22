# Void + ContentQuery benchmark app

Server metadata queries use `content.select(...fields).from(collection)`. The relational API is available as `content.query.<collection>.findMany({ columns, with, where })`; bodies and rendered HTML are loaded separately.

Collection schemas use `schema` from `content-query/schema`, which supplies Zod-backed builders without a separate Zod dependency.

The workspace ContentQuery Vite plugin loads and validates `content/entries/*.md`. The homepage loader queries every title and description, and React renders a link for every item. `pages/entries/[id].server.ts` exports `getPrerenderPaths()` for the entire collection; each route queries its metadata and renders its own Markdown body.

The config passes `contentQuery()` directly to `plugins`, using the same pinned Vite+ version as the shared workspace toolchain catalog.

The static build produces `dist/client/index.html` and one `dist/client/entries/<id>.html` per entry: 10,001 content HTML pages. React receives selected metadata and rendered HTML through the native Void page loader.

Follow the [suite setup](../../README.md#setup), including building the ContentQuery package before running this app. From the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter content-query build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-void dev
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-void build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-void preview
```

Use the [benchmark runner](../../README.md#run-the-comparison) for controlled cold/warm measurements. Generated content, `.content-query/`, `.void/`, deployment metadata, and output directories are ignored by Git.

The default app uses the published `void` and `@void/react` versions pinned in this repository's workspace catalog, so no sibling Void checkout is required. Earlier framework experiments used local Void builds; their recorded measurements remain historical. Temporarily link local builds only for an explicit framework experiment. The comparison records fingerprints of the built framework and adapter plus the source revision; manifest versions alone do not identify unpublished local builds. See the [Void follow-up](../../CORE-OPTIMIZATION.md#authorized-void-follow-up) for validation and measurement limits.

The app uses ContentQuery's default in-memory Vite backend, writing only declarations under `.content-query/` and bundling production payloads with the app. Set `CONTENT_QUERY_BENCH_BACKEND=generated` to additionally publish standalone runtime artifacts.

The [profiling report](../../PROFILING.md) examines this app's startup and build costs. ContentQuery's production Vite integration prepares only server content and groups payload modules into bounded lazy chunks; the standalone generated artifacts retain separate item modules. Metadata queries still avoid loading bodies.
