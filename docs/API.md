# ContentQuery API and usage

A framework-independent content collection library with typed queries, field projection, relationships, captured bodies, and Markdown rendering. Content builds run during development or your application's build. Production consumes prepared content without loading source files or importing collection configuration.

Application imports such as `content-query/schema`, `content-query/query`, `content-query/computed`, `content-query/build`, and `content-query/vite`, plus the generated [collection entries](#collection-entries), remain the supported API. The `content-query/internal` entries exist for generated modules and integration wiring.

## Define collections

```ts
// content-query.config.ts — build-only
import { defineCollection } from "content-query";
import { file } from "content-query/loaders";
import { schema } from "content-query/schema";

const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: schema.object({ name: schema.string() }),
});

const posts = defineCollection({
  source: "./content/posts", // A string selects Markdown by default.
  schema: schema.object({
    title: schema.string(),
    authorId: schema.string(),
    draft: schema.boolean().default(false),
  }),
  computed: {
    upperTitle: { schema: schema.string(), resolve: ({ data }) => data.title.toUpperCase() },
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

Glob acquisition keeps at most 64 file reads outstanding, preserving source ordering, aggregated diagnostics, and cancellation without opening the entire collection at once.

## Bundled schema builders

Import `{ schema }` from `content-query/schema`; no separate Zod dependency is needed. ContentQuery supplies Zod-backed `object`, `string`, `number`, `boolean`, `bigint`, `date`, `array`, `enum`, `literal`, `union`, `record`, and `unknown` builders, plus `coerce.string()`, `coerce.number()`, `coerce.boolean()`, `coerce.bigint()`, and `coerce.date()`.

Returned schemas retain Zod's chaining methods, including `.optional()`, `.nullable()`, `.default()`, `.refine()`, and `.transform()`. Nested composition follows Zod's rules. The namespace exposes the selected builders, without provider-level parsing utilities, error classes, or configuration. Validation still uses Standard Schema; you can supply another compatible provider's schemas for collections and computed fields.

The type-only helpers `schema.input<Validator>`, `schema.output<Validator>`, and `schema.infer<Validator>` work with any Standard Schema V1 provider. `infer` is an alias for validated output, including defaults and transforms:

```ts
import { schema } from "content-query/schema";

const postSchema = schema.object({
  title: schema.string(),
  draft: schema.boolean().default(false),
});
type PostInput = schema.input<typeof postSchema>; // draft is optional.
type Post = schema.infer<typeof postSchema>; // draft is boolean.
```

Builders run during preparation. Generated runtime JavaScript imports neither the schemas nor Zod.

## Reusable computed fields

`content-query/computed` exports the text helpers `readingTime()`, `wordCount()`, and `excerpt()`, and [`computedFields()`](#fields-that-share-one-resolver) for fields that one resolver fills. The text helpers return ordinary `{ schema, resolve }` definitions with Standard Schema result types, and can sit alongside custom computed fields:

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
  summary: excerpt<schema.infer<typeof articleSchema>>({
    from: ({ data }) => data.description,
    format: "text",
    maxLength: 160,
  }),
}
```

Supply loader metadata as the second type argument when selecting from `source`. `ReadingTimeOptions<Data, Source>` adds finite positive `wordsPerMinute`; `ExcerptOptions<Data, Source>` adds positive-safe-integer `maxLength`. Bad options fail at declaration time. Selectors must return a string or `undefined`; failures become normal contextual preparation diagnostics, and helpers honor the resolver's abort signal.

Results become ordinary typed fields for selection, filtering, and sorting. Helpers run during preparation, including with `retainBody: false`; deployed queries import neither these helpers nor their text-processing dependencies. Text helpers use a Markdown parser without initializing syntax highlighting. See the [computed fields guide](../website/content/guides/computed-fields.md) for complete configurations and queries.

### Fields that share one resolver

`computedFields({ fields, resolve })` declares several computed fields that one resolver call fills, for values that come from the same read. Spread its result into `computed`:

```ts
import { computedFields } from "content-query/computed";

computed: {
  ...computedFields({
    fields: {
      /** The challenge's name. */
      title: schema.string(),
      description: schema.string(),
    },
    resolve: async ({ files }) => JSON.parse(await files.text("info/en-US.json")),
  }),
}
```

- **Resolution.** `resolve` runs once per entry each time the entry is prepared and returns an object with one value per field. Fields whose schema accepts `undefined` may be omitted. A result that is not an object fails preparation.
- **Fields.** Each field is validated by its own schema and is selected, filtered, and sorted like any other computed field. A JSDoc comment on a key in `fields` documents that field on entry types and query results.
- **Context.** `resolve` receives the ordinary [computed context](#define-collections), and files it reads through `files` are tracked. Annotate the context, such as `(context: ComputedContext<Post>)`, to type `data`.
- **Errors.** A failing resolver reports a diagnostic for each field it fills, with that field as the `path`. Declaring no fields, a field without a Standard Schema, or no `resolve` throws a `TypeError`.
- **Types.** `content-query/computed` exports `ComputedFieldsOptions<Fields, Data, Source>`, `ComputedFieldSchemas`, `ComputedFieldValues<Fields>` (what `resolve` returns), and `ComputedFieldDefinitions<Fields, Data, Source>`.

## Astro-compatible content loaders

The named loader interface and standard entry fields remain Astro-compatible. Optional entry `source` metadata and its TypeScript generic are ContentQuery extensions: existing Astro loaders need no changes, and Astro's own store does not retain this extension. The standard `filePath` field remains available for diagnostics independently of source metadata. Store reads keep the standard shape, so custom source metadata read directly from the store remains `unknown`.

ContentQuery uses Astro’s named, store-writing content loader contract directly. Pass an existing loader package to `defineCollection()` without a wrapper:

```ts
import { defineCollection } from "content-query";
import { csvLoader } from "@ascorbic/csv-loader";
import { schema } from "content-query/schema";

export const collections = {
  authors: defineCollection({
    loader: csvLoader({ fileName: "./content/authors.csv", idField: "id" }),
    schema: schema.object({ name: schema.string() }),
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

Defaults are automatic config discovery, `--backend generated`, and `--out-dir ./.content-query`. Unknown options, repeated build options, missing values, invalid backends, and extra positional arguments fail. The command is `build`. Git-ignore `.content-query/`; generated runtime artifacts and Vite declarations share this directory directly, without a nested `generated/` directory.

The CLI, standalone API, and Vite integration discover exactly one `content-query.config.{ts,mts,cts,js,mjs,cjs}` file at the application root. Examples use `.ts`; both ES module and CommonJS configurations are supported. Missing or multiple matching files produce a configuration error. Use `--config` on the CLI or the `config` option in `buildContent()`/Vite to select an exact filename or location, bypassing discovery. An explicit path never falls back to another config. Configurations export the named `collections` registry; JSON, YAML, and JSX/TSX are not discovered.

```ts
import { authors } from "./.content-query/collections/authors/server.js";
import { posts } from "./.content-query/collections/posts/server.js";
import { eq } from "content-query/query";

const summaries = await posts
  .using(authors)
  .select("id", "title")
  .where((fields) => eq(fields.draft, false))
  .with("author", (author) => author.select("name"))
  .orderBy("title")
  .limit(20);

const post = await posts.findFirst({
  where: { id: summaries[0]!.id },
  payloads: { _body: true, _rendered: true },
});
const { _body: body, _rendered: rendered } = post!._payloads;
```

Start fluent queries from the collection, such as `posts.select(...fields)`; field names are checked and completed immediately. `byId`, `where`, `orderBy`, `limit`, `offset`, `with`, `withPayload`, and `selectAdjacent` also start fluent queries. Builders are immutable and reusable. Later `select()` calls add fields to the scope's earlier ones, so a shared builder such as `const postLink = posts.select("id", "title")` can become `postLink.select("publishedAt")` where a page needs more; a field selected again appears once. Await a selected builder directly, or call `all()` / `execute()` for an array, `first()` for one entry or `undefined`, and [`paginate()`](#pagination) for one page with page-number or cursor details. `count()` counts filtered parents before pagination and needs no selection.

A builder is lazy: it runs when it is awaited, not when it is created. `all()`, `execute()`, `first()`, `paginate()`, and `count()` start the query and return a promise. To start a query before other work, call one of them first; holding a builder in a variable does not start it:

```ts
const post = posts.byId(id).select("title").first(); // Starts now.
const user = await readUser();
const { title } = (await post)!;
```

`Promise.all([posts.byId(id).select("title"), readUser()])` also starts each builder it receives.

Queries return only the data they select; nothing is implicit, not even `id`. Every row-returning scope, including relationship and adjacent sibling scopes, must select fields, include a relationship, request a payload, or select adjacency. A scope that selects nothing fails to type-check: awaiting an unselected builder reports "Type of 'await' operand must either be a valid promise…", and calling its `all()`, `first()`, `execute()`, or `paginate()` reports `Type 'Unavailable<"Select fields, relationships, payloads, or adjacent entries before running this query.">' has no call signatures.` At runtime it throws an `invalid-query` ContentError: "Select fields, relationships, payloads, or adjacent entries before running this query." Selected optional properties remain own properties with value `undefined`. Returned graphs and headings are detached from internal state. Queries load bodies or rendered HTML only when they request [payloads](#payloads).

`posts.byId(id)` starts a query for one entry. Select its data as usual, then await it for the entry or `undefined`, without `first()`:

```ts
const post = await posts.byId(id).select("title").withPayload("_rendered");
```

A `byId()` query has no `orderBy`, `limit`, `offset`, `paginate`, `all()`, or results-scope `selectAdjacent(...fields)`. `first()` and `execute()` return the same entry as awaiting it, `count()` returns `0` or `1`, and later `where()` filters also apply, so `posts.byId(id).where((fields) => eq(fields.draft, false))` finds the entry only when it is published. A sibling scope, `selectAdjacent((siblings) => ...)`, selects its neighbors. `byId` is a fluent starter, so `queryStyle: "relational"` hides it; relational queries use `findFirst({ where: { id } })`.

Queries constrained by ID equality, such as `byId(id)`, `.where((fields) => eq(fields.id, id))`, or `where: { id }`, use a lazily built index for the current immutable collection revision. Repeated detail-page lookups avoid scanning the entire collection. Additional filters, selection, ordering, pagination, counts, and independent adjacency scopes retain their normal semantics. Development revisions receive their own index.

Detachment copies a result directly when it contains only primitives, plain objects, dense arrays, and dates. This covers typical field selections and `_rendered` payloads, including long HTML strings. A result containing any other value, such as a `Map` or an array hole, is detached as a whole through the devalue round trip. Repeated references, cycles, mutation isolation, and the supported-value rules are the same on both paths.

Filtering uses structured expressions from `content-query/query`: scalar equality/comparison/choice operators, literal string matching, `like`/`ilike`/`notLike`/`notIlike` patterns, scalar-array membership including `arrayContained`, absence checks, boolean composition, and relationship filters. `has(fields.author, (author) => eq(author.name, "Ada"))` matches parents with a matching related entry; `has(fields.author)` tests existence, and `not(has(...))` tests absence. The fluent operators cover every relational filter. See the [operator matrix](./PLAN.md#filtering). Sorting uses deterministic Unicode code-point order and ID tie-breakers, with nullish/unordered special values last. Pagination accepts nonnegative safe integers.

Relationships support forward/inverse fields, authored ID arrays, explicit reference ownership, and nested fluent queries. A relationship cannot share a name with a data field, so `track` cannot name both an authored ID and the related entry. To give the relationship the authored name, rename the ID in the schema, as in `schema.object({ track: schema.string() }).transform(({ track, ...data }) => ({ ...data, trackId: track }))` with `from: "trackId"`: content files keep `track`, queries select the ID as `trackId`, and `with("track", ...)` returns the related entry. Queries follow a relationship only when its target collection is supplied through [`using()`](#relationships-with-using). Every relationship scope, fluent or relational, selects its own data. Many scopes support per-parent ordering/pagination; singular scopes support filtering and return `null` if their target is excluded. Preparation rejects dangling/ambiguous authored references and invalid singular cardinality. Array references preserve order and duplicates; inverse membership is distinct.

## Collection entries

Each collection has its own generated entry, `collections/<export name>/server.js`, with declarations in `server.d.ts` beside it. The entry exports exactly one value, named after the collection, plus that collection's types, and imports only that collection's index and payload modules. A route's module graph therefore references only the collections it imports, so bundles and serverless file tracing exclude the others.

| Host                    | Import                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Vite, either backend    | `import { posts } from "content-query:collections/posts"`                                                                           |
| Node, Next.js, others   | `import { posts } from "#content-query/posts"` with `"imports": { "#content-query/*": "./.content-query/collections/*/server.js" }` |
| Without an import alias | `import { posts } from "./.content-query/collections/posts/server.js"`                                                              |

The export name and import path segment are the collection name when it is a valid identifier. Otherwise the name is converted: `blog-posts` becomes `blogPosts` (`#content-query/blogPosts`), a leading digit gets an `_` prefix, and reserved words, `default`, and Windows device names such as `con` get a `Collection` suffix. Export names that collide, ignoring letter case, fail the build.

### Relationships with `using()`

An entry loads only its own collection; nothing related is pulled in automatically. Supply relationship targets at the call site:

```ts
import { authors } from "#content-query/authors";
import { posts } from "#content-query/posts";

const rows = await posts.using(authors).findMany({
  columns: { title: true },
  where: { author: { name: "Ada" } },
  with: { author: { columns: { name: true } } },
});
const fluent = await posts
  .using(authors)
  .select("id")
  .with("author", (author) => author.select("name"))
  .all();
```

- Relationship syntax (`with`, relational `where`, and fluent `has()`) is unchanged.
- Every hop is explicit: `posts.using(authors, publishers)` for `with: { author: { with: { publisher: ... } } }`.
- `using()` only supplies relationship targets; it does not let `posts` run root queries on `authors`. Query `authors` through its own entry.
- A relationship whose target was not supplied is a TypeScript error at the relationship and an `invalid-query` error at runtime: `Relationship "author" targets the authors collection, which this query has not loaded. Pass it to using(), such as posts.using(authors).`
- Self-relationships need nothing. A handle such as `const careers = jobs.using(companies)` can live at module level; combinations are cached.

### Entry types

Each entry exports a full-entry type and a payload type. The type name is `Content` plus the export name, capitalized and made singular by dropping one trailing `s` when it does not follow another `s`: `posts` gives `ContentPost`, `jobs` gives `ContentJob`, `projectsTracks` gives `ContentProjectsTrack`, and `coding` gives `ContentCoding`. Set `typeName` on the collection for irregular plurals; `defineCollection({ ..., typeName: "Category" })` gives `ContentCategory`. Two collections that generate the same type name fail the build.

```ts
import type { ContentCodingPayload } from "#content-query/coding";
import type { ContentPost } from "#content-query/posts";

type Post = ContentPost; // ID, validated metadata, and computed fields.
type PostLink = ContentPost<"id" | "title">; // What select("id", "title") returns.
type Detail = ContentCodingPayload<"detail">; // One declared payload's value.
```

`ContentPost<"id" | "title">` is the shape a query returns when it selects those fields: every selected key is present, optional fields read as `undefined` when missing, and unknown field names are type errors. Outside generated declarations, `SelectedData<Data, Field>` from `content-query` builds the same shape, for example `SelectedData<QueryData<typeof collections.posts>, "id" | "title">`.

#### Field descriptions

A JSDoc comment on a schema field or a computed field's name documents that field. Editors show it when you hover the field on the full entry type, on a picked entry type, and on fluent and relational query results, including related entries and `_adjacent` neighbors. Go to definition opens the schema. The built-in `id` field has its own description.

```ts
const posts = defineCollection({
  source: "./content/posts",
  schema: schema.object({
    /** The headline, also used as the page title. */
    title: schema.string(),
  }),
  computed: {
    /** Estimated reading time in minutes. */
    minutes: readingTime(),
  },
});
```

This works with any schema library whose inferred output type keeps property declarations, as Zod 4 does. Zod's `.describe()` and `.meta()` store descriptions at runtime only, so they don't show up in types.

Spell type imports with `import type`, which works under every TypeScript configuration; a plain import also works unless `verbatimModuleSyntax` is enabled. Vite apps import the same types from `content-query:collections/posts`.

`content-query/runtime` exports `Collection<Registry, Name, Style?>` (one collection's query API), `CollectionHandles<Registry, Style?>` (one handle per collection, keyed by name), `AnyCollection` (what `using()` accepts), and `LoadedRegistry` for typed helpers.

## Relational queries and adjacent entries

The collection-scoped relational and collection-first fluent APIs compile to the same normalized query plan and use the same executor, value semantics, validation, and revision pinning:

```ts
const guides = await posts.using(authors).findMany({
  where: { draft: false, title: { contains: "guide" } },
  columns: { id: true, title: true },
  with: { author: { columns: { name: true } } },
  orderBy: { title: "asc" },
  limit: 20,
});
const first = await posts.findFirst({ columns: { id: true } });
const count = await posts.count({ where: { draft: false } });
```

`findFirst()` returns `undefined` when no entry matches. `findMany()` and `findFirst()` require options that select data. List fields with `columns: { title: true }`; columns accept only `true`, so there are no exclusions. Omitted columns and `columns: {}` select no fields, for queries that only need relationships, payloads, or adjacency. Explicit inclusions create every selected property. Request related entries through `with` with nested options that select data; `with: { author: true }` is rejected, and `false` omits the relationship. Singular relationships cannot order or paginate. `count(options)` ignores pagination, matching fluent `.count()`, and `count()` without options counts every entry.

Relational filters support scalar shorthand and `eq`, `ne`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `notLike`, `notIlike`, `contains`, `startsWith`, `endsWith`, `arrayContains`, `arrayOverlaps`, `arrayContained`, `isNull`, `isNotNull`, `isUndefined`, and `isMissing`, subject to field types. Compose them with query-level or field-level `AND`, `OR`, and `NOT`. Presence predicates accept booleans. `like` uses `%` and `_` wildcards; `ilike` also ignores case. The literal string helpers remain case-sensitive. `where: { author: { name: "Ada" } }` filters parents by related entries; `author: true` and `false` test relationship existence. `where: { RAW: (fields) => eq(fields.AND, value) }` accepts structured expressions for reserved field names, rather than SQL text.

Select previous/next entries without loading bodies:

```ts
// Results scope: neighbors within the filtered/ordered result before pagination.
await posts.findMany({
  where: { draft: false },
  orderBy: { title: "asc" },
  adjacent: { scope: "results", columns: { id: true } },
  columns: { title: true },
});
await posts.select("title").orderBy("title").selectAdjacent("id").all();

// A detail lookup needs an independent sibling scope, separate from its ID filter.
const post = await posts.findFirst({
  where: { id: currentId },
  adjacent: {
    where: { draft: false },
    orderBy: { title: "asc" },
    columns: { id: true, title: true },
  },
  columns: { title: true },
});
const same = await posts
  .byId(currentId)
  .select("title")
  .selectAdjacent((siblings) =>
    siblings
      .where((fields) => eq(fields.draft, false))
      .orderBy("title")
      .select("id", "title"),
  );
```

Both return `_adjacent: { previous, next }`, with `null` at boundaries or when the current entry is outside the sibling scope. Neighbors select their own data; nothing is implicit, not even `id`. Results-scope neighbors (`.selectAdjacent(...fields)` or `adjacent: { scope: "results", columns, with? }`) share the scope's filters and order, and inside a relationship they come from the parent's related entries in their declared or authored order. `adjacent: true` and an empty `.selectAdjacent()` are rejected. The fluent `.selectAdjacent(options)` overload retains its explicit `{ where?, orderBy?, select }` scope; relational `adjacent` uses `{ scope?: "collection", where?, orderBy?, columns?, with? }`. Sibling scopes select their own neighbor fields and cannot paginate or recursively select adjacency, including through relationships. `_adjacent` is a reserved field name. Stable ID tie-breakers apply in both APIs.

`content-query/query` exports `QueryOptions<Registry, Name>` (also named `RelationalQueryOptions`), `CountOptions<Registry, Name>`, `RelationalWhere`, and `RelationalQueryResult` for typed helpers. Use `satisfies QueryOptions<...>` to validate reusable options while retaining literal column selections.

Each collection handle offers the fluent starters plus `findMany`, `findFirst`, `paginate`, `count`, and `using`. Bodies and rendered output are payloads that queries request; see [Payloads](#payloads).

Selection is explicit:

- Fluent queries list fields with `posts.select(...fields)`. Relational queries list them in `columns`, each set to `true`; `findMany({ where })` alone selects nothing.
- Relationships select their own data, such as `with: { author: { columns: { name: true } } }`.
- Adjacency selects neighbor fields: `adjacent: { scope: "results", columns: { id: true } }` or `.selectAdjacent("id")`.
- A query that reads only payloads, such as `findFirst({ where: { id }, payloads })`, needs no `columns`.

Results include `id` only when it is selected.

## Pagination

```ts
const query = posts
  .select("id", "title")
  .where((fields) => eq(fields.draft, false))
  .orderBy("publishedAt", "desc");

// Page numbers, for archive routes such as /blog/page/2.
const archive = await query.paginate({ page: 2, size: 10 });
// { items, total, page, pageCount, hasNextPage, hasPreviousPage }

// Cursors, for "load more" lists.
const first = await query.paginate({ size: 10 });
const next = await query.paginate({ size: 10, after: first.endCursor });
// { items, startCursor, endCursor, hasNextPage, hasPreviousPage }

// The relational API accepts the same pagination options beside its query options.
const page = await posts.paginate({
  columns: { id: true, title: true },
  orderBy: { publishedAt: "desc" },
  page: 2,
  size: 10,
});
```

`paginate()` runs one query against one revision, so `total` always agrees with `items`. Items have the same type and contents that `all()` or `findMany()` would return for that page, including relationships, payloads, and `_adjacent`; results-scope neighbors are still found before pagination. `all()`, `findMany()`, and awaiting a builder keep returning plain arrays.

- **Page numbers.** `page` starts at 1 and `size` is the number of entries per page. Results always include `total`. `pageCount` is at least 1, so the first page exists even when nothing matches. A page past the end returns no items with the real `pageCount`, so a route can respond with not found.
- **Cursors.** `after` returns the entries after an earlier page's `endCursor`; `before` returns the entries just before a `startCursor`. A `null` cursor starts at the first entry with `after`, or at the last entry with `before`. `total: true` adds the matching total, which is omitted otherwise. Both cursors are `null` on an empty page, and `hasNextPage` and `hasPreviousPage` are exact.
- **Cursor contents.** Cursors are opaque, URL-safe strings that record the collection, the effective sort order including the ID tie-breaker, and the boundary entry's sort values, with dates and `BigInt`s preserved. They position by those values, so they keep working when filters change or the boundary entry is removed. A malformed cursor, or one from a different collection or sort order, throws an `invalid-cursor` ContentError. Cursors from fluent and relational queries with the same order are interchangeable.
- **Restrictions.** `paginate()` sets the limit and offset itself: after `limit()` or `offset()` it fails to type-check and throws `invalid-query`, and relational `paginate()` rejects `limit` and `offset`. Page options cannot include `after`, `before`, or `total`, a cursor page accepts `after` or `before` but not both, and `page` and `size` must be positive safe integers. Only root queries paginate; relationship scopes keep `limit` and `offset`.
- **Types.** `content-query/query` exports `PageOptions`, `CursorOptions`, `PaginateOptions`, `NumberedPage<Item>`, `CursorPage<Item, Total>`, `PaginateResult<Item, Options>`, and `RelationalPaginateOptions`. With generated declarations, `NumberedPage<ContentPost<"id" | "title">>` types the page above.

## Query style

Export an optional `queryStyle` from the config to allow only one query API:

```ts
export const queryStyle = "relational"; // or "fluent"
```

Omit it to allow both. `"fluent"` keeps the fluent starters on each collection: `byId`, `select`, `where`, `orderBy`, `limit`, `offset`, `with`, `withPayload`, and `selectAdjacent`. `"relational"` keeps `findMany`, `findFirst`, `paginate`, and `count(options)`. `count()` without options works in both. Every other query API starts from one of those members, so the setting also covers relationships, payloads, adjacency, and counts.

Generated declarations read the export's type, so the editor and `tsc` report a disabled member without a rebuild: `posts.select is unavailable because content-query.config sets queryStyle to "relational".` Keep the literal type: use a plain `const` or `satisfies QueryStyle`, not a `: QueryStyle` annotation, which widens the type and allows both styles in types while the runtime still enforces the value.

Builds record the style in each revision and in each generated collection entry. Accessing or calling a disabled member throws an `invalid-query` ContentError with the same message, which covers JavaScript consumers and casts. Development config edits apply to the next revision. Values other than `"fluent"` and `"relational"` fail configuration loading.

`QueryStyle` is exported from `content-query` and `content-query/runtime`. `Collection<Registry, Name, Style>` and `CollectionHandles<Registry, Style>` take the style as an optional type argument, and a disabled member has the type `Unavailable<QueryStyleDisabled<Collection, Member, Style>>`, which is not callable. `Unavailable<Reason>`, exported from `content-query/runtime`, also types `paginate()` after `limit()` or `offset()`, `count()` after `withPayload()`, and the terminals of a query that selects nothing, so each error names its reason. Standalone `buildContent<Registry, Style>()` sessions are typed by their type arguments, for example `buildContent<typeof collections, typeof queryStyle>()`; without `Style`, they type both APIs and rely on the runtime check.

Both styles support the same filters, so either value can express every query.

## Backends and Vite

The Vite plugin defaults to `backend: "in-memory"`: `contentQuery()` serves virtual modules in development, bundles prepared content for production, and writes only `.content-query/types.d.ts`. Use `contentQuery({ backend: "generated" })` to also publish standalone runtime artifacts. The standalone CLI, `buildContent()`, and Next.js adapter continue to default to generated storage.

Artifact publication reuses unchanged immutable files and stages new modules with bounded parallel I/O before switching each collection's public entry. Conflicting bytes still fail publication, and older revisions retain their immutable payloads.

The generated backend writes collection indexes and separate lazy item payloads, with versioned devalue encoding. Immutable content-addressed modules keep old operations consistent; each collection's stable `server.js` entry exposes its latest complete publication. A new watch session removes obsolete collection modules from previous runs after its first successful publication. Invalid startup content delays cleanup until the first valid publication. Later updates retain superseded modules for the rest of that session, so restarting reclaims files from earlier runs. One-shot builds (the CLI without `--watch`, `buildContent`, and Vite builds) also remove generated collection modules their revision no longer references, leaving other files in place. Each output directory belongs to one host; start a new session or one-shot build after previous consumers stop. Only the collection entries, `collections/<export name>/server.js`, and their declarations are application imports.

The in-memory backend writes no backend content artifacts. `buildContent()` accepts `BuildContentOptions` (`config`, `backend`, `outDir`, and `watch`) from `content-query/build` and returns a `ContentSession` with `collections` and asynchronous `dispose()`. `session.collections` holds one handle per collection, keyed by collection name, with the same API and `using()` as the generated entries. Build diagnostics report `operation: "build"`. Direct use binds the registry through an erased type import:

```ts
import { buildContent } from "content-query/build";
import type { collections } from "./content-query.config";

const session = await buildContent<typeof collections>({ backend: "in-memory" });
try {
  const { authors, posts } = session.collections;
  const titles = await posts.select("title").all();
  const bylines = await posts
    .using(authors)
    .select("title")
    .with("author", (author) => author.select("name"))
    .all();
} finally {
  await session.dispose();
}
```

Omitting the generic is valid for build-only calls and exposes no registered query keys. `watch` defaults to `false`. Watch sessions subscribe before loading, return after the first content attempt even if it fails, reject reads while content is invalid, and recover automatically. Configuration/import or subscription-setup failures reject initialization and clean up. Newer builds supersede obsolete work without requiring user code to honor its signal. Already-started operations finish on their pinned revision.

A failed configuration reload keeps new operations in the error state until configuration loading, subscription setup, and content validation succeed. Content edits cannot clear that failure using an older registry. Replacement subscriptions are staged before taking over, and failed setup releases its partial subscriptions while keeping the previous configuration's subscriptions available for recovery.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { contentQuery } from "content-query/vite";

export default defineConfig({ plugins: [contentQuery()] });
```

The Vite integration supports Vite 8 and uses its public types. Vite and Next.js are optional peers; standalone builds and queries require neither framework.

Server modules import each collection from `content-query:collections/<export name>`, such as `import { posts } from "content-query:collections/posts"`, with either backend. A module name that matches no collection fails with an error. Vite owns watching, preparation, invalidation, error display, and cleanup. Its `.content-query/types.d.ts` declares each collection module with its handle and [entry types](#entry-types), plus the type-only `content-query:collections` module, whose `CollectionKey` names every collection for integrations that accept a collection name, such as `@content-query/mdx`. Include `.content-query/**/*.d.ts` in `tsconfig.json`, remove handwritten ambient bindings, and run `vp exec content-query build` before an initial type check without starting Vite. With generated storage, the default directory contains `package.json`, `types.d.ts`, and `collections/<export name>/` with each collection's `server.js`, `server.d.ts`, index, and payload modules. A fresh in-memory Vite setup emits only `types.d.ts`; standalone in-memory preparation writes no files. Custom `outDir` values relocate backend artifacts while the Vite declaration stays in `.content-query/`. The `content-query:collections/*` modules are supplied by Vite; other bundlers import the physical generated entries.

Generated output is ordinary ESM for Node or another bundler; it does not require Vite. The Vite integration rejects direct/transitive client imports, including the physical generated collection entries. It recognizes package files by the installed package's location and `node_modules/content-query` paths, so an application directory named `content-query` is unaffected. Other hosts must enforce equivalent server-only boundaries. Runtime guards provide a fallback. The [Next.js example](../examples/next/README.md) uses the optional Next.js adapter, server-only queries, and App Router static generation.

Vite excludes generated artifacts from its file watcher while preserving application watcher settings. Production content preparation runs for server environments, so client compilation does not repeat source loading and Markdown rendering. Before bundling, Vite packs payload sources into lazy modules targeting 128 KiB each, including when the host requires strict entry signatures. Queries without payloads still load no payload modules; requesting `_body` or `_rendered` for an entry can load neighboring entries' payloads in the same module. Host output and chunking settings continue to control the final bundle. Standalone generated artifacts retain individual immutable item modules.

Development prepares initial content before Vite starts listening; server module loads also await that preparation. Closing a server before it listens releases its content session. Development uses the same bounded payload batches and shares concurrent serialization of a revision. Large metadata indexes and payload batches use gzip/base64 when that saves at least ten percent. A portable decoder restores metadata synchronously and expands each payload batch once on first access; failed payload loads can be retried. The underlying value codec still preserves rich metadata, heading aliases, special entry IDs, and detached results. Small or incompressible data stays uncompressed.

## Next.js

```ts
// next.config.ts
import { withContentQuery } from "content-query/next";

export default withContentQuery({ trailingSlash: true });
```

`withContentQuery(nextConfig?, options?)` accepts a Next.js configuration object, promise, or phase-aware function. `NextContentOptions` exposes `config` (an exact configuration file) and `outDir` (generated output), resolved relative to the application directory where the wrapper is created. Defaults are automatic configuration discovery and `.content-query/`. The adapter uses generated storage, awaits initial generation, and owns one development watch session per application. Repeated configuration evaluation reuses that session; changing content locations closes the predecessor. Shutdown closes owned sessions. Production builds await a successful one-shot build and dispose it before Next compiles; server-only phases do not start generation.

Next's detached telemetry helper also evaluates development configuration. The adapter preserves that configuration without starting a content session, allowing the helper to exit without leaving a watcher behind.

The wrapper preserves the application's Next.js settings. For static exports, the example selects `output: "export"` outside development so Next's static-parameter checks do not interfere with added or removed development routes.

Add an application-local alias for the collection entries in `package.json`:

```json
{
  "imports": {
    "#content-query/*": "./.content-query/collections/*/server.js"
  }
}
```

Server Components import each collection they query, at every directory depth:

```ts
import "server-only";
import { posts } from "#content-query/posts";
```

The alias resolves to each generated collection entry and its inferred declarations. A route's serverless function traces only the collections its module graph imports. If you customize `outDir`, update the alias target to match.

Next's module graph observes published changes, including body-only edits, and refreshes route data through its normal HMR behavior. Validation and configuration failures replace every collection entry with a contextual error entry so server consumers fail visibly; correcting the input republishes the runtime. The application owns routing and should use Next's `server-only` marker around content consumers. Next.js is an optional peer dependency used only by this adapter. Each development publication points every collection entry at a fresh immutable `next-dev-*.js` runtime copy in its directory, including when content returns to an earlier revision, so Next invalidates cached modules reliably. The first successful publication removes entries from previous runs while preserving the new runtime. Later publications retain entries for the rest of the session; repeated configuration evaluation reuses that session without cleaning again. A successful one-shot Next.js build removes all development entries after publishing the ordinary collection entries.

## Development updates

Filesystem watching waits briefly for settled writes before reloading sources, including external sources. This coalesces partial writes and preserves rapid invalid-edit/correction recovery.

Declared `file()` and `glob()` inputs have their own subscriptions, including inputs under directories such as `dist/` and `coverage/` that the general project watcher ignores. Watches are ready before loading and cover later creation of missing inputs. Chokidar subscribes to a new directory only after reading it, so a glob collection rechecks each new directory from disk 100 ms and 1 s after it appears and reloads only when it finds a matching file that no event reported. Glob exclusions still apply. ContentQuery's generated output is excluded from source watching to prevent reload loops.

Configuration reloads follow the config's evaluated module graph: the config file plus every module Jiti transpiles for it (TypeScript, and CommonJS `.js` inside ESM packages), including modules outside the application root. Editing other application modules neither reloads content nor discards prepared work. Natively loaded `.mjs`, `.cjs`, ESM `.js`, and JSON imports stay in Node's module cache, so a reload cannot observe them; restart the watch session after editing those. While a configuration fails to load, any JavaScript/TypeScript change retries it. Custom loaders can call `context.watcher.add()` for additional files and update their store in watcher callbacks. Glob collections reload only for files their patterns can match, so images, editor swap files, and excluded paths change nothing; removing a directory reloads conservatively.

Declared files or glob base directories that are missing when watching starts retain a metadata polling fallback for that one path. It restores native subscriptions when a parent-directory creation event is lost; glob contents are not individually polled. The fallback is released with the session.

`content-query:client` exports `onContentUpdate(callback)`, a browser-safe Vite subscription. Register the host router's asynchronous data revalidation and return the unsubscribe function from the framework's lifecycle hook. Revalidation is serialized and rapid edits are coalesced. The production module is a no-op and includes no content runtime.

The Void example and docs app clear the router cache and call `router.refresh({ replace: true, preserveState: true, preserveScroll: true })` from a root component effect. React Router calls `revalidator.revalidate()`, TanStack Start calls `router.invalidate()`, and SvelteKit calls `refreshAll()`. Successful edits update prepared server modules before notifying browsers. Clients without a subscription retain full-document reload as a fallback. Preparation errors still reach Vite's error overlay. Server startup and dependency optimization can still cause framework-owned reloads. Next.js uses `withContentQuery()` and generated-module HMR. The native Angular example runs `content-query build --watch` alongside Angular CLI; generated collection imports trigger Angular rebuilds and page reloads.

The examples use native framework loaders/server functions and keep routing and HTML presentation in the application: [Void](../examples/void/README.md), [React Router](../examples/react-router/README.md), [TanStack Start](../examples/tanstack-start/README.md), [Next.js](../examples/next/README.md), [SvelteKit](../examples/sveltekit/README.md), and [Angular](../examples/angular/README.md).

## Payloads

Bodies and rendered output are payloads: per-entry data stored and loaded separately from query records. Request them in the query that selects the entry:

```ts
const post = await posts.findFirst({
  where: { id },
  columns: { title: true },
  payloads: { _rendered: true },
});
const { html, headings } = post!._payloads._rendered;

const same = await posts.byId(id).select("title").withPayload("_rendered").withPayload("_body");
```

- **Requests.** Relational `payloads` maps payload names to `true`, or to a record naming every variant key for a payload with variants; `false` omits a payload. It is accepted at the root and inside `with` scopes. Fluent `.withPayload(name)` does the same on root and relationship builders; requesting the same payload twice throws. Omitting `columns` still returns all metadata alongside the payloads.
- **Results.** Requested values appear under the reserved `_payloads` key, which metadata, computed fields, and relationships cannot use. A query that requests no payloads has no `_payloads` key.
- **Loading.** Payloads load after filtering, ordering, and pagination, from the same pinned revision as the records, with at most 16 loads in flight per query. Each distinct payload loads once per query, and every row receives its own detached copy, including rows that share a related entry. Adjacent sibling scopes never request payloads.
- **Limits.** Payloads are never selectable, filterable, sortable, or countable. Relational `count(options)` and fluent `.count()` reject payload requests, and the fluent `count()` terminal is unavailable in the types once `.withPayload()` is called.
- **Built-ins.** Built-in payload names start with an underscore, so they never collide with payloads a collection declares. `_body` is the retained raw text, or `undefined` when an entry has none or `retainBody` is `false`. `_rendered` is `{ html, headings }`; entries without supplied output or a Markdown rendering path reject the query with `not-renderable`. Markdown `source` collections, `glob()`, and custom loaders offer both. JSON, YAML, and TOML `source` collections and `file()` do not: requesting either there is a type error and an `invalid-query` at runtime.
- **Missing entries.** A query for a missing entry returns `undefined` or an empty array, so there is no separate lookup error.

Payloads never read original sources. Custom loaders can provide optional text and `rendered: { html, metadata?: { headings? } }`; a generic body string alone does not imply Markdown.

Markdown defaults to `retainBody: true` and `deferRender: false`. Production preparation compiles eagerly and packages HTML/headings for lazy loading. `deferRender: true` packages captured input and the library-owned renderer. Development compiles when a query first requests `_rendered`. Disabling public retention still preserves private input needed by deferred rendering. Built-in HTML includes matching unique heading IDs and syntax-highlighted fenced code. Headings carry IDs only; permalink anchors and other heading presentation are application-owned. Authored image/link URLs remain application-owned and are not rewritten or copied.

`_rendered` contains HTML and headings, with no framework components or user-defined runtime resolvers. Records and payloads from one query always come from the same revision; separate queries may observe different development revisions. Production content is immutable.

### Custom payloads

Collections declare their own payloads for large per-entry data that queries load only on request:

```ts
// content-query.config.ts
const coding = defineCollection({
  loader: glob({ base: "./content/coding", pattern: "*/exercise.json", generateId }),
  schema: schema.object({ title: schema.string(), locales: schema.array(schema.string()) }),
  payloads: {
    detail: {
      schema: schema.object({ hints: schema.string() }),
      variants: { locale: "locales" },
      resolve: async ({ files, variant }) => ({
        hints: await files.text(`hints/${variant.locale}.md`),
      }),
    },
  },
});
```

```ts
// Server code
import { coding } from "#content-query/coding";

const exercise = await coding.findFirst({
  where: { id: "two-sum" },
  payloads: { detail: { locale: "fr-FR" } },
});
```

- **Declarations.** Each payload has a `schema` and `resolve(context)`, where `context` holds `collection`, `id`, `data` (validated metadata plus computed fields), `source`, `variant`, `readBody()`, tracked `files` helpers, and `signal`. Names cannot start with `_` or repeat a computed field or relationship.
- **Variants.** `variants` maps each key to the name of a string-array data field, read per entry (a missing value means none), or to a fixed list. Preparation resolves the cross product of the keys' values, or the combinations `combinations({ ...context, variants })` returns; each must give every key one listed value. Variant values are not callbacks, so TypeScript can infer variant keys inline; derive values that need logic in a computed field.
- **Preparation.** Payloads resolve after relationships validate, are schema-validated and encoded, and are cached per variant, so unchanged entries reuse their values and publishing reuses their encodings. Generated output stores one module per entry and variant at `collections/<export name>/payloads/<payload>/<hash>.js`.
- **Related files.** Computed and payload resolvers receive tracked `files` helpers: `text(path)`, `bytes(path)`, `glob({ pattern, base?, generateId?, retainBody?, schema? })` and `file(path, { parser?, schema? })`, which parse like the `glob()` and `file()` loaders and return `{ id, data, body?, filePath }` entries, and `renderMarkdown(body)`. Paths are relative to the entry's folder (its file's folder, or a custom loader's `source.directory`) and must stay inside it or a directory in the collection's `sharedFiles`. Schema failures name the file as `source` and the field as `path`. During development, an edit to a read file re-resolves only the payload variants that read it, a glob that gains or loses a match re-resolves its readers, and a file a computed field read re-prepares that entry. `cache: false` resolves a payload again in every revision, for inputs `files` cannot track.
- **Requests.** Variant requests name every key: relational `payloads: { detail: { locale: "fr-FR" } }` or fluent `.withPayload("detail", { locale: "fr-FR" })`. A combination the entry lacks rejects with `variant-not-found`, whose `payload` and `variant` properties name it.
- **Fallbacks.** A key can list values to try in order, such as `{ locale: ["fr-FR", "en-US"] }`: each entry returns the first combination it has, and only that one loads. With lists for several keys, earlier keys in the request change slowest. When an entry has none of the combinations, the query rejects with `variant-not-found`, naming the first in `variant` and every combination tried in its message. To tell which one an entry returned, include the variant in the payload's value, such as `resolve: ({ variant }) => ({ locale: variant.locale, ... })`.
- **Types.** Payload values and variant keys are inferred from the declaration. `content-query` exports `PayloadData<Definition, Name>`, `VariantOf<Definition, Name>`, and `VariantRequest<Variant>` (what a request accepts), and each generated entry exports a payload type such as `ContentCodingPayload<"detail">`.
- **Diagnostics.** Payload failures carry `payload` and `variant` with the collection, entry, source, and field `path`, through the Vite development transport, and the CLI prints them as `detail[locale=fr-FR]`.

## Errors and extension points

Import `ContentError` from `content-query/runtime`. Its stable `code`, context, `issues`, `cause`, and grouped `diagnostics` distinguish validation, source, reference, query, cursor, artifact, rendering, and payload-variant failures. Source read/parse failures name their collection and file (`source`), include the parser's message, and report every failing file together. Preparation also reports every dangling or ambiguous reference with its value, skipping relationship checks only for collections that already failed. Unsupported stored values report a structured field `path`. See the [error contract](./PLAN.md#errors-and-diagnostics).

Vite transports development diagnostics with the same value codec as prepared data, preserving BigInt validation constraints, supported native values, and graph references. Error causes retain their names, messages, stacks, and nested causes in isolated runtimes. Invalid initial content remains recoverable, and asynchronous delivery failures are reported through Vite's logger and error display.

Native content loaders update a private collection store through `load(context)` and development watcher callbacks. Complete store revisions pass through metadata, computed-field, and relationship validation before atomic publication. Candidate edits that reach preparation remain available for cross-collection recovery. Additional source reads belong to loaders; computed fields process validated metadata and captured `readBody()` text.

SQLite, live collections, generic deferred fields, browser querying, advanced joins, configurable Markdown processing, assets, MDX, and the other [future extensions](./TODO.md#future-improvements) remain future work. Routing, navigation, public URLs, and access policy belong to applications, as does each request's choice of fallback variants.

See [FEATURES.md](./FEATURES.md), [COMPARISONS.md](./COMPARISONS.md), and the normative [PLAN.md](./PLAN.md), including its [end-to-end example](./PLAN.md#living-end-to-end-example).
