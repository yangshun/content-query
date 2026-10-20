# Next.js + ContentQuery benchmark app

Next.js App Router Server Components query the workspace ContentQuery collection. The homepage lists every title and description with a link. `app/entries/[id]/page.tsx` uses `generateStaticParams()` to enumerate every entry, then renders each entry's own metadata and Markdown body. Missing entries return a 404.

`withContentQuery()` prepares content before Next starts compiling and owns the content watcher during development. The Next.js adapter uses generated metadata and lazy payload artifacts; the Vite adapter's in-memory backend is a separate integration. This app uses Next.js's default Turbopack bundler, rather than Vite.

The ContentQuery Next.js adapter skips content preparation when Next's detached telemetry helper reloads development configuration. This keeps the helper from starting a watcher that survives server shutdown and overwrites artifacts during later builds.

The normal `next build` includes content preparation, compilation, route enumeration, and static export. `output: "export"` with `trailingSlash: true` emits `out/index.html` and `out/entries/<id>/index.html`: 10,001 content HTML pages for the default corpus. Next also emits native React Server Component navigation payloads, browser assets, and error pages. Preview uses the suite's static-file server.

Follow the [suite setup](../../README.md#setup), including building ContentQuery and generating the shared corpus. From the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-next dev
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-next build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-next preview
```

Run the controlled benchmark for only this app:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmarks bench --apps next
```

The runner clears `.next/`, `out/`, and `.content-query/` for cold runs and verifies every emitted article's HTML after a build. Benchmark runs replace the latest raw measurements and report, so preserve previous results before running a subset. Generated content, framework types, and outputs are ignored by Git.
