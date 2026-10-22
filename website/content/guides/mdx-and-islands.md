---
title: MDX and React islands
description: Add optional MDX with independent widgets or a shared React document tree.
section: rendering
order: 31
---

Install `@content-query/mdx` alongside ContentQuery and React 19. This optional companion owns MDX compilation and rendering; core keeps its existing metadata queries and Markdown renderer. The initial integration supports Vite 8 SSR.

## Configure MDX

```ts
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

The loader supports `pattern` and `generateId`, captures YAML frontmatter and source text, and uses the existing watcher for additions, edits, and deletions. Query metadata normally; rendering stays explicit and separate from queries. Core's `render()` does not compile MDX bodies.

Add `contentQueryMdx()` from `@content-query/mdx/vite` alongside `contentQuery()` and your React plugin. Its `rendering` option is `"islands"` by default; choose `"react"` to emit ordinary browser document modules or `"both"` to support both modes. MDX declarations and build intermediates live under `.content-query/mdx/`. Ignore `.content-query/` and include `.content-query/**/*.d.ts` in TypeScript to cover both core and MDX declarations.

## Choose a React tree

```mdx
import { Counter } from "../widgets/counter";
import { Quiz } from "../widgets/quiz";
import { BrowserNote } from "../widgets/browser-note";

# Interactive MDX

The prose remains useful before JavaScript loads.

<Counter client:load initialCount={0} />
<Quiz client:visible />
<BrowserNote client:only />
```

In **islands mode**, unmarked components render on the server. `client:load` hydrates immediately, `client:visible` waits for visibility, and `client:idle` waits for idle time after load. `client:only` imports and mounts only in the browser, keeping browser-only modules out of server evaluation. Each widget has an independent React root. Share data through props, and put a widget's providers and internal components inside that widget.

In **React mode**, the document is an ordinary MDX component in your application's React tree. Providers can reach all its widgets. Timing directives are stripped; `client:only` remains lazy within that same tree.

Imported default, named, and namespace-member widgets are supported. Island props can contain supported `devalue` data, including dates, maps, and BigInts. Functions and React elements cannot cross the boundary. Use text children or data props; formatted slots and nested island declarations remain deferred.

## Render and hydrate

All Vite server APIs come from one virtual module:

```ts
import { renderMdx, loadMdxDocument } from "content-query:mdx:server";

const islands = await renderMdx("guides", id);
const reference = await loadMdxDocument("guides", id);
```

`renderMdx(collection, id, options?)` returns `{ html, headings, styles }` and resolves assets automatically. Options accept `props` and `components` overrides. Insert the required stylesheet links before displaying the HTML. In the browser, `mountIslands(article)` from `@content-query/mdx/client` returns a disposer; call it before replacing the article.

For a React application, render island results with `MdxIslands` from `@content-query/mdx/react`; it manages widget scheduling and disposal during navigation. For a normal React document, call `loadMdxDocument(collection, id)` in a server loader and return its selected browser reference. Render that reference with `MdxDocument` from `@content-query/mdx/react`. The document shares the application's existing root and providers. Both helpers use React 19 stylesheet resources to wait for CSS before displaying content.

The lower-level server-side `loadMdx(collection, id)` still returns the component, headings, and authored exports. Browser-side `loadMdx(reference)` imports only the selected document for a custom host's hydration lifecycle. Keep the complete manifest on the server.

Both modes support component overrides, GFM, heading IDs, syntax highlighting, and configurable remark/rehype plugins. Widget entries are shared across documents. Island pages never download the document's JavaScript module. A standalone prose-only page needs no React runtime; React-based host frameworks still download React to hydrate their application shell.

## Build and navigate

For React Router and other Vite Environment API application builds, use the framework's normal build command. The MDX plugin collects static-component styles in an internal server environment, preserves static assets, and embeds the generated browser manifest in the final server bundle. Rendering resolves the manifest automatically; `getMdxAssets()` from `content-query:mdx:server` is available for advanced reference access. Custom two-pass Vite SSR builds can still build the server first, build browser entries afterward, and load `.vite/content-query-mdx-manifest.json` explicitly with `createMdxAssets(manifest)`, passing `{ assets }` to `renderMdx()`.

The [React Router SSR example](https://github.com/yangshun/content-query/tree/main/examples/react-router-mdx) demonstrates both modes with ordinary framework routes and no custom server, build script, or client entry. React Router owns navigation, metadata, history, and stale loader requests; the package owns stylesheet loading and island lifecycles. Production tests run without application source or content files. Context sharing is covered by the package's React integration tests.

## Next.js and other hosts

The shared compiler emits ordinary ESM and preserves component imports. A future Next adapter can use native Server/Client Components and Next-owned hydration through a separate path, without the standalone island renderer. **Next MDX runtime support is not yet verified or included.** The existing [Next integration](/docs/integrations/next) covers core metadata and Markdown.

See the [package reference](https://github.com/yangshun/content-query/tree/main/packages/mdx) for APIs and the [architecture review](https://github.com/yangshun/content-query/blob/main/docs/MDX-ARCHITECTURE.md) for boundaries. Remote MDX, streaming, other UI frameworks, and formatted island slots remain deferred.
