# @content-query/mdx

Optional MDX compilation and React islands for ContentQuery. Core owns collections, validation, computed fields, queries, and indexing. This package owns MDX, React rendering, browser scheduling, and build integration. Installing `content-query` alone installs none of its MDX or React dependencies.

Requires Node.js 22.12+, ContentQuery, and React 19 for rendering. The included integration targets Vite 8 SSR. See the [React Router example](https://github.com/yangshun/content-query/tree/main/examples/react-router-mdx) for two rendering modes, interactive widgets, and framework-owned navigation without a custom server or build script.

## Configure a collection

```ts
// content-query.config.ts
import { defineCollection } from "content-query";
import { schema } from "content-query/schema";
import { mdx } from "@content-query/mdx";

export const collections = {
  guides: defineCollection({
    loader: mdx({ base: "./content/guides" }),
    schema: schema.object({ title: schema.string() }),
  }),
};
```

`mdx({ base, pattern?, generateId? })` accepts a project-relative directory or a file URL. `pattern` defaults to `**/*.mdx`. IDs use `slug` frontmatter when provided, otherwise slugged relative paths without the extension or trailing `/index`. `generateId({ entry, base, data })` can replace that rule. Empty and duplicate IDs fail preparation.

YAML frontmatter is validated by the collection schema. `readBody()` returns retained MDX text without frontmatter; core's `render()` does not compile it. `filePath` and typed loader `source.filePath` remain available to preparation. File additions, changes, deletions, and recovery use the existing ContentQuery watcher.

```ts
// vite.config.ts (use vite-plus instead of vite inside this repository)
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { contentQuery } from "content-query/vite";
import { contentQueryMdx } from "@content-query/mdx/vite";

export default defineConfig({
  plugins: [contentQuery(), contentQueryMdx({ rendering: "both" }), reactRouter()],
});
```

`rendering` controls browser document emission: `"islands"` (default) emits widget entries only, `"react"` emits normal document entries, and `"both"` enables both choices. Server rendering APIs are available in all modes. `highlight: false` disables highlighting; `remarkPlugins` and `rehypePlugins` extend the build-time pipeline. Defaults include GFM, unique heading IDs, source maps, and Shiki GitHub Light/Dark code highlighting.

The plugin writes generated declarations and build intermediates under `.content-query/mdx/`. Ignore `.content-query/` and include `.content-query/**/*.d.ts` in your TypeScript project; this covers both core and MDX declarations.

## Author widgets

```mdx
---
title: Interactive MDX
---

import { Callout } from "../widgets/callout";
import { Counter } from "../widgets/counter";
import { Quiz } from "../widgets/quiz";
import { ReadingChecklist } from "../widgets/reading-checklist";
import { BrowserNote } from "../widgets/browser-note";

# Interactive MDX

<Callout>Useful static guidance.</Callout>
<Counter client:load initialCount={0} />
<Quiz client:visible />
<ReadingChecklist client:idle />
<BrowserNote client:only />
```

In islands mode, unmarked components render on the server. Each marked widget owns its own React root:

| Directive        | Behavior                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `client:load`    | Render on the server; hydrate as soon as its manager starts.        |
| `client:visible` | Render on the server; import and hydrate when visible.              |
| `client:idle`    | Render on the server; import and hydrate at idle after page load.   |
| `client:only`    | Skip server evaluation and markup; import and mount in the browser. |

`client:only="react"` is also accepted. Widgets must be explicitly imported default, named, or namespace-member components. Unsupported directives, options, and references report source positions. Keep browser-only modules exclusively behind `client:only`; an ordinary use or re-export is still an ordinary server import.

Props use `devalue`, supporting data such as dates, maps, sets, and BigInts. Functions and React elements cannot cross island boundaries. Use text children or data props; put formatted slots, nested widgets, and their providers inside the imported component. Inline occurrences use a `span` root and block occurrences use a `div`; keep widget markup appropriate for its surrounding HTML. Unmarked components and the application cannot provide React context to a separate island root. Repeated instances share a module download and receive separate identifier prefixes for `useId()`.

In normal React mode, the first three directives are stripped. `client:only` becomes a lazy component within the same React tree. Host providers reach the document and all its interactive components, including browser-only components.

## React application integration

In a React Router server loader, choose the rendering mode:

```ts
import { renderMdx, loadMdxDocument } from "content-query:mdx:server";

// Islands: return HTML and stylesheet URLs.
const islands = await renderMdx("guides", id);
// React: prepare the SSR module and return only a serializable browser reference.
const reference = await loadMdxDocument("guides", id);
```

Render the loader result inside the application:

```tsx
import { MdxDocument, MdxIslands } from "@content-query/mdx/react";

<MdxIslands html={islands.html} styles={islands.styles} className="prose" />;
<MdxDocument reference={reference} components={{ h2: CustomHeading }} />;
```

`MdxIslands` accepts ordinary `div` props, `html`, optional `styles`, and `onIslandError(cause, element)`. Unchanged HTML preserves widget state across host rerenders. Each HTML change advances a compact, local numeric React key and cancels pending work before replacing the article. Widget roots finish teardown after the host React commit, avoiding nested-root teardown warnings. Effect reconnection restores fresh widget containers.

`MdxDocument` accepts a selected `reference`, ordinary MDX props/component overrides, and an optional Suspense `fallback`. It uses the surrounding application root, providers, and `useId()` space. It never creates a separate document root. The reference is loaded through native URL imports and reused between visits, without a browser document registry. Failures reach the host's React error boundary.

Both helpers use React 19 stylesheet resources so CSS is available before revealing content. Only serializable document props can travel through framework loader data; put callbacks, providers, and component overrides in application components. `loadMdxDocument` is a Vite server API. A custom host can call `prepareMdxDocument(reference, module)` from `@content-query/mdx/react/server` before rendering instead.

React Router still hydrates its application shell on island pages. The document's prose remains static and no MDX document module is downloaded. A standalone host can defer React itself until a widget starts.

## Lower-level server and browser APIs

```ts
// Server: islands
import { renderMdx } from "content-query:mdx:server";
const { html, headings, styles } = await renderMdx("guides", id, {
  props: { edition: "current" },
  components: { h2: CustomHeading },
});
```

Vite resolves assets automatically. An optional `assets` override supports custom two-pass hosts; the lower-level `renderMdxModule` helper from `@content-query/mdx/react/server` requires explicit assets. `identifierPrefix?` can supply a per-render root prefix. Render the returned styles as stylesheet links before displaying the HTML. Results are buffered HTML, matching headings, and stylesheet URLs.

```ts
// Browser: islands
import { mountIslands } from "@content-query/mdx/client";
const dispose = mountIslands(article, {
  onError(cause, element) {
    console.error("Widget failed", element, cause);
  },
});
// Before removing the article:
dispose();
```

The manager cancels visibility/idle work and ignores imports completed after disposal. Widget failures remain isolated. React loads through widget entries when the host does not already use React; a standalone prose-only island page needs no React runtime.

```tsx
// Server: ordinary React
import { loadMdx, getMdxAssets } from "content-query:mdx:server";
const { default: Content, headings } = await loadMdx("guides", id);
const tree = (
  <ApplicationProvider>
    <Content components={{ h2: CustomHeading }} />
  </ApplicationProvider>
);
const client = (await getMdxAssets()).document("guides", id);
```

The host renders `tree`, sends only `client` with its page data, and uses its matching props, component overrides, providers, and `identifierPrefix` when hydrating:

```ts
import { loadMdx } from "@content-query/mdx/client";
const { default: Content } = await loadMdx(pageData.client);
// Use Content in the application's hydrateRoot/render lifecycle.
```

Browser loading uses native dynamic imports and awaits referenced CSS. It contains no document importer map. The complete asset manifest and collection lookups stay on the server. `loadStyle(url)` is also exported for host navigation. Dispose the old root before replacing its DOM, and ignore stale page requests/imports; the React helpers manage document and island lifecycles when the host uses React.

## Production assets

For frameworks using Vite's Environment API, including React Router, use the framework's normal build command. The plugin first builds an internal MDX server graph, records server-reachable styles including CSS imported by static components, preserves static assets, and emits browser entries. The generated manifest is included in the final server bundle. `renderMdx()` and `loadMdxDocument()` resolve it automatically; `getMdxAssets()` exposes it for advanced integrations. These APIs work in development and production without application-owned file reading or asset copying.

The browser output contains `.vite/content-query-mdx-manifest.json` with document/widget references and static asset URLs. The complete manifest stays server-side; send only selected references to clients.

For custom two-pass Vite SSR builds, build the SSR graph before browser entries. The plugin captures styles and copies emitted static server assets into the browser output. Such hosts load the manifest explicitly:

Read the manifest once at server startup and resolve references through:

```ts
import { createMdxAssets } from "@content-query/mdx/assets";
const assets = createMdxAssets(manifest);
assets.document("guides", id); // selected browser document URL + CSS; requires react/both
assets.styles("guides", id); // styles reached through the server graph
assets.island(widgetId); // normally used by the island renderer
```

During development, the server-only `content-query:mdx:server` virtual module resolves equivalent Vite URLs against the live module graph. Document styles are resolved after the selected module loads. Custom two-pass builds pass `renderMdx(collection, id, { assets })` with the production manifest explicitly; automatic production resolution requires a Vite application build. The server runs on built modules and metadata without the source content or collection config.

## Entry points and independent compilation

| Entry                             | Ownership                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `@content-query/mdx`              | Local loader and shared types; no compiler or React DOM import.                   |
| `@content-query/mdx/compiler`     | `compileMdx`, reusable `analyzeMdx` / `compileAnalysis`, compiler types.          |
| `@content-query/mdx/vite`         | Vite integration and the generated server facade.                                 |
| `content-query:mdx:server`        | Server collection lookups, rendering, selected references, and asset access.      |
| `@content-query/mdx/assets`       | Pure manifest resolution.                                                         |
| `@content-query/mdx/client`       | Selected document loading, styles, and island scheduling; no static React import. |
| `@content-query/mdx/react`        | `MdxDocument`, `MdxIslands`, and the lazy client-only component factory.          |
| `@content-query/mdx/react/server` | Buffered island SSR and `prepareMdxDocument` helpers.                             |
| `@content-query/mdx/react/client` | Generated-widget mounting adapter.                                                |

```ts
import { compileMdx } from "@content-query/mdx/compiler";
const result = await compileMdx(
  { path: "/content/article.mdx", value: source },
  {
    target: "react", // default
    highlight: true,
    remarkPlugins: [],
    rehypePlugins: [],
  },
);
// result: { code, map, headings, islands }
```

`code` is ordinary ESM with a default MDX component, preserved authored imports/exports, and a `headings` export. The compiler does not evaluate modules or import Vite or React DOM. A host can reuse one analysis across targets. Island output needs `resolveIsland(reference)` returning `{ id, clientOnlyImport? }`; React `client:only` needs a host-generated wrapper import. `resolveMdxImport(specifier, target)` optionally propagates a target through imported MDX. References include import source/export identity, strategy, and file/line/column. Caches belong to each integration, keeping its options and targets separate.

## Compatibility and limits

The [Next.js architecture review](https://github.com/yangshun/content-query/blob/main/docs/MDX-ARCHITECTURE.md) preserves native Server/Client Component integration as a separate path. Ordinary ESM retains imports and authored `"use client"` directives. A future adapter must use Next-owned bundling and hydration and must bypass the standalone renderer. **No public Next MDX adapter or Next runtime compatibility is verified by this release.** The existing core Next.js integration continues to serve metadata and Markdown.

This implementation targets local files, React 19, synchronous SSR-compatible widgets, props-based boundaries, and buffered output. Remote MDX, streaming islands, formatted MDX slots, nested island declarations, other UI frameworks, and a public Next adapter remain deferred. Structural tests verify lazy document loading and shared widget entries; they make no large-corpus performance claim.

## Develop and verify

From the repository root on Node.js 24.21.0:

```sh
vp install --frozen-lockfile
vp run build
vp test run packages/mdx
vp run --filter @content-query/example-react-router-mdx browsers:install
vp test run examples/react-router-mdx
vp run check
vp test run --coverage
```

CI runs package coverage and Chromium production verification with the existing coverage thresholds.
