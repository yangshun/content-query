# Optional MDX architecture and Next.js review

`@content-query/mdx` owns the complete MDX dependency graph. Core accepts its native loader, validates frontmatter, computes fields, retains bodies, and publishes query metadata through the existing session. Core source formats, Markdown output, renderer, client guard, and dependencies are unchanged.

The only generic core addition is an immutable source snapshot and revision subscription. `ContentSession.sources()` returns `{ revision, entries: [{ collection, id, filePath? }] }`. `subscribe(listener)` reports `{ type: "ready", snapshot }` after successful publication or `{ type: "error", error }` after failure, and returns an unsubscribe function. Vite exposes `contentQuery().api.prepare()` and `.subscribe()` over the same session. Revisions are opaque and session-scoped; no source body or schema is exposed. Metadata preparation does not compile MDX bodies.

## Boundaries

| Layer                 | Responsibilities                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Core                  | Validation, computed fields, retained bodies, metadata/indexes, watcher, atomic publication.                       |
| Shared compiler       | MDX AST analysis, ordinary React ESM, headings, maps, plugin hooks, logical widget references.                     |
| Vite integration      | Import resolution, lazy development transforms, per-target caches, virtual entries, build manifest, CSS discovery. |
| Standalone React SSR  | Independent widget roots, supported data serialization, matching identifier prefixes, buffered HTML.               |
| Browser scheduler     | Visibility/idle timing, URL imports, lifecycle cancellation; React arrives through widget entries.                 |
| React host helpers    | Selected document modules in the existing tree, stylesheet resources, island cleanup during host commits.          |
| Application/framework | Routes, layout/provider placement, HTTP, chosen rendering mode, navigation, and application hydration.             |

The companion exposes one public virtual module, `content-query:mdx:server`, with `loadMdx`, `loadMdxDocument`, `renderMdx`, and the advanced `getMdxAssets` helper. Core's `content-query:server` remains the metadata/Markdown entry. Core resolves its known facade IDs exactly, and its existing client guard also protects the MDX facade. Private MDX module IDs retain the separate `\0content-query-mdx:` prefix so core does not resolve them.

Generated artifacts use `.content-query/mdx/`, owned by the companion inside the existing generated directory. The `.content-query/` ignore rule and `.content-query/**/*.d.ts` TypeScript include cover both packages. Browser document loading receives a selected `{ url, css }`, with no corpus-wide importer registry. Server lookups use lazy document importers; shared widget identities use resolved module/export pairs. The default browser build emits widgets only. For Vite application builds, an internal MDX server environment collects static-component styles and assets before the framework builds its browser entries. The plugin merges static assets and embeds the browser manifest in the final server bundle. Rendering and selected-reference APIs resolve assets automatically; custom two-pass builds can still run SSR first and pass the manifest explicitly.

## React tree choices

Islands transform marked JSX into server-only boundaries. Each boundary renders and hydrates independently; providers outside that root cannot reach it. Data props cross through `devalue`, while functions, React elements, formatted slots, and nested island declarations are rejected or deferred. Unmarked components remain server-rendered.

The React target preserves an ordinary MDX component. Scheduling directives are removed, and browser-only widgets use a lazy component in the existing tree. Host context is shared normally. Component modules and exports remain statically visible to the host bundler.

The React Router example uses framework-owned server/client entries, HTTP handling, builds, and navigation. `loadMdxDocument` primes the selected SSR component and returns a serializable reference. `MdxDocument` resolves that reference within the existing application root; `MdxIslands` owns independent widget lifecycles and defers their teardown until the host commit completes. React Router hydrates its shell on both routes, so this example does not claim zero React downloads on prose-only pages. Plain Vite integration fixtures continue to verify the lower-level, framework-independent path.

## Future native Next.js adapter

Next documents native MDX imports in Server Components and uses `"use client"` to establish client module boundaries. Client providers can wrap server-supplied content and supply context to client descendants. See the official [MDX guide](https://nextjs.org/docs/app/guides/mdx) and [Server and Client Components guide](https://nextjs.org/docs/app/getting-started/server-and-client-components).

The architecture preserves a viable adapter path:

1. Use the shared compiler's ordinary React ESM target. Imports and exports remain intact, and imported widget modules retain their own `"use client"` directives. No Vite runtime, asset manifest, `react-dom/server`, or standalone hydration calls enter ordinary output.
2. Feed those modules into Next's own module graph. Next must recognize client boundaries and own the RSC payload, serialization, asset handling, routing, and hydration. Do not treat standalone island HTML as a Next Client Component.
3. Implement `client:only` as a native client wrapper using Next-supported browser-only loading. The compiler accepts a host-generated import through `resolveIsland`; it does not mandate Vite's wrapper or its root scheduler. Native `"use client"` components can also be used without scheduling syntax.
4. Share metadata identities through the existing core integration. Keep any generated lookup registry on the server, and preserve Next's server-only protections and development invalidation.

Ordinary MDX output is tested to contain no Vite or standalone renderer dependency, and published lazy React helpers retain their `"use client"` directive. The Node-only SSR helper is a separate entry. This is an architecture review, not a successful Next runtime test: Turbopack/Webpack transforms, native RSC behavior, client-only loading, CSS/assets, navigation, and development recovery all require their own adapter and acceptance suite. The existing `content-query/next` metadata/Markdown adapter does not automatically enable this MDX package.

## Verification scope

Package tests cover source loading/validation, compiler plugins and diagnostics, source maps, directives, component overrides, serialization, IDs, application React context, StrictMode lifecycles, scheduling, CSS loading, disposal races, shared entries, Vite updates, client-first framework builds, and recovery. Production Chromium tests verify the React Router example after its application source, content, and collection configuration are removed. Core retains its dependency boundary and existing coverage thresholds. Structural checks verify lazy document loading and shared widget entries; no large-corpus benchmark is claimed.
