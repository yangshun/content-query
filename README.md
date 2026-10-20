# ContentQuery

Typed, framework-independent content collections, queries, and rendering. ContentQuery builds validated content into portable runtime artifacts, with optional CLI, Vite, and Next.js integrations. Standalone hosts use `content-query build` or `buildContent()` from `content-query/build`; add `--watch` or `watch: true` for ongoing updates. Next.js applications use `withContentQuery()` from `content-query/next` to own generation and development watching.

The standalone CLI uses CAC and provides `--help`, command-specific help, `--version`, and short aliases for configuration, output directory, and watch mode.

Build-only helpers from `content-query/computed` add typed reading time, word count, and excerpt fields. They use captured Markdown by default or explicitly selected text/HTML from structured files and custom loaders. See the [computed fields guide](./website/content/guides/computed-fields.md).

This directory groups the project for a future standalone repository:

```text
content-query/
  packages/
    content-query/  Published package, source, tests, and API guide
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

ContentQuery currently belongs to the enclosing VoidPress workspace. From that repository root, use Node.js 24.21.0 and Vite+:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp check
vp test content-query
```

Run `vp test` from the enclosing repository root to also verify VoidPress consumers. Each [example](./examples/README.md) documents its own development and production commands. Examples keep local styles and helpers so they can be copied independently; common copies live in `examples/shared/`.

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
