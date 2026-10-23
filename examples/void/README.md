# ContentQuery x Void

Server metadata queries use `content.select(...fields).from(collection)`. The relational API is available as `content.query.<collection>.findMany({ columns, with, where })`; bodies and rendered HTML are loaded separately.

Collection schemas use `schema` from `content-query/schema`, which supplies Zod-backed builders without a separate Zod dependency.

A minimal Void + React documentation app in `examples/void`, backed by one ContentQuery collection. The guides describe a fictional project notebook and serve as sample content.

## Setup and development

Use the repository's Node.js 24.21.0 runtime and Vite+ CLI. From the repository root:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @content-query/example-void dev
```

`void` and `@void/react` use `catalog:` references to the matching `1.2.1` pins in the root `pnpm-workspace.yaml`. Workspace type checks use tsrs; `allowImportingTsExtensions` enables the local ContentQuery Vite source types.

Build the workspace ContentQuery package before starting the app because its exports point at `packages/content-query/dist/`. The dev server watches Markdown and updates metadata and rendered bodies after edits. `src/content-updates.tsx` subscribes to `content-query:client` and refreshes Void loader data while preserving component state and scroll; the surrounding application remains mounted.

## Production build

From the repository root:

```sh
vp run --filter content-query build
vp run --filter @content-query/example-void build
vp run --filter @content-query/example-void preview
```

Void uses static output. The build prerenders `/` and the three `/docs/<guide-id>` pages into `dist/client/`. Cloudflare deployments use the Worker name `content-query-void`, giving the app the URL prefix `content-query-void.<account-subdomain>.workers.dev`. Generated `.content-query/`, `.void/`, `.void-wrangler.jsonc`, `.wrangler/`, and `dist/` artifacts are ignored by Git.

## How it fits together

- `content-query.config.ts` defines the `guides` collection with `source: "./content/guides"` (Markdown by default) and bundled metadata schema builders. `contentQuery()` uses its default in-memory backend, delivering virtual modules during development and bundling content for production. Use `contentQuery({ backend: "generated" })` only when standalone runtime files are also needed.
- `pages/index.server.ts` queries the homepage index directly, explicitly selecting metadata and sorting by `order`.
- `pages/docs/layout.tsx` owns the persistent sidebar, reading its own metadata from `middleware/01.docs.ts` through Void shared data. The article loader does not fetch or pass sidebar entries.
- `pages/docs/[...slug].server.ts` queries guide metadata and independent sibling navigation with fluent `.selectAdjacent()`, calls `content.render()` for the requested guide only, and handles missing-guide 404s. Its `getPrerenderPaths()` queries collection IDs when invoked. Queries run inside functions, not at route-module initialization.
- `contentQuery()` generates `.content-query/types.d.ts`, included by `tsconfig.json`, with the `content-query:server` binding and `CollectionKey`, `CollectionData`, and `Collections` aliases. Runtime and client code never import `content-query.config.ts`.
- React pages import only the types of their server loaders. They receive selected metadata and, on guide pages, the requested article's rendered HTML.
- Internal page links use Void's `Link` component for client-side navigation, with view transitions enabled by `voidReact({ viewTransitions: true })`. Guide pages also route internal Markdown links through `useRouter()` and the local `src/navigation.ts` helper. Hash links, external links, downloads, new-tab links, and modified clicks retain their normal browser behavior.

## Add a guide

Create a Markdown file under `content/guides/` with validated frontmatter:

```md
---
title: Your guide title
description: A short explanation of what the reader will learn.
order: 4
---

## First steps

Write your guide here.
```

The filename determines its ID: `your-guide.md` becomes `/docs/your-guide`. Nested directories work too. Use distinct numeric `order` values to control the index, navigation, and previous/next links. Rebuild to publish the new static route; development picks it up automatically.

## Verification

From the repository root:

```sh
vp run check
vp test run
```

`tests/guides.integration.test.ts` runs the real collection through the ContentQuery Vite integration and exercises the route loaders and prerender hook.

Each example imports its own local stylesheet, hardlinked to the common [`../shared/styles.css`](../shared/styles.css) in this workspace for the site shell, home index, docs sidebar, article typography, and mobile layout. Void requires native `.server.ts` page companions and middleware for server data; its layouts receive only children. Those native boundaries keep content loading separate from browser code without a standalone content helper.

The example is self-contained: its stylesheet and browser navigation helper (where needed) are local files. Hardlinks keep the common copies synchronized in this workspace. Git stores ordinary file contents, so copying or checking out an example does not require sibling shared files.

TypeScript tooling uses the workspace's shared compatibility catalog for framework APIs. Native TypeScript `7.1.0-beta` is available at the repository root; see the [compiler setup](../../CONTRIBUTING.md#setup-and-checks).
