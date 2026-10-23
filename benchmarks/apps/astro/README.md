# Astro benchmark app

Astro's built-in content collections load `content/entries/*.md` through `glob()` and validate frontmatter. The homepage lists every title and description with a link. `src/pages/entries/[id].astro` uses `getStaticPaths()` to enumerate every entry and `render()` to render its Markdown. The normal Astro build emits the homepage and all 10,000 dedicated article pages.

Vite and Vite+ versions come from the pinned shared workspace catalog.

Follow the [suite setup](../../README.md#setup) to install dependencies, Chromium, and generate the shared 10,000-entry corpus. From the repository root:

```sh
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-astro dev
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-astro build
vp env exec --node 24.21.0 -- vp run --no-cache --filter @content-query/benchmark-astro preview
```

Use the [benchmark runner](../../README.md#run-the-comparison) for controlled cold/warm startup and build measurements. Generated content and `.astro/` are ignored by Git.

TypeScript tooling uses the workspace's shared compatibility catalog for framework APIs. Native TypeScript `7.1.0-beta` is available at the repository root; see the [compiler setup](../../../CONTRIBUTING.md#setup-and-checks).
