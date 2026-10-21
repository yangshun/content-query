# ContentQuery

Typed, framework-independent content collections, queries, and rendering. ContentQuery builds validated content into portable runtime artifacts, with optional CLI, Vite, and Next.js integrations. Standalone hosts use `content-query build` or `buildContent()` from `content-query/build`; add `--watch` or `watch: true` for ongoing updates. Next.js applications use `withContentQuery()` from `content-query/next` to own generation and development watching.

The standalone CLI uses CAC and provides `--help`, command-specific help, `--version`, and short aliases for configuration, output directory, and watch mode.

Import `{ schema }` from `content-query/schema` for bundled Zod-backed content builders and provider-independent inference helpers. Consumers install only ContentQuery; collections and computed fields also accept other Standard Schema V1 validators.

Build-only helpers from `content-query/computed` add typed reading time, word count, and excerpt fields. They use captured Markdown by default or explicitly selected text/HTML from structured files and custom loaders. See the [computed fields guide](./website/content/guides/computed-fields.md).

Server queries use SQL-ordered `content.select(...fields).from(collection)` or relational `content.query.posts.findMany({ columns, with, where })` / `findFirst()`. Default selections include all prepared metadata; bodies and rendered HTML remain separate operations.

This standalone Vite+ repository contains the complete ContentQuery project:

```text
content-query/
  packages/
    content-query/  Library source, tests, and API guide (private until publication)
  examples/
    angular/
    void/
    next/
    react-router/
    tanstack-start/
    sveltekit/
    shared/        Common source files and example parity tests
  benchmarks/      Six stacks with 10,000 shared entries and timing reports
  docs/            Design, features, comparisons, and planned work
  website/         Void + React homepage and documentation site
  README.md
```

## Development

From this repository root, use Node.js 24.21.0 and Vite+. The repository owns its workspace configuration, dependency catalog, lockfile, formatting, type-aware linting, TypeScript checks, tests, and package builds:

```sh
vp install --frozen-lockfile
vp run build
vp run check
vp exec --filter @content-query/benchmarks playwright install chromium
vp test run
vp test run --coverage
```

Run `vp fmt` to format files or `vp lint` for linting alone. `vp check` combines formatting, linting, and type checks. `vp run check` first generates ContentQuery declarations and framework types for a clean checkout; use `vp check` directly afterward. Installation builds the library so local CLI links work immediately. The pre-commit hook runs `vp staged`, and GitHub Actions runs the checks, SvelteKit diagnostics, tests with coverage, and website build. Package coverage must remain above 90% for statements, lines, and functions, and 85% for branches.

Use `vp run dev` to watch the library build. In another terminal, run `vp run --filter @content-query/website dev` or an example's development command. `vp run build:website` builds the library before the website; `vp run build:examples` builds the library before all examples. Each [example](./examples/README.md) documents its own commands. Examples keep local styles and helpers so they can be copied independently; common copies live in `examples/shared/`.

VoidPress checks this repository out as a Git submodule at `content-query/` and keeps `content-query/packages/*` in its workspace. Its `"content-query": "workspace:*"` dependency continues to resolve locally. Develop here or in the submodule checkout, commit ContentQuery changes first, then update VoidPress's submodule pin. The standalone checkout and the submodule are separate working trees; use Git commits to synchronize them. See [repository history](./docs/HISTORY.md) for the extraction boundary and original commit mapping.

Keep the [website](./website/README.md) current when core changes affect public APIs, features, or behavior.

## Benchmarks

The [benchmark suite](./benchmarks/README.md) compares Astro content collections, Vite + React + Content Collections, Nuxt Content, Void + ContentQuery, Next.js + ContentQuery, and TanStack Start + ContentQuery with 10,000 shared Markdown entries per app. Every homepage lists all titles and descriptions with links, and every item has a dedicated prerendered article page: 10,001 content HTML pages per app. It measures cold and warm startup through browser-verified usable content and full-site production build time. See the [results](./benchmarks/RESULTS.md) for recorded timings, environment details, output differences, and reproduction commands.

## Documentation

See the [historical startup and build profiling report](./benchmarks/PROFILING.md) for bottlenecks and targeted optimizations from the earlier single-page workload. Current full-site measurements are in [RESULTS.md](./benchmarks/RESULTS.md).

- [Website development](./website/README.md)
- [Package API and usage](./packages/content-query/README.md)
- [Features](./docs/FEATURES.md)
- [Design and contracts](./docs/PLAN.md)
- [Library comparisons](./docs/COMPARISONS.md)
- [Planned work](./docs/TODO.md), including build-time transforms and a public preparation cache helper.
