# ContentQuery

Typed, framework-independent content collections, queries, and rendering. ContentQuery prepares validated content into portable runtime artifacts, with optional CLI and Vite integrations.

This directory groups the project for a future standalone repository:

```text
content-query/
  packages/
    content-query/  Published package, source, tests, and API guide
  examples/
    void/
    next/
    react-router/
    tanstack-start/
    sveltekit/
    shared/        Common source files and example parity tests
  docs/            Design, features, comparisons, and planned work
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

## Documentation

- [Package API and usage](./packages/content-query/README.md)
- [Features](./docs/FEATURES.md)
- [Design and contracts](./docs/PLAN.md)
- [Library comparisons](./docs/COMPARISONS.md)
- [Planned work](./docs/TODO.md)
