---
title: Framework guides
description: Keep queries in your framework's native server data-loading boundary.
section: integrations
order: 42
---

Collection definitions and queries work the same across frameworks. The host owns routing, rendering, and refreshing page data.

## Framework patterns

| Framework                          | Query location                                     | Development refresh                           |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Void                               | `.server.ts` page companions and shared middleware | Clear router caches, then refresh loader data |
| React Router                       | Server loaders in parent and child routes          | `revalidator.revalidate()`                    |
| TanStack Start                     | Server functions called by route loaders           | `router.invalidate()`                         |
| SvelteKit                          | `+page.server.ts` and `+layout.server.ts`          | `refreshAll()`                                |
| [Next.js](/docs/integrations/next) | Server Components and route metadata functions     | Generated modules trigger Next.js HMR         |

## Choose an integration

The Vite-based examples use the [Vite plugin](/docs/integrations/vite) and `content-query:server`. The [Next.js integration](/docs/integrations/next) wraps the configuration with `withContentQuery()` from `content-query/next` and imports the generated server entry. The adapter awaits initial generation, owns development watching and shutdown, and performs a one-shot build in production with Turbopack or Webpack.

The repository's `content-query/examples/` directory contains runnable examples for all five frameworks. Keep collection configuration and the prepared server runtime out of browser code.
