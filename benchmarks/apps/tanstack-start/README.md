# TanStack Start + ContentQuery benchmark app

Collection schemas use `schema` from `content-query/schema`, which supplies Zod-backed builders without a separate Zod dependency.

This app pins Vite+ 1.3.0, matching the workspace's existing TanStack Start example. The raw report records its resolved toolchain separately from the other stacks.

The homepage lists all 10,000 titles and descriptions with links. Each article renders its own metadata and Markdown body. Inline TanStack Start server functions query ContentQuery; content imports stay inside their handlers, so the runtime and article collection remain on the server.

ContentQuery uses its in-memory Vite backend. TanStack Start's [native prerendering](https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering) crawls the homepage links during the normal production build, emitting 10,001 content HTML pages under `dist/client/`, alongside React hydration assets. Prerender concurrency and processing retain framework defaults. The server bundle is normal additional output.

Links use ordinary document navigation, matching the Astro and Vite + React benchmarks. The prerendered site therefore works from the suite's static-file preview without a server function endpoint or experimental static-function middleware. Start still hydrates its native route loader data on each page.

Follow the [suite setup](../../README.md#setup). From the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-tanstack-start dev
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-tanstack-start build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-tanstack-start preview
```

The suite runs startup and production builds sequentially, verifies the full homepage and first/last articles in Chromium, and audits every emitted article HTML file. Cold runs remove `.tanstack/`, generated route types, ContentQuery declarations, Vite optimizer caches, and build output; warm runs retain the preceding run's generated files.

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench --apps tanstack-start
```

The standard benchmark command replaces `results/latest.json` and `RESULTS.md`; preserve an existing comparison before running a subset. The [suite results](../../RESULTS.md) retain each framework's source run when combining partial reruns.
