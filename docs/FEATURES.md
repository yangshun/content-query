# ContentQuery v1 features

- Standard Schema metadata/computed validation and output inference, with grouped contextual errors.
- Computed context includes the collection registry key and optional, typed loader source metadata. Built-in file loaders supply project-relative paths and multi-record keys; source-only edits participate in preparation cache invalidation. Existing Astro loaders remain compatible without supplying the ContentQuery metadata extension.
- `content-query/computed` provides reusable `readingTime()`, `wordCount()`, and `excerpt()` computed definitions with Standard Schema result types. Captured-body defaults, typed async input selectors, Markdown/text/HTML extraction, configurable reading speed, Unicode-safe excerpt limits, and cancellation work during preparation; only results enter deployed query data.
- Build-only root `content-query.config.{ts,mts,cts,js,mjs,cjs}` discovery, ambiguity errors, and an exact custom-path override; generated typings and Vite client guards follow the selected config. Source acquisition stays in preparation, with source-independent deployed queries and rendering.
- Markdown, JSON, YAML, TOML, and native Astro-compatible named content loaders with matching built-in identities. Existing content loader packages can be passed directly to collections; no adapter API is required.
- Loader stores, inherited schemas and dynamic schema factories, collection-schema precedence, parsed-data reuse, digests, session metadata, logger/config helpers, portable Markdown rendering, and transactional asynchronous watcher callbacks.
- Equivalent immutable fluent and Prisma-style object queries over shared normalized plans, mandatory field selection, typed operators, stable sorting, pagination, and counts.
- Markdown folder `source` shorthand and explicit Markdown/JSON/YAML/TOML source objects alongside native loaders.
- `_adjacent` and fluent `selectAdjacent()` projections, default ID neighbors, independent filtered/ordered sibling scopes, and typed nested neighbor selection.
- Generated `CollectionKey`, `CollectionData`, and `Collections` aliases for physical and `content-query:server` entries.
- Browser-safe `content-query:client` update subscriptions with serialized router revalidation and full-reload fallback; Void preserves component state and scroll.
- Forward/inverse relationships, explicit reference ownership, authored arrays, nested selection, and per-parent pagination.
- Rich value/presence preservation through synchronous devalue encoding and detached results.
- Explicit retained-body access, supplied HTML, built-in HTML/headings rendering, and eager/deferred Markdown policy.
- In-memory and generated backends using the same JavaScript query semantics.
- Portable generated ESM indexes and lazy payloads, typed standalone `buildContent()` with `BuildContentOptions` from `content-query/build`, the CAC-based `content-query build` CLI with `--watch`, and optional Vite integration. The CLI provides help/version output without loading configuration, short aliases, and equals-form values while rejecting invalid or repeated build options. Build diagnostics use `operation: "build"`.
- [Void](../examples/void/README.md), [React Router](../examples/react-router/README.md), [TanStack Start](../examples/tanstack-start/README.md), [Next.js](../examples/next/README.md), [SvelteKit](../examples/sveltekit/README.md), and [Angular](../examples/angular/README.md) examples use native server loaders/functions and verify production rendering. Next.js uses `withContentQuery()` from `content-query/next` for managed watching and generated-module HMR; the Vite examples subscribe to content updates. Angular uses native `@angular/ssr`, Router resolvers, and server API routes, with CLI content watching triggering Angular rebuilds.
- One default `.content-query/` directory for generated runtime artifacts and Vite declarations; in-memory Vite emits only types, while standalone in-memory preparation writes no files.
- Generated watch sessions prune obsolete collection modules from previous runs after their first successful publication, then retain this session's revisions. Next.js also prunes previous-run development runtime entries while preserving the new entry; one-shot builds prune superseded artifacts.
- Settled filesystem writes, ordered candidate updates, cancellation, atomic publication, pinned operations, failure recovery, and owned-resource cleanup.
- Configuration failures stay active until a successful reload and preparation; loader-owned watcher listeners are released on configuration reload and disposal.
- Explicit source watches cover declared inputs under ignored project directories and missing inputs, honor glob exclusions, and exclude generated output.
- Vite diagnostics preserve BigInts, supported value graphs, and Error cause details across isolated runtimes; initial validation errors recover without restarting.
- Vite client-import rejection and runtime server-only fallback guards.
- Large-collection preparation reuses Markdown parser rules and unchanged immutable artifacts, with bounded publication I/O. Vite ignores generated output, prepares production content only for server graphs, and packs payload sources into lazy modules targeting 128 KiB before bundling, including hosts with strict entry signatures.
- Separate collection, query, runtime, preparation, loader, artifact, and integration modules behind stable package entry points; colocated unit tests and separate integration fixtures.

Verification combines shared conformance tests, typed callsites, controlled watch/race tests, loader tests, the published Astro CSV loader, native schema/watcher contracts, real generated/CLI consumers, Vite bundles, and the migrated VoidPress app. SQLite and other [future extensions](./PLAN.md#future-extensions) are intentionally outside v1.
