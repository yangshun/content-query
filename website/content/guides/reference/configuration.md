---
title: Configuration
description: Configuration discovery and preparation options.
section: reference
order: 50
---

## Configuration file

ContentQuery discovers one `content-query.config.{ts,mts,cts,js,mjs,cjs}` file at the application root. Export a named `collections` registry. Missing or multiple matching files fail discovery.

Use the `config` option, or CLI `--config`, to select an exact configuration path.

## Preparation options

| Option    | Default             | Purpose                                       |
| --------- | ------------------- | --------------------------------------------- |
| `config`  | Automatic discovery | Exact configuration file                      |
| `backend` | `"generated"`       | `"generated"` or `"in-memory"`                |
| `outDir`  | `"./.content-query"` | Generated runtime output directory            |
| `watch`   | `false`             | Keep preparation subscribed to source changes |

These options configure `prepareContent()`. The Vite plugin owns its watch lifecycle and accepts `config`, `backend`, and `outDir`.

See [standalone usage](/docs/integrations/standalone) and [Vite integration](/docs/integrations/vite).
