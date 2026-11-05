---
title: Configuration
description: Configuration discovery and content build options.
section: reference
order: 50
---

## Configuration file

ContentQuery discovers one `content-query.config.{ts,mts,cts,js,mjs,cjs}` file at the application root. Export a named `collections` registry. Missing or multiple matching files fail discovery.

Use the `config` option, or CLI `--config`, to select an exact configuration path.

## Query style

Export `queryStyle` to allow only one query API in the application:

```ts
export const queryStyle = "relational"; // or "fluent"
```

The style gates the collection members that start a query. The fluent starters are `select`, `where`, `orderBy`, `limit`, `offset`, `with`, `withPayload`, and `selectAdjacent`.

| Value          | Allowed                                               | Disabled                                              |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Omitted        | Both query APIs                                       | Nothing                                               |
| `"fluent"`     | Fluent starters                                       | `findMany`, `findFirst`, `paginate`, `count(options)` |
| `"relational"` | `findMany`, `findFirst`, `paginate`, `count(options)` | Fluent starters                                       |

`count()` without options counts every entry in both styles. Fluent terminals, such as `.all()`, `.first()`, `.paginate()`, and `.count()`, follow a starter, so `"fluent"` keeps them.

Generated types read the export, so editors and type checks report a disabled member as `posts.select is unavailable because content-query.config sets queryStyle to "relational".` Keep the literal type by exporting a plain `const`; a `: QueryStyle` annotation widens it, and only the runtime check applies. At runtime, a disabled member throws an `invalid-query` error with the same message. Other values fail configuration loading.

Both styles support the same filters. See [choosing a style](/docs/querying-content#choosing-a-style).

## Build options

| Option    | Default              | Purpose                                     |
| --------- | -------------------- | ------------------------------------------- |
| `config`  | Automatic discovery  | Exact configuration file                    |
| `backend` | `"generated"`        | `"generated"` or `"in-memory"`              |
| `outDir`  | `"./.content-query"` | Generated runtime output directory          |
| `watch`   | `false`              | Keep the build subscribed to source changes |

These options configure `buildContent()`.

## Integration options

The [Vite plugin](/docs/integrations/vite) owns its watch lifecycle and accepts `config`, `backend`, and `outDir`.

The [Next.js adapter](/docs/integrations/next#content-options) accepts `config` and `outDir` as the second argument to `withContentQuery(nextConfig, options)`. It uses the generated backend, watches during `next dev`, and performs a one-shot content build during `next build`.

See [standalone usage](/docs/integrations/standalone) for direct control of a build session.
