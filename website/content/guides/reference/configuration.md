---
title: Configuration
description: Configuration discovery and content build options.
section: reference
order: 50
---

## Configuration file

ContentQuery discovers one `content-query.config.{ts,mts,cts,js,mjs,cjs}` file at the application root. Export a named `collections` registry. Missing or multiple matching files fail discovery.

Use the `config` option, or CLI `--config`, to select an exact configuration path.

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
