# Nuxt Content benchmark app

Nuxt Content loads `content/entries/*.md` into a page collection backed by SQLite. The homepage queries every title, description, and path and links every item. `app/pages/entries/[id].vue` queries the matching entry and renders its body through `ContentRenderer`.

Vite and Vite+ versions come from the pinned shared workspace catalog.

The build command runs `nuxt generate`, with link crawling and failure on prerender errors enabled. The crawler discovers all article links on the homepage and emits 10,001 content HTML pages in `.output/public/`, alongside Nuxt hydration and content payloads. See [Nuxt Content static hosting](https://content.nuxt.com/docs/deploy/static).

The configured `native` SQLite connector uses Node's built-in SQLite implementation on the pinned Node 24.21.0 runtime. No external native database build is required. Other content processing defaults are retained.

Follow the [suite setup](../../README.md#setup) to install dependencies, Chromium, and generate the shared corpus. From the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-nuxt dev
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-nuxt build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-nuxt preview
```

Use the [benchmark runner](../../README.md#run-the-comparison) for controlled cold/warm measurements. Generated content, `.nuxt/`, `.data/`, and `.output/` are ignored by Git.

TypeScript tooling uses the workspace's shared compatibility catalog for framework APIs. Native TypeScript `7.1.0-beta` is available at the repository root; see the [compiler setup](../../../CONTRIBUTING.md#setup-and-checks).
