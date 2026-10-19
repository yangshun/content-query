---
title: Framework guides
description: Keep queries in your framework's native server data-loading boundary.
section: integrations
order: 41
---

Collection definitions and queries work the same across frameworks. The host owns routing, rendering, and refreshing page data.

## Framework patterns

| Framework      | Query location                                     | Development refresh                                       |
| -------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Void           | `.server.ts` page companions and shared middleware | Clear router caches, then refresh loader data             |
| React Router   | Server loaders in parent and child routes          | `revalidator.revalidate()`                                |
| TanStack Start | Server functions called by route loaders           | `router.invalidate()`                                     |
| SvelteKit      | `+page.server.ts` and `+layout.server.ts`          | `refreshAll()`                                            |
| Next.js        | Server Components and route metadata functions     | The example prepares once at startup; restart after edits |

## Choose an integration

The Vite-based examples use the [Vite plugin](/docs/integrations/vite) and `content-query:server`. The Next.js example uses [standalone preparation](/docs/integrations/standalone) and imports the generated server entry.

The repository's `content-query/examples/` directory contains runnable examples for all five frameworks. Keep collection configuration and the prepared server runtime out of browser code.
