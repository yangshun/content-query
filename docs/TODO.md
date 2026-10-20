# TODO

Outstanding tasks and future design notes. Implemented capabilities are documented in [FEATURES.md](./FEATURES.md); [PLAN.md](./PLAN.md) records the v1 contracts.

## Index

- **Querying and storage**
  - [Indexing for joins](#indexing-for-joins)
  - [SQLite storage and SQL queries](#sqlite-storage-and-sql-queries)
  - [Built-in search](#built-in-search)
  - [Cursor pagination](#cursor-pagination)
  - [General-purpose joins](#general-purpose-joins)
  - [Browser querying](#browser-querying)
  - [Richer filtering](#richer-filtering)
  - [Advanced relationship queries](#advanced-relationship-queries)
- **Content modeling and authoring**
  - [Schema generation and inference](#schema-generation-and-inference)
  - [File-based ordering](#file-based-ordering)
  - [Singletons](#singletons)
  - [Authoring ergonomics](#authoring-ergonomics)
- **Sources and runtime loading**
  - [CMS-specific adapters](#cms-specific-adapters)
  - [Lazy source bodies and cross-operation snapshots](#lazy-source-bodies-and-cross-operation-snapshots)
  - [Live collections and runtime source loading](#live-collections-and-runtime-source-loading)
- **Processing and rendering**
  - [Build-time transforms](#build-time-transforms)
  - [Collection-wide computed context](#collection-wide-computed-context)
  - [Built-in derived fields](#built-in-derived-fields)
  - [Configurable Markdown processing](#configurable-markdown-processing)
  - [MDX and component content](#mdx-and-component-content)
- **Assets and links**
  - [Typed content href helpers](#typed-content-href-helpers)
  - [Assets and images](#assets-and-images)
- **Caching and performance**
  - [Public preparation cache helper](#public-preparation-cache-helper)
  - [Persistent preparation cache and benchmarks](#persistent-preparation-cache-and-benchmarks)
- **Integrations and developer tooling**
  - [Validation-only command](#validation-only-command)
  - [Automatic content updates](#automatic-content-updates)
  - [Host integrations and editor tooling](#host-integrations-and-editor-tooling)

## Future improvements

### Indexing for joins

- Change index structure to allow fast lookup during joins.
  - Possibly allow for indexing on multiple fields.

### SQLite storage and SQL queries

- SQLite storage and SQL query execution, preserving collection definitions, query call sites, values, body access, and rendering. Follow the [backend contract](./PLAN.md#1-keep-the-public-api-independent-of-the-backend).

### Built-in search

- Built-in search.

### Cursor pagination

- Cursor pagination; the current query API uses limit and offset.

### General-purpose joins

- General-purpose joins and implicit recursive relationship loading. See [advanced relationship queries](#advanced-relationship-queries).

### Browser querying

- Browser querying.

### Richer filtering

- **Richer filtering:** map/set-specific filters, binary and other rich-value filtering, regular expressions, and deep object equality remain outside v1. These values can still be stored and selected under the supported data-value contract.

### Advanced relationship queries

Status: deferred beyond v1 on October 18, 2026.

Parent predicates based on related data, composite multi-field matching, and automatic traversal through linking collections need separate query and declaration contracts. No `exists`, composite-key, or `through` public syntax is selected. Applications can explicitly query declared links and request bounded nested relationships in v1. General-purpose joins remain a separate future capability.

### Schema generation and inference

- Generate or infer schemas from content.

### File-based ordering

- File-based ordering, such as `meta.json`.

### Singletons

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

Content Collections provides `defineSingleton()` and Velite provides `single: true` for one-record sources such as site settings. `file()` treats a top-level object as keyed entries, so a settings file needs a wrapper entry and a `first()` query.

Define whether a singleton is a collection with exactly one entry and a fixed ID or a separate registry kind with its own runtime accessor, how it interacts with relationships and field selection, and whether a missing optional file yields `undefined`, as in Content Collections.

### Authoring ergonomics

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

Every query is async and must select fields. A relationship declaration needs `collection`, `type`, `from`, `to`, and `referenceSide`, while Astro uses `reference("authors")` inside the schema. These choices buy payload control and relationship integrity, but the simplest page is more verbose than importing `allPosts` from Content Collections.

Candidates that keep [explicit field selection](./PLAN.md#3-require-explicit-field-selection) include relationship shorthands with defaults such as `to: "id"` and a schema-level reference helper that declares the relationship. An implicit select-all or a synchronous array export would contradict the design guidelines and needs a separate decision.

### CMS-specific adapters

- CMS-specific adapters; custom loaders remain the existing extension point.

### Lazy source bodies and cross-operation snapshots

Status: deferred beyond v1 on October 18, 2026.

Lazy source-reader callbacks would require pinning or verifying external source versions and defining stale-read errors, retry policy, cancellation, and lifecycle behavior. V1 loaders instead capture optional body strings. Revisit source laziness only if a concrete source makes its acquisition cost worthwhile; prepared backend payload loading can remain lazy independently.

Public multi-operation scopes such as the proposed `withSnapshot()` would need revision retention, body/output pinning, cleanup, and rules for builders or handles escaping the scope. V1 guarantees consistency per operation and documents that separate development operations can observe different revisions. Immutable production artifacts do not require this additional API.

Neither extension should reintroduce `content-query.config` imports, original source paths, arbitrary callback extraction, or automatic replay of application callbacks in deployed SSR.

### Live collections and runtime source loading

Status: deferred beyond v1, agreed on October 17, 2026. No live-collection API, loading-policy syntax, or separate configuration file is approved.

A future extension could fetch current CMS or API content during SSR, such as an article from Contentful, without rebuilding the site. In v1, applications can fetch live data directly in server-rendering functions or server routes and use ordinary validation and processing utilities. A collection layer is useful when those consumers also need shared collection validation, querying, relationships, and processing; live fetching alone does not require one.

Two approaches remain open:

| Approach                         | Behavior                                                                                                                   | Design implications                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh prepared content         | Run loaders at runtime, validate inputs, prepare computed fields, and publish a revision for the existing query runtime.   | Can retain the prepared-store query contract. Full-snapshot refreshes may fetch and process an entire collection; freshness, refresh scope, and runtime-writable storage need design.                                                         |
| Query a remote provider directly | Give a runtime loader a query or entry lookup and return matching entries without first preparing the complete collection. | Requires a query-aware loader contract, supported-operation rules, and decisions about computed-field filtering, pagination, relationships, and validation over partial datasets. It is not provided by the current snapshot-loader contract. |

Loading policy and storage backend are separate decisions. A remote source may be loaded during a build or at runtime. Runtime loading can use an in-memory store or another backend that supports updates; generated deployment artifacts must not be assumed writable. The v1 guarantee that prepared content works without original sources remains the default; a future live policy would explicitly depend on runtime source availability.

Keep the source-acquisition/processing boundary in either approach: loaders acquire inputs and computed processing or built-in rendering derives values from those inputs. A future live policy would need an explicit runtime source module and configuration contract; it must not silently make v1 `content-query.config` part of the deployed import graph.

Before implementation, define freshness and caching, invalidation or explicit refresh, request isolation and credential handling, concurrent refresh behavior, revision consistency across entries and collections, error and stale-data policies, and the interaction with static generation. Decide whether the existing collection/query APIs can cover the chosen model or whether separate live APIs and configuration entry points are warranted; no separation is required merely to run a loader during SSR.

Reference: [Astro's live collections](https://docs.astro.build/en/guides/content-collections/#live-content-collections) use separate APIs and loaders that return request-time data directly. The [original proposal](https://github.com/withastro/roadmap/discussions/1137) explicitly excluded updating its content-layer store. That is a different contract from refreshing prepared content and is a reference for the second approach, not an API decision for this library. Astro live loaders also return cache hints (`tags` and `lastModified`) that applications pass to `Astro.cache.set()` or response headers. A ContentQuery live design should decide whether freshness metadata belongs in runtime results.

### Build-time transforms

- General build-time transforms for typed output reshaping and conditional entry omission. See [build-time transforms](#build-time-transforms).

Status: deferred beyond v1 on October 19, 2026. No public transform API is selected.

Support general entry transforms that can add, replace, or remove fields, process captured bodies asynchronously, and omit entries such as drafts before publication. Coordinate cross-entry derivation with the [collection-wide computed context](#collection-wide-computed-context) and reusable expensive work with the [public preparation cache helper](#public-preparation-cache-helper).

Before implementation, define output type inference and validation, execution order relative to schema transformations and computed fields, entry identity, and relationship validation when entries are omitted. Cover dependency invalidation during watching, errors, and cancellation. Only supported serialized results should reach deployed artifacts; transformation callbacks and their build-only dependencies must stay out of the runtime import graph.

### Collection-wide computed context

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

`ComputedContext` exposes one entry's `collection`, `id`, optional loader-defined `source`, `data`, `readBody()`, and `signal`. Per-tag counts and sidebar order require application queries after preparation. Previous/next entries are available through the query-time `_adjacent` projection and fluent `selectAdjacent()`. Content Collections exposes `documents()` and `collection.documents()` in `transform`, and Velite's `prepare` hook receives every collection. Ordering files such as `meta.json` remain [parked](#parked).

A collection-wide context changes invalidation: one edit can affect every dependent computed value, possibly across collections. Define whether the context exposes validated metadata only or earlier computed results, how dependency cycles are rejected, how cross-collection reads relate to declared relationships, and how watch updates recompute dependents. Use the existing query-time adjacency APIs when collection-wide preparation is unnecessary.

### Built-in derived fields

Status: reading time, word count, and excerpt helpers implemented on October 19, 2026. Other derived fields remain deferred beyond v1.

`content-query/computed` exports `readingTime()`, `wordCount()`, and `excerpt()` as reusable computed definitions with Standard Schema results. Helpers support captured Markdown bodies and typed selectors for text/HTML fields. See the [implemented contract](./PLAN.md#reusable-computed-text-fields).

Queryable headings, table of contents, slug helpers, and uniqueness helpers remain future work. Rendered headings are available only from `content.render()`. Any helper derived from rendered output must make its compilation cost explicit under [guideline 8](./PLAN.md#8-make-expensive-work-explicit), and uniqueness across a collection depends on the [collection-wide context](#collection-wide-computed-context).

### Configurable Markdown processing

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

The built-in renderer uses fixed markdown-exit options and GitHub Light/Dark Shiki themes, and accepts no extensions. Astro, Content Collections, and Velite accept remark/rehype plugins and highlighter settings. Documentation sites use these for callouts, math, code block titles, and link handling.

Eager compilation (`deferRender: false`) already runs during the build, so build-only extensions could apply without entering the deployed import graph. `deferRender: true` packages the renderer, so extensions would need serializable settings or module references that generated runtime code imports directly, never functions extracted from `content-query.config`. markdown-exit uses a markdown-it token pipeline rather than unified, so the design must choose between markdown-it-style plugins, a unified pipeline, or a curated set of built-in options.

Before implementation, define the extension contract, how settings participate in invalidation and revision consistency, how `headings` stays consistent with HTML heading IDs when extensions change headings, and whether extensions are allowed with `deferRender: true`.

### MDX and component content

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

Rendering returns framework-independent HTML. Astro supports MDX and Markdoc with component mapping. Content Collections offers `@content-collections/mdx` and bundler-compiled static imports through `createDefaultImport()`. Velite compiles `s.mdx()` to function-body code.

Component content conflicts with framework independence and with packaging rules that exclude application callbacks. One candidate is an entry field that records a typed module reference to the source file, so the host bundler compiles it and `content.render()` stays unchanged for HTML content. Define how references are typed, how component modules cross the [server/client boundary](./PLAN.md#4-enforce-the-serverclient-boundary) when pages import them, and how headings are extracted without a framework renderer.

### Typed content href helpers

- Typed content href helpers.

### Assets and images

- Resolve source-relative images into emitted assets. See [assets and images](#assets-and-images).

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

Authored image and link URLs pass through unchanged, and [application-owned behavior](./PLAN.md#application-owned-behavior) keeps asset discovery, copying, optimization, and URL rewriting outside this library. Relative images in Markdown therefore break unless the application handles them. Astro provides an `image()` schema helper with optimization and resolves relative Markdown images. Velite's `s.image()` and `s.file()` copy, hash, and measure assets and generate blur placeholders.

Moving this boundary would need an asset reference value under the [supported data values](./PLAN.md#supported-data-values), path resolution relative to the source entry, asset emission through the host bundler or a portable output directory, consistent Markdown reference rewriting for eager and deferred rendering, and watch invalidation when an asset changes. Image optimization could remain an integration concern even if discovery and URL resolution move into preparation.

### Public preparation cache helper

- Public preparation cache helper for expensive custom processing. See [public preparation cache helper](#public-preparation-cache-helper).

Status: deferred beyond v1 on October 19, 2026. No public cache API is selected.

Expose a helper for memoizing expensive preparation-time operations inside computed fields and future [build-time transforms](#build-time-transforms), such as custom Markdown compilation or metadata enrichment. This caches individual operations, beyond the current internal reuse of whole prepared entries.

Define operation namespaces and input keys, code and dependency invalidation, cache lifetime, supported result values, concurrent request deduplication, and handling of failures and cancellation. External data needs an explicit freshness policy. Coordinate persistence with the [persistent preparation cache](#persistent-preparation-cache-and-benchmarks); a public helper does not itself require disk storage. Removing or clearing the cache must affect only performance.

### Persistent preparation cache and benchmarks

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

The preparation cache lives for one session, so every cold build reloads, validates, computes, and compiles all content again. Astro persists its data store, entry digests, and loader `meta` between builds. Content Collections memoizes transforms with `cache()`. Astro and Velite publish scale claims; ContentQuery has no benchmark.

[Guideline 9](./PLAN.md#9-prioritize-correctness-over-caching) requires that removing a cache affects only performance. Persistent keys must cover source content, loader identity, schema and resolver code, library version, and renderer settings. Resolver code identity is the hard part because computed functions can import arbitrary modules. Establish benchmarks at representative sizes before choosing a cache layout, and decide whether loaders get a persistent `meta` store for sync tokens.

### Validation-only command

- Add a lightweight CLI command that validates source content against collection schemas without generating runtime artifacts, declarations, or rendered output.
- Collect schema errors across entries and report clear diagnostics with collection names, source paths, and field paths instead of crashing on invalid content.
- Exit successfully when all content is valid and return a nonzero exit code when validation fails, so editors and CI can use it without a build.
- Reuse the normal schema-validation rules while skipping computed fields, rendering, and artifact publication.

### Automatic content updates

- Remove manual `onContentUpdate` plumbing.

### Host integrations and editor tooling

Status: deferred beyond v1 on October 18, 2026, from the [library comparison](./COMPARISONS.md#gaps).

V1 ships the CLI, a Vite plugin, and an optional Next.js configuration wrapper with managed development watching. Generated output works with other hosts, which must enforce the server-only boundary themselves. Content Collections ships Next.js, Remix, Solid Start, and Vinxi adapters.

Astro generates a JSON Schema per collection for data-file IntelliSense, and Content Collections exports named entry types through `typeName`. ContentQuery now generates `CollectionKey`, `CollectionData<"posts">`, and `Collections` aliases alongside the server entry and Vite facade, in addition to `QueryData<typeof collections.posts>`. Standard Schema validation does not expose JSON Schema, but `@standard-schema/spec` 1.1 defines a companion `StandardJSONSchemaV1` interface that providers can implement. Schema generation remains [parked](#parked); named data types are implemented.
