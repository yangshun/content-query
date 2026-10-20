# ContentQuery

A framework-independent content collection library with typed queries, explicit field selection, relationships, captured bodies, and Markdown rendering. Content builds run during development or your application's build. Production consumes prepared content without loading source files or importing collection configuration.

## Source layout

Top-level `src/` files preserve the package entry points. Implementations live with the subsystem that owns them:

```text
src/
  collection/     Collection definitions, schema inference, registry checks
  query/          Portable query plans, operators, fluent builders, query types
  runtime/        JavaScript execution, projection, relationships, bodies, rendering
  preparation/    Configuration, validation, source updates, sessions, watching
  loaders/        Glob/file acquisition, source descriptors, parsing, loader types
  artifacts/      Artifact format, ESM generation, publication, runtime decoding
  integrations/
    cli/          Command arguments and diagnostic reporting
    vite/         Plugin lifecycle, client boundaries, virtual-module delivery
  shared/         Errors, value semantics, paths, server-only guard
tests/
  integration/    PLAN.md living example, generated consumers, CLI, Vite dev and builds
  fixtures/       Executable end-to-end example
  helpers/        Consumer fixtures and package-build setup
```

Unit tests stay beside their owning modules. Query plans are independent of JavaScript evaluation so another backend can interpret the same contract. Preparation owns source acquisition and validation; production runtime code consumes prepared revisions without importing preparation or host integrations. Artifact generation/writing and runtime decoding use separate modules to preserve that boundary. Session update ordering, cancellation, and atomic publication stay together in `preparation/session.ts`.

Filesystem watching waits briefly for settled writes before reloading sources, including external sources. This coalesces partial writes and preserves rapid invalid-edit/correction recovery.

Declared `file()` and `glob()` inputs have their own subscriptions, including inputs under directories such as `dist/` and `coverage/` that the general project watcher ignores. Watches are ready before loading and cover later creation of missing inputs. Glob exclusions still apply. ContentQuery's generated output is excluded from source watching to prevent reload loops.

Configuration reloads follow the config's evaluated module graph: the config file plus every module Jiti transpiles for it (TypeScript, and CommonJS `.js` inside ESM packages), including modules outside the application root. Editing other application modules neither reloads content nor discards prepared work. Natively loaded `.mjs`, `.cjs`, ESM `.js`, and JSON imports stay in Node's module cache, so a reload cannot observe them; restart the watch session after editing those. While a configuration fails to load, any JavaScript/TypeScript change retries it. Custom loaders can call `context.watcher.add()` for additional files and update their store in watcher callbacks. Glob collections reload only for files their patterns can match, so images, editor swap files, and excluded paths change nothing; removing a directory reloads conservatively.

Application imports such as `content-query/query`, `content-query/computed`, `content-query/build`, and `content-query/vite` remain the supported API. The `content-query/internal` entries exist for generated modules and integration wiring.

## Define collections

```ts
// content-query.config.ts — build-only
import { defineCollection } from "content-query";
import { file } from "content-query/loaders";
import { z } from "zod";

const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: z.object({ name: z.string() }),
});

const posts = defineCollection({
  source: "./content/posts", // A string selects Markdown by default.
  schema: z.object({ title: z.string(), authorId: z.string(), draft: z.boolean().default(false) }),
  computed: {
    upperTitle: { schema: z.string(), resolve: ({ data }) => data.title.toUpperCase() },
  },
  relationships: {
    author: {
      collection: "authors",
      type: "one",
      from: "authorId",
      to: "id",
      referenceSide: "from",
    },
  },
});

export const collections = { authors, posts };
```

A string `source` scans a directory recursively for Markdown. For an explicit format, use `source: { type: "markdown", directory: "./content/posts" }`; `"json"`, `"yaml"`, and `"toml"` select individual record files instead. The object form also accepts `include` (one pattern or an array, including exclusions), `generateId`, `retainBody`, and `deferRender`. These are the same built-in glob loader semantics. Use `loader` for multi-record files, custom parsing, or external loaders. Specify exactly one of `source` and `loader`.

Any Standard Schema V1 provider can validate collection metadata and computed results. Async validators/resolvers are supported. Validated outputs determine query types and are stored without rerunning transforms at runtime. Collection schemas are optional: an explicit schema overrides the loader’s `schema` or asynchronous `createSchema()` default. Loader defaults also support Zod 3 and Zod 4, including core schemas. Declare a collection schema when you need precise static field inference; dynamically discovered loader schemas provide named fields with `unknown` values.

Computed resolvers receive the registry key `collection`, entry `id`, validated `data`, optional loader-defined `source` metadata, captured `readBody()` text, and cancellation `signal`. `glob()` and collection `source` shorthand provide `{ filePath }`; multi-record `file()` adds the original record `key` (a keyed-object property or array index, as a string). Paths use forward slashes and are relative to the application root, preserving the original filename independently of custom IDs. Access optional metadata with `source?.filePath` or a presence check. Context metadata becomes queryable only when explicitly returned by a computed field.

Custom loaders can declare `Loader<Source>` and attach `source` to their store entries. `defineCollection()` infers that metadata type for resolvers independently of schema-validated `data`. Source metadata is detached for every resolver, must contain supported data values, and stays out of deployed artifacts unless returned by a computed field. Untyped loaders expose `unknown` source metadata, which must be narrowed before accessing fields.

`glob()` supports Markdown and individual JSON/YAML/TOML records. Default IDs follow Astro's slug generation, raw `slug` override, and trailing `/index` removal. `generateId` overrides this policy. A captured Markdown body excludes frontmatter and the blank lines separating it from the content. `file()` reads multi-entry arrays or keyed objects and accepts an async custom parser. Built-in paths resolve from the application root.

## Reusable computed fields

`content-query/computed` exports `readingTime()`, `wordCount()`, and `excerpt()`. They return ordinary `{ schema, resolve }` definitions with Standard Schema result types, and can sit alongside custom computed fields:

```ts
import { excerpt, readingTime, wordCount } from "content-query/computed";

computed: {
  readingMinutes: readingTime({ wordsPerMinute: 200 }),
  wordCount: wordCount(),
  excerpt: excerpt({ maxLength: 160 }),
}
```

Reading time is a whole number of minutes rounded up, defaulting to 200 words per minute. Word count uses the `reading-time` package's estimated word boundaries, including its CJK handling. Excerpts are normalized plain text, defaulting to at most 160 Unicode graphemes including a trailing `…` when shortened. They prefer whole words and preserve emoji and combining characters. Empty or absent text produces `0` or `""`.

`TextOptions<Data, Source>` supplies `format: "markdown" | "text" | "html"` (default `"markdown"`) and optional `from(context)` for synchronous or asynchronous text selection. Omit `from` to use the captured body. Markdown extraction retains prose, code, and image alternatives while dropping syntax and link destinations. HTML extraction decodes entities and separates blocks, skips comments and head/script/style/template/noscript/hidden content, and does not evaluate CSS. Text mode preserves literal markup and entities. Whitespace is normalized in every format.

For structured data, type the selector from the collection schema. For example, alongside `schema: articleSchema`:

```ts
computed: {
  summary: excerpt<z.infer<typeof articleSchema>>({
    from: ({ data }) => data.description,
    format: "text",
    maxLength: 160,
  }),
}
```

Supply loader metadata as the second type argument when selecting from `source`. `ReadingTimeOptions<Data, Source>` adds finite positive `wordsPerMinute`; `ExcerptOptions<Data, Source>` adds positive-safe-integer `maxLength`. Bad options fail at declaration time. Selectors must return a string or `undefined`; failures become normal contextual preparation diagnostics, and helpers honor the resolver's abort signal.

Results become ordinary typed fields for selection, filtering, and sorting. Helpers run during preparation, including with `retainBody: false`; deployed queries import neither these helpers nor their text-processing dependencies. Text helpers use a Markdown parser without initializing syntax highlighting. See the [computed fields guide](../../website/content/guides/computed-fields.md) for complete configurations and queries.

## Astro-compatible content loaders

The named loader interface and standard entry fields remain Astro-compatible. Optional entry `source` metadata and its TypeScript generic are ContentQuery extensions: existing Astro loaders need no changes, and Astro's own store does not retain this extension. The standard `filePath` field remains available for diagnostics independently of source metadata. Store reads keep the standard shape, so custom source metadata read directly from the store remains `unknown`.

ContentQuery uses Astro’s named, store-writing content loader contract directly. Pass an existing loader package to `defineCollection()` without a wrapper:

```ts
import { defineCollection } from "content-query";
import { csvLoader } from "@ascorbic/csv-loader";
import { z } from "zod";

export const collections = {
  authors: defineCollection({
    loader: csvLoader({ fileName: "./content/authors.csv", idField: "id" }),
    schema: z.object({ name: z.string() }),
  }),
};
```

Custom loaders implement `name` and asynchronous `load(context)`, which updates `context.store` and returns no entries:

```ts
import type { Loader } from "content-query";

const notices: Loader = {
  name: "notices",
  async load(context) {
    const id = "status";
    const data = await context.parseData({ id, data: { title: "All systems operational" } });
    context.store.clear();
    context.store.set({ id, data, digest: context.generateDigest(data) });
  },
};
```

The context supplies `collection`, `store`, `meta`, `logger`, `config`, `parseData()`, `generateDigest()`, `renderMarkdown()`, and an optional development `watcher`. ContentQuery also supplies an optional load-attempt `signal`. Store entries use Astro’s `filePath` for source diagnostics, alongside `id`, `data`, optional raw `body`, optional rendered HTML, and optional `digest`. Matching digests skip replacements. Store and string-valued metadata are isolated by collection and preparation session; neither persists between cold builds.

Use `parseData()` before `store.set()` to validate and transform metadata. ContentQuery recognizes those parsed objects so preparation does not run transforms twice. Preparation still validates direct store writes. IDs remain top-level query fields: source schema outputs cannot redeclare `id` or overlap computed fields and relationships.

In development, register callbacks on `context.watcher` and call `watcher.add()` for dependencies outside the application root. Complete asynchronous watcher callbacks publish their store changes together, and failures block new content operations until corrected. Filesystem edits can also retry a failed initial load that has not installed its own listeners yet. Configuration reloads and disposal remove loader-owned listeners. The previous `load({ signal })` snapshot return value and separate `watch({ update, invalidate })` API are replaced by this native store contract.

`config` supplies root/source/public/output/cache directory URLs, `base`, `site`, and `output`. Export an optional `loaderConfig` object alongside `collections` to override settings or supply additional configuration a loader reads. These values configure loaders; they do not configure application routing or start Astro integrations. Accessing an unavailable setting produces an explicit error.

Compatibility covers build-time content loaders. The built-in `glob()` and `file()` loaders use the same context. Astro integration hooks, live loaders, component modules, optimized image imports, and Astro-specific deferred rendering require additional host functionality and are not supported. Unsupported module/image entries fail explicitly. `context.renderMarkdown()` uses ContentQuery’s portable renderer and returns HTML/headings. Third-party packages may require Astro as their own dependency or peer; ContentQuery itself does not import Astro at runtime. The published `@ascorbic/csv-loader` is covered by watch-mode, generated-consumer, and type-checking tests.

## Build and query

```sh
vp exec content-query build
vp exec content-query build --watch
vp exec content-query --help
vp exec content-query build --help
vp exec content-query --version
```

The CLI uses CAC for commands, options, and generated help/version output. `-c`, `-o`, and `-w` are aliases for `--config`, `--out-dir`, and `--watch`; value options accept both `--option value` and `--option=value`. Help and version requests work without loading collection configuration or building content.

Defaults are automatic config discovery, `--backend generated`, and `--out-dir ./.content-query`. Unknown options, repeated build options, missing values, invalid backends, and extra positional arguments fail. The command is `build`; the former `prepare` command is no longer accepted. Git-ignore `.content-query/`; generated runtime artifacts and Vite declarations share this directory directly, without a nested `generated/` directory.

The CLI, standalone API, and Vite integration discover exactly one `content-query.config.{ts,mts,cts,js,mjs,cjs}` file at the application root. Examples use `.ts`; both ES module and CommonJS configurations are supported. Missing or multiple matching files produce a configuration error. Use `--config` on the CLI or the `config` option in `buildContent()`/Vite to select an exact filename or location, bypassing discovery. An explicit path never falls back to another config. Configurations export the named `collections` registry; JSON, YAML, and JSX/TSX are not discovered.

```ts
import { content } from "./.content-query/server.js";
import { eq } from "content-query/query";

const posts = await content
  .query("posts")
  .where((fields) => eq(fields.draft, false))
  .select("id", "title")
  .with("author", (author) => author.select("name"))
  .orderBy("title")
  .limit(20)
  .all();

const body = await content.readBody("posts", posts[0]!.id);
const { html, headings } = await content.render("posts", posts[0]!.id);
```

Builders are immutable and reusable. `all()` and `first()` require selection; `count()` counts filtered parents before pagination and does not require selection. Selected optional properties remain own properties with value `undefined`. Returned graphs and headings are detached from internal state. Queries never load bodies, rendered HTML, or a compiler.

Filtering uses structured expressions from `content-query/query`: scalar equality/comparison/choice operators, literal string matching, scalar-array membership, absence checks, and boolean composition. See the [operator matrix](../../docs/PLAN.md#filtering). Sorting uses deterministic Unicode code-point order and ID tie-breakers, with nullish/unordered special values last. Pagination accepts nonnegative safe integers.

Relationships support forward/inverse fields, authored ID arrays, explicit reference ownership, and nested fluent queries. Every requested scope selects its own fields. Many scopes support per-parent ordering/pagination; singular scopes support filtering and return `null` if their target is excluded. Preparation rejects dangling/ambiguous authored references and invalid singular cardinality. Array references preserve order and duplicates; inverse membership is distinct.

## Object queries and adjacent entries

The object and fluent APIs compile to the same normalized query plan and use the same executor, value semantics, validation, and revision pinning:

```ts
const posts = await content.findMany("posts", {
  where: { draft: false, title: { contains: "guide" } },
  select: { id: true, title: true, author: { select: { name: true } } },
  orderBy: [{ title: "asc" }],
  limit: 20,
});
const first = await content.findFirst("posts", { select: { id: true } });
const count = await content.count("posts", { where: { draft: false } });
```

`findFirst()` returns `undefined` when no entry matches. Row queries require explicit selection; a selected relationship also suffices without a scalar field in either API (`select: { author: { select: { name: true } } }` or `.with("author", author => author.select("name"))`). `false` omits a scalar or relationship. Relationship selection takes nested query options; singular relationships cannot order or paginate. Count ignores pagination, matching fluent `.count()`.

Object filters support scalar shorthand and `equals`, `not`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `has`, `hasSome`, `hasEvery`, `isNull`, `isUndefined`, and `isMissing`, subject to field types. Compose them with `AND`, `OR`, and `NOT`. Presence predicates accept booleans; string matching is literal and case-sensitive. `where` also accepts the fluent fields/expression callback, useful for fields named `AND`, `OR`, or `NOT`.

Select previous/next entries without loading bodies:

```ts
// Shorthand: neighbors expose IDs within the filtered/ordered result before pagination.
await content.findMany("posts", {
  where: { draft: false },
  orderBy: { title: "asc" },
  select: { title: true, _adjacent: true },
});
await content.query("posts").select("title").orderBy("title").selectAdjacent().all();

// A detail lookup needs an independent sibling scope, separate from its ID filter.
const post = await content.findFirst("posts", {
  where: { id: currentId },
  select: {
    title: true,
    _adjacent: {
      where: { draft: false },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    },
  },
});
const same = await content
  .query("posts")
  .where((fields) => eq(fields.id, currentId))
  .select("title")
  .selectAdjacent((siblings) =>
    siblings
      .where((fields) => eq(fields.draft, false))
      .orderBy("title")
      .select("id", "title"),
  )
  .first();
```

Both return `_adjacent: { previous, next }`, with `null` at boundaries or when the current entry is outside the sibling scope. `.selectAdjacent(options)` accepts the same explicit object scope as `_adjacent`. Sibling scopes select their own neighbor fields and cannot paginate or recursively select adjacency, including through relationships. `_adjacent` is a reserved field name. Stable ID tie-breakers apply in both APIs.

## Backends and Vite

The generated backend writes collection indexes and separate lazy item payloads, with versioned devalue encoding. Immutable content-addressed modules keep old operations consistent; stable entry/index aliases expose the latest complete publication. A new watch session removes obsolete collection modules from previous runs after its first successful publication. Invalid startup content delays cleanup until the first valid publication. Later updates retain superseded modules for the rest of that session, so restarting reclaims files from earlier runs. One-shot builds (the CLI without `--watch`, `buildContent`, and Vite builds) also remove generated collection modules their revision no longer references, leaving other files in place. Each output directory belongs to one host; start a new session or one-shot build after previous consumers stop. Only `server.js` and its declarations are application imports.

The in-memory backend writes no backend content artifacts. `buildContent()` accepts `BuildContentOptions` (`config`, `backend`, `outDir`, and `watch`) from `content-query/build` and returns a `ContentSession` with `content` and asynchronous `dispose()`. Build diagnostics report `operation: "build"`. Direct use binds the registry through an erased type import:

```ts
import { buildContent } from "content-query/build";
import type { collections } from "./content-query.config";

const session = await buildContent<typeof collections>({ backend: "in-memory" });
try {
  const titles = await session.content.query("posts").select("title").all();
} finally {
  await session.dispose();
}
```

Omitting the generic is valid for build-only calls and exposes no registered query keys. `watch` defaults to `false`. Watch sessions subscribe before loading, return after the first content attempt even if it fails, reject reads while content is invalid, and recover automatically. Configuration/import or subscription-setup failures reject initialization and clean up. Newer builds supersede obsolete work without requiring user code to honor its signal. Already-started operations finish on their pinned revision.

A failed configuration reload keeps new operations in the error state until configuration loading, subscription setup, and content validation succeed. Content edits cannot clear that failure using an older registry. Replacement subscriptions are staged before taking over, and failed setup releases its partial subscriptions while keeping the previous configuration's subscriptions available for recovery.

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";
import { contentQuery } from "content-query/vite";

export default defineConfig({ plugins: [contentQuery()] });
```

Server modules import `content` from `content-query:server` with either backend. Vite owns watching, preparation, invalidation, error display, and cleanup. Its `.content-query/types.d.ts` binds the facade to the configured registry; include that file in the application's TypeScript project. Remove handwritten ambient bindings when using the generated declarations. Both `content-query:server` and the physical server entry export the type-only aliases `CollectionKey`, `CollectionData<"posts">` (metadata plus computed fields and ID), and `Collections` (a map from collection keys to queryable data types). Include `.content-query/**/*.d.ts` in `tsconfig.json`; run `vp exec content-query build` before an initial type check without starting Vite. With generated storage, the default directory also contains `server.js`, `server.d.ts`, `manifest.js`, `package.json`, and `collections/`. A fresh in-memory Vite setup emits only `types.d.ts`; standalone in-memory preparation writes no files. Standalone generated preparation also writes `types.d.ts` beside the server entry. Custom `outDir` values relocate backend artifacts while the Vite declaration stays in `.content-query/`. `content-query:server` is a virtual module supplied by Vite; other bundlers import the physical generated entry.

Generated output is ordinary ESM for Node or another bundler; it does not require Vite. The Vite integration rejects direct/transitive client imports, including the physical generated server entry. It recognizes package files by the installed package's location and `node_modules/content-query` paths, so an application directory named `content-query` is unaffected. Other hosts must enforce equivalent server-only boundaries. Runtime guards provide a fallback. The [Next.js example](../../examples/next/README.md) uses the optional Next.js adapter, server-only queries, and App Router static generation.

## Next.js

```ts
// next.config.ts
import { withContentQuery } from "content-query/next";

export default withContentQuery({ trailingSlash: true });
```

`withContentQuery(nextConfig?, options?)` accepts a Next.js configuration object, promise, or phase-aware function. `NextContentOptions` exposes `config` (an exact configuration file) and `outDir` (generated output), resolved relative to the application directory where the wrapper is created. Defaults are automatic configuration discovery and `.content-query/`. The adapter uses generated storage, awaits initial generation, and owns one development watch session per application. Repeated configuration evaluation reuses that session; changing content locations closes the predecessor. Shutdown closes owned sessions. Production builds await a successful one-shot build and dispose it before Next compiles; server-only phases do not start generation.

The wrapper preserves the application's Next.js settings. For static exports, the example selects `output: "export"` outside development so Next's static-parameter checks do not interfere with added or removed development routes.

Add an application-local alias in `package.json`:

```json
{
  "imports": {
    "#content-query": "./.content-query/server.js"
  }
}
```

Server Components use the same import at every directory depth:

```ts
import "server-only";
import { content } from "#content-query";
```

The alias resolves to the generated server entry and its inferred declarations. If you customize `outDir`, update the alias target to match.

Next's module graph observes published changes, including body-only edits, and refreshes route data through its normal HMR behavior. Validation and configuration failures publish a contextual error entry so server consumers fail visibly; correcting the input republishes the runtime. The application owns routing and should use Next's `server-only` marker around content consumers. Next.js is an optional peer dependency used only by this adapter. Each development publication uses a fresh immutable `next-dev-*.js` runtime entry, including when content returns to an earlier revision, so Next invalidates cached modules reliably. The first successful publication removes entries from previous runs while preserving the new runtime. Later publications retain entries for the rest of the session; repeated configuration evaluation reuses that session without cleaning again. A successful one-shot Next.js build removes all development entries after publishing the ordinary server entry.

## Development updates

`content-query:client` exports `onContentUpdate(callback)`, a browser-safe Vite subscription. Register the host router's asynchronous data revalidation and return the unsubscribe function from the framework's lifecycle hook. Revalidation is serialized and rapid edits are coalesced. The production module is a no-op and includes no content runtime.

The Void example and docs app clear the router cache and call `router.refresh({ replace: true, preserveState: true, preserveScroll: true })` from a root component effect. React Router calls `revalidator.revalidate()`, TanStack Start calls `router.invalidate()`, and SvelteKit calls `refreshAll()`. Successful edits update prepared server modules before notifying browsers. Clients without a subscription retain full-document reload as a fallback. Preparation errors still reach Vite's error overlay. Server startup and dependency optimization can still cause framework-owned reloads. Next.js uses `withContentQuery()` and generated-module HMR. The native Angular example runs `content-query build --watch` alongside Angular CLI; generated server imports trigger Angular rebuilds and page reloads.

The examples use native framework loaders/server functions and keep routing and HTML presentation in the application: [Void](../../examples/void/README.md), [React Router](../../examples/react-router/README.md), [TanStack Start](../../examples/tanstack-start/README.md), [Next.js](../../examples/next/README.md), [SvelteKit](../../examples/sveltekit/README.md), and [Angular](../../examples/angular/README.md).

## Body and rendering policy

`readBody(collection, id)` accepts any registered collection and returns retained text or `undefined`. Missing entries reject. It never reads original sources. Custom loaders can provide optional text and `rendered: { html, metadata?: { headings? } }`; a generic body string alone does not imply Markdown.

Markdown defaults to `retainBody: true` and `deferRender: false`. Production preparation compiles eagerly and packages HTML/headings for lazy loading. `deferRender: true` packages captured input and the library-owned renderer. Development compiles on explicit rendering. Disabling public retention still preserves private input needed by deferred rendering. Built-in HTML includes matching unique heading IDs and syntax-highlighted fenced code. Headings carry IDs only; permalink anchors and other heading presentation are application-owned. Authored image/link URLs remain application-owned and are not rewritten or copied.

`content.render()` returns HTML and headings, with no framework components or user-defined runtime resolvers. Separate query/render operations may observe different development revisions. Production content is immutable.

## Errors and extension points

Import `ContentError` from `content-query/runtime`. Its stable `code`, context, `issues`, `cause`, and grouped `diagnostics` distinguish validation, source, reference, query, artifact, rendering, and entry-lookup failures. Source read/parse failures name their collection and file (`source`), include the parser's message, and report every failing file together. Preparation also reports every dangling or ambiguous reference with its value, skipping relationship checks only for collections that already failed. Unsupported stored values report a structured field `path`. See the [error contract](../../docs/PLAN.md#errors-and-diagnostics).

Vite transports development diagnostics with the same value codec as prepared data, preserving BigInt validation constraints, supported native values, and graph references. Error causes retain their names, messages, stacks, and nested causes in isolated runtimes. Invalid initial content remains recoverable, and asynchronous delivery failures are reported through Vite's logger and error display.

Native content loaders update a private collection store through `load(context)` and development watcher callbacks. Complete store revisions pass through metadata, computed-field, and relationship validation before atomic publication. Candidate edits that reach preparation remain available for cross-collection recovery. Additional source reads belong to loaders; computed fields process validated metadata and captured `readBody()` text.

SQLite, live collections, generic deferred fields, browser querying, advanced joins, configurable Markdown processing, assets, MDX, and the other [future extensions](../../docs/PLAN.md#future-extensions) remain future work. Routing, locale fallback, navigation, public URLs, and access policy belong to applications.

See [FEATURES.md](../../docs/FEATURES.md), [COMPARISONS.md](../../docs/COMPARISONS.md), and the normative [PLAN.md](../../docs/PLAN.md), including its [end-to-end example](../../docs/PLAN.md#living-end-to-end-example).

## Development checks

From this package directory, run `vp check` and `vp test run --coverage`. The suite covers every documented value of the PLAN.md living example (`tests/integration/living-example.test.ts`; update it with the plan), typed consumer callsites, both backends, generated consumers without source files, watch recovery, concurrent publication, CLI behavior, and Vite integration. Coverage requires at least 90% statements/lines, 85% branches, and 90% functions. The repository's `vp test run` also exercises the migrated VoidPress app. The root formatter configuration ignores `dist/` and `coverage/` output.
