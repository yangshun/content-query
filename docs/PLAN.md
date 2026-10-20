# ContentQuery v1 plan

## V1 features

Status: implemented on October 18, 2026. Feature scope was agreed on October 17 and revised on October 18 to remove generic deferred resolvers from v1, keep collection configuration in preparation only, and follow Astro's built-in loader APIs and default IDs. This remains the v1 implementation contract; the acceptance suites cover the contracts below.

V1 centers on typed collections, useful queries, explicit body access, built-in Markdown rendering, and loader-supplied rendered HTML. A listing page must be able to query titles and dates without loading rendered article bodies or invoking a Markdown compiler.

| Feature                   | V1 scope                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content sources           | Astro-style `glob()` and `file()` loaders for local Markdown and JSON/YAML/TOML data, plus custom async loaders. Access frontmatter and raw bodies without requiring compilation. |
| Collection definitions    | Named collections, stable entry IDs, schemas, and inferred TypeScript types. Export one registry from build-only `content-query.config`.                                           |
| Validation                | Validate source metadata and computed results during preparation. Report source and field errors, and reject duplicate IDs.                                                       |
| Errors and diagnostics    | Stable `ContentError` codes, contextual diagnostics, preserved validation issues/causes, grouped independent preparation failures, and automatic development recovery.            |
| Queries                   | List entries, look up by ID, filter, sort, paginate, and count. Explicitly select returned fields; return ordinary arrays for custom processing.                                  |
| Computed query fields     | Derive queryable values such as slugs, excerpts, or reading time during preparation.                                                                                              |
| Body access and rendering | Load retained raw text explicitly. `content.render(collection, id)` returns supplied or compiled HTML and headings with slugs separately from query results.                      |
| Relationships             | Named forward and inverse relationships, ID-array references, and explicitly requested nested selection, filtering, ordering, and pagination.                                     |
| Development updates       | Reflect additions, edits, deletions, and configuration changes. Reuse unchanged work and surface errors instead of silently serving stale content.                                |
| Production preparation    | Prepare deployable query data, a collection manifest, and body/rendering payloads for SSG and SSR. Production works without original sources or importing `content-query.config`.  |
| Portable integration      | A framework-independent compiler and query/runtime layer, with a Vite integration for the initial VoidPress consumer.                                                             |

### Query data and body rendering

`.select(...)`, filtering, and sorting use prepared source metadata and computed fields. Making an expensive body-derived value queryable deliberately accepts its preparation cost. Computed resolvers may be synchronous or asynchronous and have Standard Schema result validation.

Follow Astro’s optional `body: string` and loader-supplied `rendered: { html, metadata? }` payload model. Missing bodies are `undefined`; they do not require collection-level body-capability restrictions or missing-body errors. Source-reader callbacks are outside v1. Loading retained body/rendering payloads remains explicit and separate from query fields and compilation. The runtime returns framework-independent HTML and headings, including heading slugs. Ordinary application-owned server functions can process explicitly retrieved text.

The `glob()` loader's `deferRender` option controls production SSR compilation policy for Markdown. Its default, `false`, compiles content during the build while retaining lazy loading of rendered output. `true` packages captured raw bodies and the library-owned renderer for on-demand processing. Development and pure SSG follow the [rendering lifecycle](#preparation-and-production-rendering). The loader also offers `retainBody: true` by default; disabling it omits publicly accessible raw text, while preserving any private input required by deferred compilation. See [body retention](#body-retention).

V1 has no generic `deferred: { field: { schema, resolve } }` declarations and no query-builder `.resolve(...)` method. This supersedes the earlier generic deferred-field design. It does not remove lazy body access or deferred built-in rendering.

### Application-owned behavior

Locale and version are ordinary fields. Routing, translation fallback, navigation, HTML insertion, and publication policy belong to VoidPress or the consuming application. The Markdown helper produces rendering data rather than a framework component. Applications provide publicly accessible asset URLs; asset discovery, copying, optimization, and URL rewriting are outside this library's scope.

Outstanding work and future design notes are tracked in [TODO.md](./TODO.md).

## Design guidelines

Status: agreed on October 17, 2026 and implemented for the in-memory and generated backends. These guarantees also constrain future API and backend changes.

### 1. Keep the public API independent of the backend

Eventually support in-memory, generated, and SQLite implementations without changing collection definitions or query call sites. The initial design must leave room for a SQLite backend; implementing SQLite is not a v1 requirement.

JavaScript query execution is a requirement. The backend names have the following agreed meanings:

| Backend   | Storage and generated files                                                                    | Query execution                                                                     |
| --------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| In-memory | Loaded content stays in process memory. The backend generates no content files or database.    | JavaScript evaluates filters, sorting, and field selection over the stored content. |
| Generated | Emit one query index per collection, with separate payload modules for entries that need them. | JavaScript queries the generated data and loads item payloads as needed.            |
| SQLite    | Store ingested content entries in a SQLite database.                                           | SQLite performs querying and filtering through SQL.                                 |

These definitions concern the files emitted by the content backend. A host application's normal build may still bundle data supplied by the in-memory backend; that backend does not emit its own item or index files.

Use structured queries with defined semantics that each backend can execute. Custom JavaScript processing happens after retrieving results, rather than requiring a backend to translate arbitrary callbacks.

The in-memory and generated backends can share a JavaScript query executor. The SQLite backend translates the same query contract into SQL and can reuse SQL tooling inside its adapter. All backends share the collection definitions, validation and transformation rules, and public query semantics.

The [backend packaging design](#backends) defines eager query data, separately loaded item inputs, and portable generated ESM modules. The [build API](#build-api-and-defaults) chooses the backend outside collection definitions. Module embedding, internal exports, and adapter initialization are private implementation details. These definitions do not require Drizzle or a SQLite engine for the JavaScript backends.

### 2. Keep backend behavior consistent

Filtering, sorting, null handling, dates, pagination, and errors must behave consistently across backends. Define these semantics explicitly and run the same conformance tests against each backend.

Choosing a backend must not silently change query results, field types, or the meaning of an operation.

### 3. Require explicit field selection

Every operation that returns entry data, including an individual lookup, must explicitly select its returned fields. There is no implicit return-everything operation.

Use `.select(...)` for prepared metadata and computed fields. Request related data through `.with(...)`. Body access and built-in rendering are separate explicit operations and do not add fields to a query result.

Selection determines the inferred result type. Unselected fields must also be absent from the actual runtime result, not merely hidden by TypeScript types.

Every explicitly selected field is an own property of the returned object, including when its value is `undefined`. Preserve explicit `null` separately and follow the [field-presence rules](#field-presence-and-undefined) at each query level.

Selection controls returned payload size. It does not necessarily eliminate the cost of reading, validating, or preparing unselected query fields; promise that optimization only where an implementation supports it.

### 4. Enforce the server/client boundary

Query functions, compiler code, configuration, and storage drivers must not enter client bundles. Supported integrations must reject direct and transitive client imports during the build, before bundling content or server dependencies. Runtime guards are a fallback, not the only protection.

Type-only imports remain available without pulling in query code or content data.

### 5. Make data transfer explicit

Query results are ordinary objects containing values from the [supported data-value contract](#supported-data-values). Bodies, rendered output, and related entries never appear automatically. Built-in rendering returns its own result and does not mutate earlier query results or introduce lazy property access.

Applications own which selected values they expose publicly. Field selection limits data transfer; it does not grant authorization or automatically make a selected field public.

### 6. Support static generation and SSR through the same API

Queries must work during prerendering and server requests without requiring request objects or framework lifecycle hooks. Use an async public API so different storage implementations can perform I/O without changing call sites.

Production queries, body loading, and rendering must work from prepared content without original sources or importing collection configuration. Static generation and SSR expose the same query and rendering contracts.

### 7. Preserve type safety throughout the pipeline

Infer metadata, computed fields, valid filter operations and values, selected results, relationships, and registered collection names from collection definitions. Invalid field and collection names must not degrade into untyped access. Body/render operations accept every registered collection; an entry without a rendering path fails at runtime with `not-renderable`. Built-in rendering has a library-defined result type; it does not require per-collection output schemas at runtime.

Validate external data at runtime as well. Apply schema transformations once when preparing data for a source and schema revision, then store their validated results. Loading stored or generated values must not apply the transformations again. Preserve consistent field types and values across development, builds, and backends.

### 8. Make expensive work explicit

Metadata queries must not load body payloads, load rendered HTML, or invoke rendering. Making a body-derived value queryable deliberately promotes that work into query preparation.

Body access and `content.render(...)` are explicit, and relationship loading requires `.with(...)`. Production may compile Markdown eagerly while keeping rendered output separate and lazily loaded. Reading an ordinary query-result property or serializing that result must not trigger body work.

### 9. Prioritize correctness over caching

Changes to sources, schemas, and transformers must invalidate affected work. Updates become visible atomically, with each read using a consistent snapshot. Failures must not silently return stale successful data or expose a partially updated collection. After a failed development preparation, new query executions and body/render operations reject until a valid replacement preparation succeeds; see [development failure and recovery](#development-failure-and-recovery).

Discard obsolete preparation results when a newer source attempt supersedes them. Operations already in progress finish against their pinned prepared revision; publication of a newer revision does not cancel those reads. Removing a cache must affect performance, not correctness or observable results.

### 10. Keep integrations and site policy outside the core

The compiler and query runtime must work independently of Void, Vite, and UI frameworks. Framework and bundler integrations adapt the library through explicit boundaries. `content-query.config`, loaders, source schemas, and computed resolver code belong to preparation; production queries and built-in rendering consume prepared artifacts and library runtime code.

Routes, rendering, locale fallback, navigation, and publication rules remain application-owned. Locale and version continue to be ordinary fields rather than special core behaviors.

The following sections define the API, artifact format, caching guarantees, and integration behavior within these constraints.

## Collection API

Define entry identity, loader inputs, validated data, computed query fields, built-in rendering capabilities, and relationships before the query API that consumes their prepared representation.

### Schema support

Status: Standard Schema is the public validation contract, agreed on October 17, 2026. TypeScript query-field checks without a complete runtime field catalog are agreed on October 18, 2026. These rules define the v1 implementation contract.

Accept [Standard Schema V1](https://standardschema.dev/) schemas for collection source metadata and computed field results. Zod is one compatible provider used in the living example; the public schema contract must not require Zod types or a particular validation library.

| Concern         | Rule                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation      | Use the schema's Standard Schema validation interface. Support synchronous and asynchronous validation results, and use the validated output value.                                                                          |
| Type inference  | Infer public types from the schema's output types, including defaults, coercions, and transformations. Input types do not determine query results or resolver-context data after validation.                                 |
| Source metadata | Validate loader-provided source data during preparation. Its validated output must satisfy the collection entry-data contract.                                                                                               |
| Computed fields | Validate each computed resolver's result during preparation before making it available to queries.                                                                                                                           |
| Stored values   | Store validated results and load them without rerunning schema transformations. Serialization and decoding must preserve public values, types, and property presence, including explicit `undefined` separately from `null`. |
| Errors          | Preserve Standard Schema validation issues and attach collection, entry, and source context where available.                                                                                                                 |

For example, output inference uses the standard interface:

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";

type SchemaOutput<Schema extends StandardSchemaV1> = StandardSchemaV1.InferOutput<Schema>;
```

Validation and runtime field inspection are separate concerns. Standard Schema does not provide a general object-field inspection API; accepting its validation contract must not depend on deriving a complete field catalog from provider-specific schema internals. Do not require transforms to be translated into SQL or described through a Zod-specific output-schema convention merely to use them for validation.

Query semantics and storage encoding remain library-owned and operate on validated data. A future SQLite adapter could query serialized validated content; this schema decision does not require generating SQL columns directly from validation schemas. V1 uses inferred TypeScript output types to check field names, eligible operators, and typed arguments. It does not require provider-specific inspection, additional field declarations, or a complete runtime field catalog.

Keep the serializable registry, relationship mappings, and rendering capabilities required by execution; these do not reconstruct a schema field catalog. Production must not import the source schemas merely to inspect fields. Follow the agreed [query field checks](#query-field-checks), [filtering contract](#filtering), [sorting rules](#sorting-and-pagination), and [field-name collision rules](#field-names-and-collisions). Generated value encoding follows the [collection layout and codec contract](#generated-collection-layout-and-encoding).

### Supported data values

Status: follow Astro's content-store value support, agreed on October 17, 2026. These rules define the v1 implementation contract.

Use the built-in, synchronous devalue serialization model used by [Astro's content store](https://github.com/withastro/astro/blob/main/packages/astro/src/content/data-store.ts) as the value-compatibility baseline. The reference checked on October 17, 2026 uses [devalue `^6.0.2`](https://github.com/withastro/astro/blob/main/packages/astro/package.json); [devalue's implementation](https://github.com/sveltejs/devalue/blob/v6.0.2/src/stringify.js) and [supported types](https://github.com/sveltejs/devalue) define the baseline, without custom reducers or revivers. Future upstream changes do not automatically change this library's public contract.

| Values             | Support                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Primitives         | Strings, booleans, numbers, `null`, `undefined`, and `BigInt`. Includes `NaN`, infinities, and negative zero.    |
| Objects and arrays | Plain objects and arrays containing supported values. Preserve `undefined` array elements and array holes.       |
| Native values      | `Date`, `RegExp`, `Map`, `Set`, `URL`, and `URLSearchParams`.                                                    |
| Binary values      | `ArrayBuffer`, typed arrays, and `DataView`.                                                                     |
| Temporal values    | The Temporal types supported by the baseline serializer when available on the target runtime.                    |
| References         | Circular and repeated references within a serialized entry value are supported.                                  |
| Unsupported values | Reject functions, symbols, unresolved promise values, and arbitrary class instances outside supported built-ins. |

The baseline serializer also rejects symbolic object keys and own `__proto__` data properties. These are unsupported stored object shapes, including nested values; they are not silently dropped or rewritten. Collection and entry IDs remain ordinary strings.

The collection's validated source metadata must remain a record of named fields. Computed fields may return supported values, including native containers. Await asynchronous resolver and validation operations, then check the validated output against this value contract. Do not serialize resolver functions or loader-owned callbacks as entry data. Report unsupported values with collection, entry, and field-path context.

Apply the same value contract to every backend, including in-memory. Loading stored values must restore the promised types, special values, property presence, and references within the serialized value without rerunning schema transforms. Generated storage follows the [collection layout and devalue encoding contract](#generated-collection-layout-and-encoding), without requiring Astro or its module IDs. In-memory and future SQLite storage preserve the same public values. There is no public custom-codec API in v1.

Storage support is separate from query-operation support. A selected `Map`, for example, does not gain map-specific filters or sorting merely because it can be stored. Follow the agreed [filter operator/type matrix and edge cases](#filtering) and [sorting rules](#sorting-and-pagination).

### Field names and collisions

Status: agreed on October 17, 2026. These rules define the v1 implementation contract.

Selected query fields and requested relationships become properties of the same result object. Built-in rendering returns a separate object. Use one top-level field namespace per collection:

| Concern             | Rule                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry identity      | Reserve top-level `id` for the loader-supplied entry identity. Validated source metadata, computed fields, and relationships cannot redefine it.                                           |
| Field groups        | Source metadata, computed fields, and relationship names must not overlap, even if a query would request only one of the conflicting fields.                                               |
| Computed fields     | Add fields rather than overwriting source metadata. Normalize an existing field, such as `title`, through its validation schema.                                                           |
| Case sensitivity    | Names are case-sensitive. For example, `publishedAt` and `publishedat` are distinct.                                                                                                       |
| Nested objects      | Each nested object has its own namespace. A top-level `title` can coexist with `seo: { title: ... }`; top-level reservations do not reserve the same names inside nested objects.          |
| Other names         | Reserve no other ordinary names. Loader properties such as `body` and `data` live outside source metadata and do not automatically reserve those names as metadata or derived field names. |
| Collision detection | Catch overlaps through TypeScript where possible. At runtime, check declaration names and validated metadata during preparation, and never silently overwrite a returned result property.  |

For example, keep an authored `authorId` in source metadata and declare an `author` relationship. A source `author` field and an `author` relationship would conflict. The rules apply to validated schema output, which can differ from raw loader input.

These checks must work with Standard Schema without requiring provider-specific schema inspection. Use inferred output types where available, known declaration names, and the actual validated metadata. This section defines namespaces; it does not introduce nested field-path query syntax.

### Entry identity and preparation

Status: identity, preparation, development updates, and structured entries agreed on October 17, 2026; optional captured-string bodies and loader-supplied rendered HTML agreed on October 18, 2026. Built-in loader APIs and default IDs now follow Astro, agreed on October 18, 2026, replacing the earlier path-preserving ID proposal. These rules define the v1 implementation contract.

| Concern             | Rule                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity            | Entry IDs are unique within a collection. Cross-collection identity is the pair of collection name and entry ID. Reject duplicate IDs instead of replacing entries silently.             |
| Default IDs         | `glob()` follows Astro's slug-based generation and raw `data.slug` override, with optional `generateId`. `file()` uses array IDs or object keys. Custom loaders supply IDs.              |
| Metadata processing | Load and validate source metadata and prepare computed query fields before publishing a queryable revision. Relationship integrity checks also complete before publishing it.            |
| Raw-body access     | Read raw bodies when preparation, production packaging, explicit body access, or built-in rendering needs them. Body access must use the same content revision as the prepared metadata. |
| Development updates | Support additions, replacements, and removals. Core manages invalidation and revision consistency; integrations connect filesystem watching or other sources of update notifications.    |

Identity does not define application routes or introduce special locale behavior. Follow the [built-in loader APIs](#built-in-loaders) below rather than adding a separate `markdown()` helper or preserving case by default.

Reading a Markdown file to extract frontmatter can also read its raw body. Separating body access from query fields does not promise that frontmatter can be read without reading the rest of the file. Compiling Markdown remains a separate rendering-policy decision.

Loaders supply Astro-style structured entries containing `id`, parsed source `data`, optional captured `body` text, optional prepared `rendered` HTML/metadata, and an optional diagnostic `filePath` string. Core validates source data against the collection schema and prepares computed fields; `parseData()` validates metadata once, and direct unparsed store writes are validated before publication. Follow the [native loader contract](#loader-lifecycle): a named asynchronous `load(context)` writes the collection store, while development updates use `context.watcher`. The native loader API now adopts Astro’s named store-mutation contract; the previous snapshot/watch API is superseded by the lifecycle below. Production uses [prepared data, captured inputs, and library-owned rendering modules](#portable-production-packaging) without importing this configuration.

### Built-in loaders

Status: follow Astro's built-in loader authoring APIs, discovery options, default IDs, and data parsers, agreed on October 18, 2026. This replaces the proposed `markdown({ directory })` helper, path-preserving IDs, and JSON-only built-in data parsing. These are redesign requirements, not current package capabilities.

Export `glob` and `file` from `content-query/loaders`. Both use the native store-writing loader lifecycle and build-only configuration boundary. Built-in formats for v1 are Markdown, JSON, YAML, and TOML. Matching Astro's loader surface does not add its framework-specific MDX/Markdoc processors or rich component compilation to v1.

#### Glob loader

Use `glob({ pattern, base?, generateId?, retainBody?, deferRender? })`:

```ts
import { glob } from "content-query/loaders";

glob({
  pattern: "**/*.md",
  base: "./content/posts",
  retainBody: true,
  deferRender: false,
});
```

| Option        | Contract                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern`     | Required `string` or `string[]`, relative to `base`. Follow Astro's glob matching, including exclusion patterns consistently during discovery and watching.                        |
| `base`        | `string` or `URL`, default `"."`. Resolve string paths from the application root; a file URL can identify another directory.                                                       |
| `generateId`  | Optional synchronous `({ entry, base, data }) => string`. Receives the relative file path, resolved base URL, and parsed, unvalidated metadata. It replaces default ID generation. |
| `retainBody`  | Default `true`; preserve the agreed public raw-body retention behavior.                                                                                                            |
| `deferRender` | Default `false`; applies to Markdown compilation under the agreed rendering lifecycle, not data entries.                                                                           |

Match Astro's default identity generation: use a truthy raw `data.slug` override converted to a string; otherwise remove the file extension, slugify each path segment with `github-slugger`, join with `/`, and remove a trailing `/index`. Generation precedes schema validation/transforms. It does not add a queryable `slug` field or assign a route. Source fields retained by the schema still follow the normal field-name rules.

| Input relative to `base`                     | Default ID        |
| -------------------------------------------- | ----------------- |
| `Getting Started.md`                         | `getting-started` |
| `Guides/Overview.md`                         | `guides/overview` |
| `Guides/index.md`                            | `guides`          |
| `index.md`                                   | `index`           |
| Any filename with raw `slug: "manual/start"` | `manual/start`    |

Use `generateId` to preserve filename case or choose another identity rule. Duplicate generated IDs remain preparation errors; do not add collision counters. A globbed data file is one entry whose metadata comes from that file; use `file()` when a single file contains multiple entries.

An unmatched glob yields an empty snapshot with a diagnostic, including when `base` does not yet exist. Development watching must still account for later creation. Watching reloads a glob collection only for files its patterns can match; a conservative superset may reload for a file discovery skips, but must never miss one discovery includes. Actual read/parse failures surface under the agreed error policy, identifying each failing file through `source` with the parser's message. Source metadata and raw Markdown are captured together; bodies and rendering payloads stay separate from the query index. The captured Markdown body excludes frontmatter and the blank lines separating it from the content.

References: [Astro loader options](https://docs.astro.build/en/reference/content-loader-reference/#glob-loader), [default generator](https://github.com/withastro/astro/blob/main/packages/astro/src/content/loaders/glob.ts), and [path slug generation](https://github.com/withastro/astro/blob/main/packages/astro/src/content/utils.ts).

#### File loader

Use `file(fileName, options?)` with an optional `parser` for one multi-entry JSON, YAML (`.yaml`/`.yml`), or TOML file. Resolve its filename from the application root and select the built-in parser from its extension. `parser(text)` can synchronously or asynchronously override parsing, including extracting nested data or supporting another format. It returns an array of records or an object keyed by IDs. Schema validation remains a separate core step.

```ts
import { file } from "content-query/loaders";

file("./content/authors.json");
file("./content/authors.yaml");
file("./content/authors.toml");

file("./content/team.json", {
  parser: (text) => JSON.parse(text).authors,
});
```

Arrays supply `id` on each record; follow Astro's `slug` fallback when `id` is nullish, with the selected identity converted to a string. Object-form keys are the identities; a string-valued top-level `$schema` annotation is ignored, as in Astro. Identity must be nonempty and unique after normalization. Existing core error guarantees reject invalid/duplicate entries instead of silently skipping or overwriting them.

Built-in source acquisition privately captures identity in `id`, metadata in `data`, and a diagnostic `source`; its native `load(context)` writes `DataEntry` values with `filePath` to the store. Consume any transport `id` property before metadata validation so the reserved top-level `id` cannot collide in our flat query field namespace. Object keys are authoritative in the keyed form, rather than rejecting an embedded `id` as an alternative identity. Preserve an ordinary `slug` property if present; schema output decides whether it remains queryable. Data entries do not automatically acquire a raw body or rendering output.

References: [Astro file loader API](https://docs.astro.build/en/reference/content-loader-reference/#file-loader) and [file loader normalization](https://github.com/withastro/astro/blob/main/packages/astro/src/content/loaders/file.ts). Adoption concerns the built-in authoring/data contract. Keep the already agreed structured-entry loader protocol, Standard Schema validation, strict error/duplicate handling, rendering lifecycle, and build-only configuration; it does not adopt Astro's mutable store API or warning-and-skip behavior for malformed source entries.

### Loader entries and body access

Status: follow Astro’s optional body and prepared rendering payload model, agreed on October 18, 2026. Keep explicit selection, lazy backend payload loading, and framework-independent rendering results. Lazy source-reader callbacks are deferred beyond v1.

Loaders acquire their inputs during preparation and supply captured strings rather than source-reading functions. The following captures the v1 payload contract and uses the public names selected in the implementation defaults:

```ts
type ContentHeading = {
  depth: number;
  slug: string;
  text: string;
};

type RenderedContent = {
  html: string;
  metadata?: {
    headings?: ContentHeading[];
  };
};

type DataEntry = {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  rendered?: RenderedContent;
  filePath?: string;
};
```

`body` is format-agnostic raw text. A Markdown article can contain Markdown, a custom loader can supply HTML or plain text, and a JSON author can omit it. An empty string is valid. Missing or unretained raw text has value `undefined`; it is not a missing-body error. Do not add collection-level body capability generics merely to gate access. The public `content.readBody(collection, id)` operation reports missing entries and invalid collections as explicit lookup errors, separately from valid absence of retained text.

`rendered` contains prepared HTML and optional metadata. A loader may supply CMS HTML directly or produce HTML during build-time processing. Validate the library-owned payload shape during preparation. When supplied, this output can be rendered without a body or a runtime processor callback. If headings are omitted, the public rendering result uses `[]`. A raw body alone does not identify its format or make a generic entry renderable as Markdown.

The heading `slug` identifies the corresponding heading ID in generated HTML; the built-in Markdown processor must produce matching IDs, including unique IDs for repeated headings. Headings carry only these IDs; permalink anchors and other heading presentation are application-owned. Custom loaders are responsible for matching their supplied heading metadata to their HTML. V1 exposes the HTML/headings contract above without additional processor frontmatter or asset metadata. Asset paths do not introduce an asset-processing contract; follow the public-URL boundary below.

Asset delivery is application-owned, agreed on October 18, 2026. Treat image and link destinations as URLs supplied by the author. The renderer preserves those destinations instead of resolving them against original source files, copying or optimizing assets, or rewriting URLs. Applications supply publicly accessible URLs such as `/images/diagram.png` or `https://example.com/diagram.png` and arrange delivery themselves. A diagnostic `source` path does not enable asset acquisition. Relative URLs remain application-owned browser URLs; the library does not interpret them as source-file dependencies. This boundary applies to both eager and deferred rendering and does not require Astro's asset metadata or image pipeline.

The internal diagnostic `LoaderEntry.source` identifies an entry, for example a filename, URL, or CMS identifier. It is separate from the optional loader-defined metadata exposed as `ComputedContext.source`, which is carried privately in `LoaderEntry.sourceData`. Neither introduces an implicit query field, route, version guarantee, or automatic registration of a watched dependency. Loaders and integrations still own source acquisition and update notifications.

| Stage                 | Behavior                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acquire source inputs | Read/fetch metadata and any supplied body or rendered output before returning a snapshot or incremental batch. Do not return source-reading body functions.                   |
| Prepare query data    | Validate metadata and computed fields. Computed resolvers can explicitly read the captured source text; rendering remains a separate stage.                                   |
| Package production    | Retain public bodies according to `retainBody`, prepared rendering output, and any private input required for deferred compilation. No deployed source reads are required.    |
| Select metadata       | Do not load body/rendering payloads because a query selects prepared fields.                                                                                                  |
| Access raw text       | Call `content.readBody(collection, id)` to explicitly load retained text. An existing entry without retained text returns `undefined`; missing entries produce lookup errors. |
| Render an entry       | Load supplied/precompiled HTML, or process captured Markdown using the library-owned renderer according to `deferRender`.                                                     |
| Source update         | Invalidate affected preparation/cache work for future operations; existing operations finish against their pinned prepared revision.                                          |
| Payload I/O failure   | Surface the failure. Do not confuse a failed read with a valid absent body or silently substitute old content.                                                                |

For ordinary local Markdown, capture the body during the same file read that extracts frontmatter. Other loaders must also capture revision-consistent metadata and text during preparation. Reading multiple mutable sources is still the loader’s responsibility; removing body callbacks does not make arbitrary source reads transactional.

The backend may load captured strings and prepared HTML lazily. This is distinct from postponing source acquisition through a callback. Reuse of loaded payloads must remain revision-aware. Stored fields never contain executable readers or implicit lazy getters.

Explicit raw-body access uses `content.readBody(collection, id): Promise<string | undefined>`. It returns optional text separately from selected query results, without introducing a full-entry lookup or weakening mandatory field selection. Astro’s `entry.body` is the semantic baseline; asynchronous separate access is the deliberate adaptation for explicit backend payload loading. Application-owned server functions can process retrieved text without generic collection resolvers.

Reference: Astro’s [optional body](https://docs.astro.build/en/reference/content-loader-reference/#dataentrybody), [rendered payload](https://docs.astro.build/en/reference/content-loader-reference/#dataentryrendered), and [heading metadata](https://docs.astro.build/en/reference/content-loader-reference/#dataentryrenderedmetadataheadings). These contracts are a baseline; this library retains its own query and framework boundaries.

### Body retention

Status: `retainBody: true` by default, with an opt-out for publicly accessible raw text, agreed on October 18, 2026. Follow Astro’s option semantics while keeping the requirements of our deferred runtime compiler explicit.

```ts
glob({
  pattern: "**/*.md",
  base: "./content/posts",
  retainBody: true,
  deferRender: false,
});
```

Retention controls the prepared public raw-body value, not whether a loader reads the source or a computed field can process its captured text during preparation. `false` makes public raw-body access return `undefined`; it does not invalidate already prepared HTML/headings. Custom loaders can supply or omit `body` directly.

With eager compilation and `retainBody: false`, deployed rendering can use compiled output without publicly retaining source text. With deferred runtime compilation, preserve any private Markdown input the processor still needs, even if public body access is disabled. The option cannot promise to remove bytes that remain necessary for rendering. Avoid assuming two physical copies are required; physical reuse of captured text remains an implementation detail.

Never discard compilation inputs before required processing completes. Retention changes affect prepared artifacts and development invalidation. Metadata queries remain independent of both raw text and rendered payloads in every mode.

Reference: Astro’s [`retainBody` option](https://docs.astro.build/en/reference/content-loader-reference/#retainbody). Our request-time compiler strategy remains a documented difference from Astro’s module-based deferred path.

### Computed query fields

Status: plain `{ schema, resolve }` definitions retained for computed fields; generic deferred fields removed from v1 on October 18, 2026.

```ts
computed: {
  slug: {
    schema: slugSchema,
    resolve: resolveSlug,
  },
}
```

`schema` validates a computed result, and `resolve` derives that result from loader-provided inputs. Resolvers may return a value or promise. Await the resolver and Standard Schema validation, use the validated output type, and check the supported value contract before publishing a queryable revision.

Computed fields run during preparation and become selectable, filterable, and sortable where their types permit. Incremental preparation may reuse unaffected values. An expensive excerpt or reading-time field needed for querying belongs here even if it reads the body. Computed fields are independent of other computed fields in v1.

`defineCollection(...)` remains the inference boundary for source metadata and computed results. There is no v1 `deferred` group or query `.resolve(...)` method. Application-defined on-demand processing is ordinary server code; the built-in Markdown renderer has its own explicit runtime operation and fixed result contract.

### Reusable computed text fields

Status: reading time, word count, and excerpt helpers implemented on October 19, 2026. Queryable headings and table-of-contents helpers remain deferred.

`content-query/computed` exports `readingTime(options?)`, `wordCount(options?)`, and `excerpt(options?)` as ordinary `{ schema, resolve }` computed definitions with Standard Schema output types. Field names remain application-owned. Reading time returns whole minutes rounded up, with a default speed of 200 words per minute. Word count follows the `reading-time` package's estimated word boundaries. Excerpts return plain text with a default maximum of 160 graphemes, including a trailing ellipsis, preserving complete Unicode graphemes and preferring word boundaries.

All helpers default to `readBody()` and Markdown input. A typed `from(context)` selector can return text or a promise from metadata, loader source metadata, or another captured input. `format: "text" | "markdown" | "html"` controls extraction. Markdown syntax and link destinations are removed while code and image alternatives remain. HTML extraction decodes entities, separates blocks, and excludes comments and head/script/style/template/noscript/hidden elements without executing scripts or evaluating CSS. Text mode preserves literal syntax. Whitespace is normalized; undefined input is empty, and other non-string inputs fail with ordinary computed-field diagnostics.

Custom selectors use explicit `Data` and optional `Source` type arguments; the surrounding collection object does not contextually infer nested helper arguments. Reading speed must be finite and positive; excerpt length must be a positive safe integer. Helpers observe cancellation around asynchronous input selection. They run during preparation even when raw bodies are not publicly retained, require no syntax highlighter, and add no helper/config/parser imports to deployed query graphs.

### Collection authoring and build-only configuration

Status: agreed on October 18, 2026. This supersedes the earlier proposal that production could import combined or loader-free shared collection definitions.

Define each collection once with its loader, source schema, computed fields, and relationships, then export one registry from `content-query.config`. Keep the loader present at the `defineCollection(...)` inference boundary. It can be an imported value; the requirement concerns available type information, not literal source-code placement. Reusable configuration fragments and build-side helper modules remain ordinary authoring choices.

Configuration is consumed only by development preparation and production build preparation. Original loaders, schema objects, schema transforms, and computed resolver functions do not enter the deployed runtime through the generated content entry. They must not execute again when loading prepared data. The configuration does not have to be compatible with an edge SSR target merely because that target queries its prepared content.

The production entry imports the collection manifest, prepared query data, captured bodies or compiled outputs, and library-owned runtime modules. It must not import `content-query.config`, the exported `posts`/`authors` definition objects, or a shared schema/resolver definition module as a way to reconstruct its registry. Record necessary collection names, relationship mappings, capabilities, and serializable renderer options during preparation instead. Infer types through generated declarations or type-only references, without adding a runtime config import.

Applications provide one registry; integrations or the build command produce the server entry. There is no second application-maintained registry or mandatory `content.runtime.ts`. Production runtime initialization consumes prepared artifacts or explicitly embedded prepared state. Follow the agreed [build API and generated server entry](#build-api-and-defaults); runtime adapter factories are private implementation details.

No runtime-safe definition split, arbitrary function serialization, closure extraction, or bundler-specific removal of config properties is required for v1. Generic deferred resolvers are a [future extension](./TODO.md#generic-deferred-fields), not a reason to reintroduce production config imports.

### Computed resolver context

Status: build-time context agreed on October 18, 2026. These rules describe the redesign API, not the current implementation.

| Member       | Purpose                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `id`         | Stable entry identity.                                                                              |
| `data`       | Validated, read-only source metadata. Other computed fields are unavailable in v1.                  |
| `readBody()` | Explicit asynchronous access to captured source text for this preparation revision; returns `string | undefined`. No collection-level body restriction. |
| `signal`     | A library-managed signal for cooperative cancellation of preparation.                               |

The build-time `readBody()` helper is available for every collection and returns `Promise<string | undefined>`. It reads the loader-supplied captured text rather than invoking a source callback; absent text is `undefined`. Computed resolvers must handle absence. Public raw-body access follows the retention policy, while preparation can use captured source text before retention is applied. No separate body-capability flag or loader-free shared definition is required.

Resolvers must not mutate shared data, acquire original sources independently, or treat `readBody()` as a Markdown compiler. Additional file reads and remote fetching belong to loaders. Validate computed results before storing them, and never rerun their functions or schema transforms during production queries. See [cooperative cancellation](#cooperative-cancellation).

### Relationship declarations

Status: forward/inverse mappings and fluent loading agreed on October 17, 2026; explicit reference ownership, optionality, singular query behavior, and ID-array rules agreed on October 18, 2026. These describe the redesign, not the current implementation.

Declare relationships separately from source validation using plain objects. A post keeps `authorId: z.string()` in its source schema and declares:

```ts
relationships: {
  author: {
    collection: "authors",
    type: "one",
    from: "authorId",
    to: "id",
    referenceSide: "from",
  },
}
```

An author declares the inverse without storing a list of authored post IDs:

```ts
relationships: {
  posts: {
    collection: "posts",
    type: "many",
    from: "id",
    to: "authorId",
    referenceSide: "to",
  },
}
```

| Member          | Meaning                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `collection`    | Registered target collection.                                                                                    |
| `type`          | Result cardinality: `"one"` for one selected object or an allowed `null`, or `"many"` for an array.              |
| `from`          | Matching field on the current/source collection.                                                                 |
| `to`            | Matching field on the target collection.                                                                         |
| `referenceSide` | Explicitly identify the side storing authored references: `"from"`, `"to"`, or `"none"` for a pure field lookup. |

Reference ownership is independent of result cardinality and matching direction. `"from"` means the current collection stores the link. `"to"` means the target collection stores links back to the current collection. `"none"` declares a field lookup without treating its values as authored foreign references. Do not infer ownership from field names or the presence of `id`. The examples use `referenceSide` as the working public spelling.

Matching uses prepared metadata, computed fields, and entry IDs. Body/rendering payloads cannot participate. TypeScript checks declared field names and compatible scalar or ID-array types against the registered collection types. Runtime preparation checks registered target collections, declaration structure, and supplied link values under the integrity rules without deriving a complete schema field catalog. A field absent from every entry is not by itself an invalid declaration. Scalar matching follows the agreed scalar equality semantics without coercion; missing, undefined, and null relationship keys mean absence rather than matching other absent keys.

Forward and inverse mappings can match fields other than `id`. When a side is an authored reference, supplied keys must identify valid, unambiguous opposite-side entries. Use `referenceSide: "none"` for grouping/lookups that intentionally match multiple entries sharing a field value. Singular result cardinality is checked separately over each current entry's complete unfiltered matches.

Definitions and schemas stay in preparation. Store field mappings, reference ownership, and relevant runtime descriptors in the prepared manifest. Production does not import the original definition objects or inspect validation-provider internals.

### Relationship integrity and optionality

Status: preparation-time integrity agreed on October 17, 2026; ownership, absence, inverse-zero, and filtered singular rules agreed on October 18, 2026.

| Situation                                                                                         | Behavior                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A supplied reference has no valid opposite-side target                                            | Fail preparation, including when the owning source field is optional.                                      |
| A supplied reference ambiguously identifies multiple entries                                      | Fail preparation rather than choosing a target.                                                            |
| An owning reference field is missing, undefined, or null and its validated output permits absence | Treat it as unlinked; return `null` for a requested singular relationship or `[]` for a many relationship. |
| A required owning reference field is absent                                                       | Source/computed validation fails before the revision becomes queryable.                                    |
| An inverse singular relationship or a singular pure lookup has zero matches                       | Return `null`.                                                                                             |
| A many relationship has no matches                                                                | Return `[]`.                                                                                               |
| A one relationship has multiple underlying matches                                                | Fail preparation. A nested filter or query limit cannot hide this invalid cardinality.                     |
| A valid singular target is excluded by a nested filter                                            | Return `null` and retain the parent. This is a query result, not broken source integrity.                  |

Use the owning field's validated output type to infer forward-reference optionality. For example, `authorId: z.string()` is required; `authorId: z.string().nullable().optional()` permits absence. No separate optionality flag is required. A schema that fills in a default may produce a required output even when its raw input can omit the field. Runtime preparation works with validated values; it does not require Zod-specific schema inspection.

`referenceSide` identifies which collection owns those values even for inverse-only declarations. Validate every supplied reference in that owning collection against the complete opposite collection. An author with no posts is valid; a post's supplied `authorId` pointing to a missing author is invalid. Optionality allows an omitted link rather than a dangling link. Every supplied ID in an array is checked, including repeated IDs.

Validate against the complete prepared revision before query filtering, sorting, or pagination. Invalid references fail the content preparation attempt. One-shot preparation and production builds reject; a watch session remains available in the error state until corrected. Development updates surface the failure without publishing partial changes or silently returning stale successful results. Errors identify the owning collection/entry/field, relationship, and missing or ambiguous targets. Report every invalid reference together; skip only relationships whose owning or opposite collection already failed preparation, since its missing entries would make references look dangling.

Unfiltered required forward singular references return selected target objects. Optional forward singular references, inverse singular relationships, and singular pure lookups include `null` in their result types. Adding a nested filter also makes a singular result nullable, even for an otherwise required reference. Many results are arrays. Only selected fields and explicitly requested relationship properties appear.

The preparation-time checks deliberately differ from Astro's reference lookup behavior: Astro resolves references through `getEntry()`/`getEntries()`, which can return undefined targets. Our previously agreed stricter preparation guarantee remains. See [Astro's reference API](https://docs.astro.build/en/reference/modules/astro-content/#reference).

### ID-array relationships

Status: direct matching, authored ordering, and duplicate preservation agreed on October 18, 2026.

An authored ID array maps directly to scalar target IDs through the same fields, with no separate array-matching option:

```ts
featuredPosts: {
  collection: "posts",
  type: "many",
  from: "featuredPostIds",
  to: "id",
  referenceSide: "from",
},
```

For forward ID-array references, return matching entries in authored order, preserving repeated IDs as repeated result positions. For example, `["upcoming-features", "getting-started", "upcoming-features"]` produces those three positions when unfiltered. Each supplied ID must resolve; an omitted optional array or an empty array yields `[]` after validation. An ID-array relationship is not a general array-to-array join.

Apply nested filters to candidate positions before offset/limit. Explicit `.orderBy(...)` overrides authored order using the normal scalar sort and ID tie-break rules; it does not deduplicate entries. Preserve order and multiplicity across JavaScript execution and a future SQLite implementation, for example by retaining array-position information internally. Exact storage/index strategy is a private implementation detail.

Inverse membership returns each matching owning entry once, even when its stored array repeats the current entry's ID. Its default order follows ordinary ascending entry ID order, rather than an order borrowed from another entry's array. Other inverse and pure lookup many relationships use the same ordinary default ordering.

Preserving authored forward-array order and duplicates follows [Astro's `getEntries()` implementation](https://github.com/withastro/astro/blob/main/packages/astro/src/content/runtime.ts). Fluent loading, inverse membership, filtering, and per-parent pagination are this library's richer contract.

## Query API

Queries consume the collection definitions above. This section covers builder reuse, filtering, returned fields, sorting, pagination, and explicit relationship loading. Built-in rendering is a separate runtime operation.

### Query field checks

Status: rely on TypeScript for schema-aware field names, operator eligibility, and argument types, agreed on October 18, 2026. This is a redesign decision, not current package behavior.

Use inferred source/computed output types throughout selection, filtering, sorting, and relationship declarations. V1 does not add field declarations or schema-provider adapters to make runtime typo detection exhaustive. Do not infer the set of valid fields from observed entry keys: a valid optional field can be absent everywhere, and a valid collection can be empty.

At execution, read prepared own properties and follow the existing missing-value rules. A field name that bypasses TypeScript and is absent from an entry behaves as a missing property, including an own `undefined` property when explicitly selected. It is not automatically an `invalid-query` error. Empty collections retain normal query-miss outcomes. No complete runtime schema field-name/type catalog is required by either JavaScript execution or a future SQLite backend.

Runtime still checks query structure and independently checkable arguments, including pagination, repeated clauses, and operator argument shapes. Registered collection and relationship names remain checkable from the manifest. Source/computed validation, supported-value checks, collision detection, relationship integrity, and no-coercion semantics remain required. This decision removes exhaustive runtime schema-field checks, not preparation validation or ordinary query validation.

### Query builder immutability and reuse

Status: immutable builders agreed on October 17, 2026. These rules define the v1 implementation contract.

Query configuration methods return a new builder without changing the builder they were called on. Apply this rule to `.select(...)`, `.where(...)`, `.orderBy(...)`, `.limit(...)`, `.offset(...)`, and `.with(...)` on both root and applicable nested builders. Callers must use the returned builder; calling a configuration method and discarding its return value does not change an existing query.

A base query can safely produce independent branches. Adding a locale filter, selection, relationship, or pagination to one branch must not affect another branch or the base query. The [living example](#branch-from-a-shared-query) demonstrates this with published posts in two locales.

Terminal methods execute the query without consuming or changing its configuration. Reusing a builder does not pin a content revision: each execution follows the per-query revision-consistency contract. Internal query-result caching follows the revision-aware implementation defaults; public cross-operation snapshot scopes remain outside v1.

Immutability does not determine repeated-clause behavior. Follow the agreed method-specific rules: repeated `.where(...)` calls combine with AND, repeated `.orderBy(...)` calls append priorities while rejecting duplicate fields, and repeated `.limit(...)` or `.offset(...)` calls are rejected. Reject a second `.select(...)` on the same builder branch, including when the fields are unchanged. Reject duplicate `.with(...)` requests for the same relationship in the same query scope; requests for different relationships are allowed. These methods do not implicitly merge or replace earlier requests. Each nested scope has its own selection and relationship requests.

The reason for immutability is predictable reuse of query definitions. The implementation can share unchanged internal query state between builders; the public contract does not require deep-copying the whole plan after every call. Allocation costs and performance differences need measurement rather than an assumed performance advantage for either approach. This choice applies equally to JavaScript execution and a future SQLite backend.

Drizzle makes two independent choices worth distinguishing:

- Its default SQL builder restricts most clauses to one call. Drizzle's [documented rationale](https://orm.drizzle.team/docs/dynamic-query-building) is to follow SQL's structure and avoid ambiguity: earlier unrestricted calls confused users who expected repeated `.where(...)` calls to merge. Explicit boolean composition gives one condition, while `.$dynamic()` relaxes the typing restrictions for reusable query-enhancement helpers; it does not automatically merge filters.
- Its [SQL builder implementation](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.ts) mutates configuration and returns the same instance. We have not established an official rationale for that choice. Simpler state updates, fewer intermediate builder objects, and helpers that modify a builder in place are inferred benefits, not a documented historical explanation or measured performance claim. Shared-base branching can consequently affect other uses of that builder.

SQL's single-clause structure does not require a mutable builder. Our immutable builders can compose conditions into one backend query while preserving the agreed public behavior.

### Filtering

Status: the v1 operator set, type matrix, and numeric, date, and array edge cases are agreed on October 17, 2026. These rules define the v1 implementation contract.

Use `.where((fields) => expression)` to construct a structured query expression over prepared metadata and computed fields. The callback constructs the expression; it is not an arbitrary predicate run against each content object. Raw bodies and rendering output cannot participate in filtering. Use the same operators and semantics in root and applicable nested queries across all backends.

| Purpose                     | V1 operators                                            |
| --------------------------- | ------------------------------------------------------- |
| Scalar equality             | `eq`, `ne`                                              |
| Comparison                  | `gt`, `gte`, `lt`, `lte`                                |
| Match one of several values | `inArray`, `notInArray`                                 |
| Literal string matching     | `contains`, `startsWith`, `endsWith`                    |
| Scalar-array membership     | `arrayContains`, `arrayContainsAny`, `arrayContainsAll` |
| Null and absence            | `isNull`, `isUndefined`, `isMissing`                    |
| Boolean composition         | `and`, `or`, `not`                                      |

Allowed filter operators depend on the prepared field's type:

| Field type               | Allowed filters                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| String                   | `eq`, `ne`, `inArray`, `notInArray`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`. |
| Number, `BigInt`, `Date` | `eq`, `ne`, `inArray`, `notInArray`, `gt`, `gte`, `lt`, `lte`.                                       |
| Boolean                  | `eq`, `ne`, `inArray`, `notInArray`.                                                                 |
| Array of scalars         | `arrayContains`, `arrayContainsAny`, `arrayContainsAll`.                                             |
| Other rich values        | Absence checks only.                                                                                 |

All field types also support `isNull`, `isUndefined`, and `isMissing`. Optional or nullable fields retain their non-nullish base type's operators; null and undefined remain valid equality/choice arguments where the schema permits those values. Mixed scalar categories such as `string | number` support equality and choice lists, while ordering and string matching require a consistent base type. Unions of literals from one category, such as `"draft" | "published"`, remain string fields for operator eligibility.

Scalar-array membership uses the same scalar value equality rules, including timestamp equality for dates. A nullable or optional array retains its array operators. Whole-array equality and deep object equality are outside v1. Boolean fields retain their existing false-before-true sorting support without gaining range-filter operators.

| Concern            | Rule                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed operations   | TypeScript checks operators and arguments against the field type. Runtime follows the query-field-check contract and does not implicitly coerce values.          |
| Value equality     | Compare scalar values. Dates compare by timestamp; `NaN` equals itself, and positive and negative zero compare equally. `ne` negates equality.                   |
| Literal strings    | Matching is case-sensitive. `%` and `_` are literal characters rather than SQL wildcard syntax.                                                                  |
| Boolean predicates | Predicates produce booleans. Ordering comparisons and string operations on missing, undefined, or null values return false. `not()` negates the result normally. |
| Repeated filters   | Repeated `.where(...)` calls combine with AND rather than replacing an earlier condition.                                                                        |
| Empty choices      | `inArray(field, [])` is false; `notInArray(field, [])` is true.                                                                                                  |

Special-value comparison rules apply consistently across backends:

| Value or operation  | Rule                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NaN`               | Equality follows the agreed rule that `NaN` equals itself. Any ordering comparison involving `NaN` returns false.                                        |
| Infinities and zero | Infinities participate in numeric ordering normally. Positive and negative zero compare equally.                                                         |
| Invalid dates       | Use their `NaN` timestamps for date equality, so invalid dates compare equal to each other. Ordering comparisons involving an invalid date return false. |
| `BigInt`            | Preserve arbitrary precision for equality and ordering. Do not convert values to JavaScript numbers.                                                     |
| Strings             | Use the same case-sensitive, locale-independent Unicode code-point order as sorting for ordering comparisons.                                            |

Absence checks inspect prepared data before result projection. In the following table, each predicate targets `subtitle`:

| Prepared data             | `isMissing` | `isUndefined` | `isNull` |
| ------------------------- | ----------- | ------------- | -------- |
| `{}`                      | true        | true          | false    |
| `{ subtitle: undefined }` | false       | true          | false    |
| `{ subtitle: null }`      | false       | false         | true     |

`isMissing` checks whether the property is absent. `isUndefined` checks the value, including a missing property that reads as `undefined`. The [field-presence rules](#field-presence-and-undefined) still make an explicitly selected optional field present in the result, regardless of whether it was absent in prepared data.

Array predicates have the following edge-case behavior:

| Situation                               | Behavior                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `arrayContainsAny(field, [])`           | False for every existing array, including an empty array.                                                                   |
| `arrayContainsAll(field, [])`           | True for every existing array, including an empty array.                                                                    |
| Missing, undefined, or null array field | Membership predicates return false, including when the candidate list is empty.                                             |
| Array holes                             | Ignore holes during membership checks. An explicit `undefined` element remains a value and participates in equality checks. |
| Duplicate candidates                    | Duplicate candidates do not require duplicate elements; `arrayContainsAll` tests membership rather than multiplicity.       |

Rich values remain storable and selectable under the [data-value contract](#supported-data-values). Map/set-specific filters, binary or other rich-value filtering, regular-expression matching, and deep object equality are [future extensions](./TODO.md#future-extensions).

### Field presence and undefined

Status: agreed on October 17, 2026. These rules define the v1 implementation contract.

Explicitly requested fields remain present in returned objects. An optional field with no value produces an own property whose value is `undefined`; do not omit that property or convert it to `null`.

| Situation                                      | Returned object property        |
| ---------------------------------------------- | ------------------------------- |
| Selected optional field is missing in data     | Present with value `undefined`. |
| Selected field explicitly contains `undefined` | Present with value `undefined`. |
| Selected field explicitly contains `null`      | Present with value `null`.      |
| Field is not selected or otherwise requested   | Absent from the object.         |

Apply the same rules to selected fields on related entries. Relationship values retain their separately agreed cardinality semantics: an omitted optional singular reference returns `null`, and a many relationship with no matches returns `[]`.

Reflect presence in inferred types. Selecting an optional `subtitle` with string output produces a required result property typed as `subtitle: string | undefined`; if the schema also permits `null`, include `null` in that value union. The optionality of the value does not make an explicitly selected result key optional. Projection uses the requested field names and does not require enumerating every optional property from a validation schema.

Storage must round-trip explicitly present `undefined` properties separately from absent properties and explicit `null`. Do not normalize stored `undefined` properties to omission or null. A cached validated `undefined` result must not be mistaken for a cache miss. A future SQLite adapter must encode the promised distinctions, and generated artifacts must use an encoding that preserves them. Plain `JSON.stringify` alone does not satisfy this contract. Generated storage uses the agreed devalue encoding; the future SQLite representation remains backend implementation work.

Follow the [supported data-value contract](#supported-data-values) for the remaining value types and array behavior. Generated artifacts follow the [agreed encoding boundaries](#encoding-boundaries). Module embedding is private; the future SQLite representation remains backend implementation work.

### Returned value ownership

Status: returned query values and rendering metadata are detached from internal prepared state and caches, agreed on October 18, 2026.

Callers own the returned objects and can mutate them without changing stored content, another operation's results, or subsequent query/render behavior. Apply this to selected nested values, relationship results, and rendering metadata such as the headings array. `readBody()` returns an immutable string value and needs no additional ownership mechanism.

Clone selected entry graphs with the supported-value semantics: preserve native values, cycles, repeated references, array holes, and selected-property presence. Do not clone each selected field independently when that would break shared references within one returned entry graph. No object identity is promised across distinct entries, duplicate relationship positions, or independent operations. Do not expose internal values through cached result reuse. Plain JSON copying or an unsupported native clone path must not weaken the data-value contract. This requirement does not load unrequested body/rendering payloads.

### Explicit body access and built-in rendering

Status: `content.readBody(collection, id)`, Astro-style optional bodies, loader-supplied rendered HTML, headings with slugs, and per-operation revision consistency agreed on October 18, 2026. Preserve explicit field selection and framework-independent results. Public snapshot scopes are outside v1.

Use `.select(...)` for prepared source metadata and computed fields. Raw bodies, rendered HTML, and rendering metadata never appear implicitly on query results or through lazy getters. V1 query builders have no `.resolve(...)` method, including within `.with(...)` callbacks. Queries, including `.count()`, do not trigger rendering.

#### Raw-body access

```ts
const body = await content.readBody("posts", "getting-started");
// Inferred value: string | undefined
```

The operation accepts any registered collection name and a string entry ID and returns `Promise<string | undefined>`. Collection names remain type-checked; there is no body-capability restriction on which registered collections can be passed.

| Situation                                                      | Result                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Existing entry with retained text                              | Return its captured string without compilation or schema transformations.  |
| Existing entry with no body, or public body retention disabled | Return `undefined`.                                                        |
| Existing entry with an empty body                              | Return `""`.                                                               |
| Missing entry                                                  | Reject with `ContentError` code `entry-not-found`.                         |
| Invalid collection                                             | Reject with `ContentError` code `invalid-query`.                           |
| Backend I/O failure                                            | Reject with `artifact-error`, preserving the cause; do not return absence. |

Read prepared text through the backend without running loaders or reading original sources. Respect `retainBody: false` even when private compiler input is available for rendering. A valid `undefined` result is not a failed read or a missing-entry result.

Each call reads one prepared revision. Querying metadata and then reading a body are separate operations; they can observe different revisions during development. The body is returned as a value and is not attached to or used to mutate an earlier query result.

The runtime method takes collection/ID arguments. The computed resolver context’s existing `readBody()` helper takes no arguments and reads that preparation entry’s captured source text before public retention is applied. Both are asynchronous; neither compiles Markdown.

#### Rendering

The content runtime owns its backend and prepared collection registry and exposes rendering separately:

```ts
const { html, headings } = await content.render("posts", "getting-started");
```

```ts
type ContentRenderResult = {
  html: string;
  headings: { depth: number; slug: string; text: string }[];
};
```

The operation accepts a registered collection name and entry ID. It loads supplied/precompiled rendering output, or processes captured Markdown using the library-owned renderer according to [production rendering policy](#preparation-and-production-rendering). It returns framework-independent data; applications own HTML insertion and page components. Returning HTML instead of Astro’s `<Content />` is a deliberate adaptation. Runtime does not import user-supplied processing callbacks or field schemas.

Loader-provided `rendered.html` is usable independently of a raw body. This supports already rendered CMS content and custom build-time processing without making all raw strings implicitly Markdown. Missing heading metadata produces `headings: []`. The built-in renderer returns slugs matching its HTML heading IDs. Additional rendering metadata is outside v1 under the implementation defaults.

Rendering rejects invalid collection names with `invalid-query`, missing entries with `entry-not-found`, and existing entries without usable output or a supported rendering path with `not-renderable`. Failure to load a prepared payload is `artifact-error`; failure while compiling Markdown is `render-error`. Use the shared [error contract](#errors-and-diagnostics), preserving underlying causes. An absent raw body is independently a valid `undefined` value, not a missing-body error. A successful render includes HTML and headings from one revision. No per-output lazy projection or promise of headings-only parsing is made.

Each terminal query pins one consistent revision for selected parent and related data at execution start. Each body access/render operation likewise pins one revision at its start. Existing operations finish against that revision even when a new revision is published or later preparation fails; retain their required payloads until completion. Genuine I/O or rendering failures still reject. New operations use the latest published revision or reject with the current preparation failure. A metadata query followed by rendering is two operations and can observe different revisions during development; passing an ID does not pin the earlier revision. Production v1 uses immutable prepared content. A public `withSnapshot()` scope or cross-operation entry-handle lifetime is not part of v1; see [future notes](./TODO.md#lazy-source-bodies-and-cross-operation-snapshots).

Explicit `content.readBody(...)` and `content.render(...)` operations remain separate from selected query results. A caller needs neither operation for metadata queries, and rendering does not require calling `readBody()` first. Applications can process retrieved text in ordinary server functions with application-owned validation/caching; those functions are not extracted from `content-query.config`. This intentionally differs from Astro’s full-entry lookup while preserving its optional raw-body value semantics.

### Sorting and pagination

Status: agreed on October 17, 2026. These rules describe the redesign API, not the current implementation.

```ts
const posts = await content
  .query("posts")
  .select("id", "title")
  .orderBy("publishedAt", "desc")
  .orderBy("title", "asc")
  .limit(20)
  .offset(40)
  .all();
```

Sorting may use query fields that are absent from the selection. Raw bodies and rendering output cannot be used as sort fields.

| Concern                             | Rule                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sortable fields                     | Strings, numbers, `BigInt`, booleans, and dates. Reject arrays and other rich objects. Optional/nullable variants retain support; mixed scalar categories require normalization to a consistent base type.                                  |
| Sort direction                      | `"asc"` or `"desc"`. Numbers sort numerically, `BigInt` preserves arbitrary precision, booleans sort false before true in ascending order, and valid dates sort chronologically.                                                            |
| String ordering                     | Case-sensitive, locale-independent Unicode code-point order. Use the same ordering across backends rather than relying on environment defaults.                                                                                             |
| Special numeric and date values     | Sort `NaN` after ordinary numbers and infinities, and invalid dates after valid dates, in both directions. Both groups precede null, undefined, and missing values. Positive and negative zero are equal sort keys.                         |
| Null, undefined, and missing values | Sort last in both ascending and descending order. This rule concerns ordering; it does not make these states interchangeable elsewhere.                                                                                                     |
| Multiple sort fields                | Repeated `.orderBy(...)` calls add priorities in call order. Reject duplicate sort fields rather than replacing an earlier direction.                                                                                                       |
| Deterministic results               | Root and ordinary relationship queries default to ascending ID; forward ID-array references preserve authored order. Explicit sorting appends ascending ID as the final tie-breaker when ID is absent, preserving an explicit ID direction. |
| Pagination defaults                 | Omitted offset means `0`; omitted limit means unlimited. V1 supports `.limit(...)` and `.offset(...)`; cursor pagination is deferred.                                                                                                       |
| Pagination arguments                | Require nonnegative safe integers. `.limit(0)` produces an empty page. Reject invalid arguments instead of clamping them.                                                                                                                   |
| Repeated pagination calls           | Reject a second `.limit(...)` or `.offset(...)` call on the same query, even when the value is unchanged.                                                                                                                                   |
| Execution order                     | Apply filtering, sorting, offset, and limit in that order, regardless of method-call order. Load requested relationships for the returned entries.                                                                                          |

Row-returning terminal methods require explicit field selection:

| Method     | Result                                   | Pagination behavior                                                                |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `.all()`   | An ordinary array of selected entries.   | Return the requested page, including an empty array for `.limit(0)`.               |
| `.first()` | The first selected entry or `undefined`. | Respect offset and limit; `.limit(0)` produces `undefined`.                        |
| `.count()` | The number of matching parent entries.   | Count after filtering and before pagination, even when limit or offset is present. |

Counting does not require field selection, load related entries, or trigger rendering. Ordering and pagination do not affect the count, and `.count()` ignores `.with(...)` requests.

Deterministic ordering guarantees repeatable results for an unchanged content snapshot. Each query reads one consistent snapshot, but edits between queries can move entries between offset-based pages. Pagination does not pin later queries to an older revision.

### Relationship loading versus general joins

Status: relationship-loading approach agreed on October 17, 2026. The following describes the redesign API, not the current implementation.

Use **relationship loading** for requests such as "get posts with their authors." Declare the relationship once in the collection configuration, then explicitly request it with `.with(...)`:

```ts
const posts = await content
  .query("posts")
  .select("id", "title")
  .with("author", (author) => author.select("name"))
  .all();
```

Each result contains the selected post fields and a nested `author` object containing only the selected author fields. Neither the post nor the author receives an implicit `id` or any other unselected field. Relationship names and selected fields are typed from collection definitions.

Every requested relationship requires its own field selection. Related entries, their other relationships, bodies, and rendered output are never loaded implicitly. Further nested relationships require explicit requests at each level. Loading an author alone does not recursively load that author's posts.

Use one fluent query API at every depth. `.with(name, configure)` passes a builder scoped to the related collection to a synchronous configuration callback. The callback returns the configured builder and runs once while constructing the query, not once per parent entry. Use the same applicable `.select(...)`, `.where(...)`, `.orderBy(...)`, `.limit(...)`, `.offset(...)`, and `.with(...)` methods within it. Only the root builder exposes terminal methods such as `.all()`, `.first()`, and `.count()`; the relationship declaration determines whether nested results are singular or arrays. Nested relationship queries use this callback form rather than an options-object overload.

| Concern        | Relationship loading                                                    | General joins                                                                                    |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Request        | Load a named relationship declared in collection configuration.         | Combine collections using an explicit matching condition.                                        |
| API            | `.with("author", (author) => author.select("name"))`                    | SQL-style APIs such as `.innerJoin(...)` and `.leftJoin(...)`.                                   |
| Result         | Selected parent entries with nested selected related data.              | Rows formed by combining matching entries, with an explicit projection.                          |
| Parent entries | Enrich parent results without implicitly filtering or multiplying them. | An inner join can exclude unmatched parents; a one-to-many join can repeat a parent across rows. |
| Scope          | Part of v1's explicit relationship resolution.                          | A separate future capability, outside the agreed v1 scope.                                       |

The distinction concerns public query behavior. An in-memory or generated backend can resolve references through JavaScript lookups; a future SQLite backend may use SQL joins internally. The backend strategy must preserve the same result shape, explicit selection, and snapshot consistency.

Drizzle exposes both concepts: its [SQL query builder](https://orm.drizzle.team/docs/joins) uses `.innerJoin()` and `.leftJoin()`, while its [relational API](https://orm.drizzle.team/docs/rqb#include-relations) uses object configuration at both the root and nested `with` levels to load related data. This redesign uses fluent builders at both levels. Its `.with(...)` follows the relationship-loading concept and is an independent API.

The [relationship declaration model](#relationship-declarations) supports forward and inverse mappings and ID-array references. [Nested relationship queries](#nested-relationship-queries) define filtering and loading related data. [Integrity and optionality rules](#relationship-integrity-and-optionality) define missing-reference and singular-cardinality behavior. Reference ownership, source-derived optionality, and ID-array matching are specified above. Parent filtering through relationships, composite matching, and automatic linking-collection traversal are deferred beyond v1.

### Nested relationship queries

Status: fluent nested queries agreed on October 17, 2026; singular method restrictions, nullable filtered results, repeated-request rejection, and ID-array behavior agreed on October 18, 2026. This is a v1 design target, not the current implementation.

All nested builders support `.select(...)`, `.where(...)`, and `.with(...)`. Only many-relationship builders support `.orderBy(...)`, `.limit(...)`, and `.offset(...)`; singular builders reject these methods. Rendering remains a separate operation. Use the same fluent methods as the root query:

```ts
const authors = await content
  .query("authors")
  .select("id", "name")
  .with("posts", (posts) =>
    posts
      .select("title", "slug")
      .where((fields) => eq(fields.draft, false))
      .orderBy("publishedAt", "desc")
      .limit(5),
  )
  .all();
```

This requests up to five published posts per returned author. A filter inside `.with("posts", ...)` filters that author's nested posts; it does not remove authors with no matching posts. Parent filtering through relationships is deferred beyond v1.

Nested filtering, ordering, offset, and limit apply independently to each parent's related entries. Parent pagination happens before relationship loading. Related limits must not become one global limit across all parents. Reuse the root query's scalar sorting and pagination validation rules. Forward ID-array references preserve authored order and duplicates by default, as defined under [ID-array relationships](#id-array-relationships).

Return plain nested objects and arrays containing only explicitly requested fields. The selected parent data and related entries use one consistent content revision. Relationship cycles in the declarations do not cause automatic traversal: the query explicitly bounds which relationships are loaded.

The backend-independent query plan must support batched relationship lookup and per-parent processing. In-memory and generated backends can share the JavaScript executor; a future SQLite adapter must preserve the same semantics through its own query and index strategy. Delivery can proceed in layers while retaining this public model.

A nested filter that excludes a singular target produces `null` without removing the parent; include `null` in that selected relationship's inferred type. Do not throw a reference-integrity error for this query result. Underlying reference and cardinality validation still runs before filters. Reject repeated selections and duplicate same-name relationship requests within each builder scope.

Parent filters through relationships, composite matching, automatic linking-collection traversal, and general-purpose joins are outside v1. Explicit nested `.with(...)` requests can still traverse declared relationships through an entry or linking collection without an automatic `through` shorthand.

## Errors and diagnostics

Status: public `ContentError`, stable outcome codes, contextual diagnostics, preparation aggregation, synchronous/asynchronous failure timing, and development recovery agreed on October 18, 2026. These are redesign requirements, not current implementation behavior.

Use one public `ContentError` class for library failures. Its stable `code` supports application handling; its readable `message` supports developer diagnosis. Include collection, entry ID, source, field path, and operation when available. Preserve original validation issues and the underlying `cause`; do not reduce a provider's structured validation failures to a message alone. Human-readable wording is not the application's branching contract.

An individual validation diagnostic can describe:

```ts
{
  code: "validation-error",
  operation: "build",
  collection: "posts",
  id: "getting-started",
  source: "./content/posts/getting-started.md",
  path: ["publishedAt"],
  message: "Expected a valid date.",
}
```

This illustrates diagnostic content, not the final error constructor or an exact provider message. A field path points into the relevant source/computed value. Validation-provider issues remain available without losing their original path/detail structure. Context is optional when a failure occurs before an entry or field can be identified.

### Failure outcomes and timing

| Situation                                                                 | Public outcome                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Query matches nothing                                                     | `.all()` returns `[]`, `.first()` returns `undefined`, and `.count()` returns `0`.                 |
| Existing entry has no retained body                                       | `readBody()` returns `undefined`; retained empty text remains `""`.                                |
| Requested body/render entry does not exist                                | `ContentError` with `entry-not-found`.                                                             |
| Existing entry cannot be rendered                                         | `ContentError` with `not-renderable`.                                                              |
| Source cannot be read or parsed                                           | `ContentError` with `source-error`, preserving the cause.                                          |
| Metadata or computed result fails validation                              | `ContentError` with `validation-error`, preserving validation issues.                              |
| Duplicate entry ID                                                        | `ContentError` with `duplicate-id`.                                                                |
| Missing/ambiguous relationship target or invalid relationship cardinality | `ContentError` with `invalid-reference`, identifying the owning relationship and relevant targets. |
| Invalid query configuration or collection name                            | `ContentError` with `invalid-query`.                                                               |
| Prepared payload cannot be loaded or decoded                              | `ContentError` with `artifact-error`, preserving the cause.                                        |
| Markdown compilation fails                                                | `ContentError` with `render-error`, preserving the cause.                                          |

Ordinary query misses, optional body absence, and filtered-out singular relationships are values under their existing contracts, not library failures. A query miss may become an application-owned 404. Applications may likewise map `entry-not-found` from explicit body/render lookups to their routing behavior; the library does not assign HTTP status codes or routes.

Invalid synchronous builder calls throw as soon as the invalid configuration is detectable, for example a negative pagination value or a repeated selection. Failures discovered during asynchronous query execution, body access, rendering, or preparation reject the returned promise. The asynchronous body/render APIs also reject invalid arguments rather than changing their return contract. An I/O or compiler failure must not become an empty query result, an absent body, or a stale successful result.

### Preparation diagnostics

Collect independent diagnostics and report them together. Continue checking unrelated entries/fields when useful, while skipping checks whose prerequisite data is invalid. For example, an invalid source value prevents a computed resolver requiring validated source metadata from running, and a failed target collection load must not produce speculative dangling-reference diagnostics. Preserve each reported diagnostic's code, context, issues, and cause.

Reject the preparation attempt and publish nothing from it when any error remains. Do not expose a partial query index, manifest, or body/rendering revision. A production integration fails its build; one-shot API/CLI preparation fails and cleans up. A development watch session instead reports the failed attempt and keeps its subscriptions running, including when the first content attempt fails; its content operations reject until a valid revision is published. Previously published artifacts may remain internally available for recovery and already-started operations, but a failed preparation must not be treated as a successful build.

Use the conventional error declaration defaults below: an options-object constructor carrying the agreed code/message/context/issues/cause, with a `diagnostics` array for grouped preparation failures. Keep one public `ContentError` class. A grouped error uses its primary diagnostic's code and preserves all independent diagnostics; callers inspect the array for the full report. Exact TypeScript helper declarations are private implementation details within this contract. See [implementation defaults](#implementation-defaults).

### Development failure and recovery

When a source/configuration update fails preparation:

1. Surface the grouped failure through the integration's development error display.
2. Reject new content query executions and body/render operations with the current preparation failure. Do not serve the previous revision as successful current content.
3. Keep watching and allow correction without restarting the development server.
4. Publish a valid replacement revision atomically, clear the preparation failure, and resume normal reads automatically.

The previous valid revision may remain internally for recovery, reuse, and already-started operations. Its existence is not a public stale-read option for new operations. Completed results are not retroactively changed, and in-flight operations finish against their pinned revision. Only superseded preparation attempts are discarded. An isolated request-time render or artifact failure remains an operation failure rather than a new source-preparation revision.

## Execution lifecycle

Status: build-only configuration, the loader contract, source acquisition, computed-field preparation, revision consistency, explicit built-in rendering, source-independent production packaging, and the error/recovery contract agreed on October 18, 2026. The generated collection layout, codec, and implementation defaults are implemented; internal runtime initialization, revision/cache machinery, and detailed TypeScript helper declarations are private. Lazy source readers and public cross-operation snapshot scopes are outside v1.

### Source acquisition and processing boundary

Status: updated on October 18, 2026. Configuration and user-defined computed processing belong to preparation; deployed rendering uses library-owned code and prepared inputs.

| Stage              | Responsibility                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loaders            | Discover files, fetch remote content, gather additional dependencies, and supply revision-consistent inputs during development preparation/updates and production builds. |
| Computed resolvers | Derive query fields from validated loader-provided metadata and body access, validate them, and store the results before publishing a revision.                           |
| Built-in rendering | Use loader-supplied rendered HTML or compile captured Markdown according to policy; return HTML and headings with slugs through explicit calls.                           |
| Runtime backends   | Provide prepared query data, the collection manifest, captured inputs, and compiled outputs without acquiring original sources or importing configuration.                |

Computed resolvers receive source inputs through their context and must not discover source files or fetch fresh source content independently. This is an API contract, not a JavaScript sandbox or tracing mechanism.

If processing needs a snippet, template, or another source file, its acquisition belongs to the loader. Incorporate the contents into supplied `data` or `body` and keep them consistent with the entry revision. Additional dependency changes must enter the loader/integration invalidation path; reading a file does not automatically register it. Custom loaders register callbacks on the supplied development watcher and add any external source dependencies to it. V1 adds no separate public dependency-declaration API, managed `readInput()`, or generic dependency graph. Integrations keep their filesystem watcher wiring private.

Loaders capture body strings and any supplied rendered HTML during preparation; v1 has no source-reading body callbacks. The renderer may read packaged inputs lazily through a backend, but it must not invoke source loaders or depend on original paths. Live source loading is a [future extension](./TODO.md#live-collections-and-runtime-source-loading), not a reason to import v1 collection configuration during SSR.

### Loader lifecycle

Status: revised on October 18, 2026 to adopt Astro’s content loader API natively. Existing content collection loader packages are passed directly to `defineCollection({ loader })`; there is no adapter API. This supersedes the earlier public snapshot-returning `load()` and separate `watch()` contract.

```ts
type Loader = {
  name: string;
  schema?: unknown;
  createSchema?(): Promise<{ schema: unknown; types?: string }>;
  load(context: LoaderContext): Promise<void>;
};
```

`LoaderContext` provides Astro-compatible `collection`, `store`, `meta`, `logger`, `config`, `parseData()`, `generateDigest()`, `renderMarkdown()`, and optional development `watcher`. ContentQuery extends it with an optional load-attempt `signal`. The public context and loader types are defined without importing Astro. Compatibility tests pass loaders typed against Astro’s public API directly, including the published CSV loader.

The store supports `get`, `set`, `entries`, `values`, `keys`, `has`, `delete`, and `clear`. Entries carry `id`, `data`, optional `body`, `rendered`, `filePath`, and `digest`. `filePath` becomes the prepared diagnostic source. ContentQuery additionally accepts optional entry `source` metadata: `Loader<Source>` checks writes and informs computed resolver inference, while store reads keep the standard Astro-compatible shape and expose extra metadata as `unknown`. Astro's own store drops this extension. Built-in glob loaders provide project-relative `filePath` metadata; multi-record file loaders add the original record `key`. Resolvers receive independent detached metadata copies, and metadata participates in prepared-entry cache identity without entering deployed artifacts implicitly. `set()` replaces an entry unless its supplied digest matches the stored digest; digests must include source metadata used by computed fields. Deletion is explicit, and `clear()` starts a full replacement. Built-in loaders reject duplicate source IDs before writing their store. A custom loader’s repeated `set()` calls intentionally replace the same ID.

Collection schemas are optional. An explicit Standard Schema overrides a loader’s static `schema` or dynamic `createSchema()` default. Loader defaults support Standard Schema and legacy/core Zod. `parseData()` validates and transforms input during preparation; recognized parsed objects are not transformed again. Direct writes are still validated before publication. Explicit collection schemas retain precise field inference; dynamic loader schemas expose unknown named fields. The generated `types` source from a dynamic Astro schema factory is not evaluated or emitted.

Stores and string-valued `meta` are isolated by collection and preparation session. They survive source refreshes within the session and reset on configuration replacement or a cold build. Persistent build caching remains deferred. Portable filesystem configuration is supplied through `config`; a `loaderConfig` export beside `collections` can override or extend it. These settings do not run Astro integrations or change application routes. Access to an unavailable setting fails explicitly.

Core creates filesystem subscriptions before loading sources. Custom loaders register watcher callbacks and add external dependencies through `watcher.add()`. Loader-owned callbacks run in order; each asynchronous callback stages store and metadata mutations, then commits the complete batch. A failed callback discards its staged changes and reports the failure while retaining the watcher for correction. Filesystem edits can retry a failed initial load before the loader has installed its own listeners. Configuration replacement and shutdown remove owned listeners. Obsolete load attempts cannot publish even when source code ignores cancellation.

Completed loader stores are captured privately as immutable source snapshots. These snapshots are an implementation detail, not a second public loader API. Retain candidate snapshots when computed-field or cross-collection reference validation fails so corrections can recover against all accepted edits. Publish only a fully validated revision, with no partial store, computed, or relationship state visible to new operations. Existing pinned operations finish on their earlier revision.

Production preparation runs loaders without watchers. Deployed querying/rendering imports neither loaders nor configuration; it consumes prepared metadata and captured payloads. Live loaders, Astro integration hooks, component-module imports, optimized images, and Astro-specific deferred module rendering remain outside this contract. Unsupported module/image imports fail rather than silently producing incomplete output. `renderMarkdown()` uses the library’s portable pipeline and returns HTML/headings.

#### Astro loader compatibility

Status: native build-time content loader compatibility implemented on October 18, 2026; see [loader lifecycle](#loader-lifecycle). The previous proposal for an explicit adapter is superseded.

The loader contract, context helpers, default/dynamic schemas, stores, and watcher updates are native. The published CSV loader is tested directly, including typed consumers, live file edits, and deployed querying that forbids preparation dependencies. Remaining differences concern persistent metadata, generated dynamic schema declarations, full Astro configuration and integrations, image/module processing, live loaders, and Astro-specific rendering. These are documented limitations rather than a claim that every Astro integration can run.

### Preparation and production rendering

Status: agreed on October 18, 2026. This replaces the earlier generic deferred-resolution/materialization policy.

Preparation loads and validates source metadata, prepares computed fields, checks supported values and relationship integrity, and records the query data and collection manifest. Production uses those results without rerunning source loaders, source schemas, schema transforms, or computed functions.

For Markdown, the built-in `glob()` loader offers:

```ts
glob({
  pattern: "**/*.md",
  base: "./content/posts",
  retainBody: true,
  deferRender: false,
});
```

Compilation and loading are separate decisions. Keep publicly retained raw bodies, private compilation inputs, and rendered outputs outside the query index. Loader-provided rendered HTML is already prepared output and does not require the built-in Markdown compiler. Missing raw bodies do not prevent rendering when output is supplied. Rendering output is loaded explicitly even when compilation happened eagerly.

| Context                                        | Policy                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development                                    | Compile when rendering is requested; invalidate affected cache/preparation work on source/configuration changes. Already-started operations finish against their pinned revision.                                                                    |
| Pure SSG integration                           | Application page/endpoint rendering calls the same built-in renderer during the build. The integration can compile only the entries those pages request, avoiding a separate collection-wide pass.                                                   |
| Standalone production preparation              | Follow `deferRender` without assuming a deployment mode: eagerly compile all deployable Markdown when false; capture inputs and package the runtime renderer when true.                                                                              |
| Production SSR, `deferRender: false` (default) | Compile deployable Markdown entries during the build, including entries not visited by prerendering. Package their HTML/headings separately for lazy loading. Runtime does not need the Markdown compiler or its build-time processing dependencies. |
| Production SSR, `deferRender: true`            | Package captured raw text and the library-owned runtime renderer plus required dependencies. An explicit rendering request compiles an entry when reusable output is unavailable.                                                                    |

`deferRender` controls built-in Markdown compilation policy, not metadata validation, computed-field timing, source capture, or whether query results contain bodies. `retainBody` controls public raw-text retention separately; deferred compilation must still have its private captured input. It is not a general field-resolver switch. A deployment with both prerendered pages and SSR must support entries that prerendering never visited.

There is no public `target` option on preparation. Standalone production preparation uses the safe policy above. A pure SSG integration can use its host's build lifecycle to avoid the all-entry rendering pass; users do not classify their content instance as static or server-rendered. An integration that cannot establish a static-only lifecycle uses the standalone/SSR policy. This optional optimization is not a v1 guarantee; see [compilation policy without a public target](#compilation-policy-without-a-public-target).

Eager SSR compilation surfaces compilation errors during the build and avoids request-time compiler work. Deferred SSR compilation can avoid unused work, but first access may incur processing and surface an error not exercised by the build. Cached output can help, but reuse across processes, cold starts, builds, and prerender/SSR is not guaranteed until explicitly implemented.

The compiler and built-in renderer have known module boundaries controlled by the library. Generated rendering modules and serializable renderer settings can be packaged without importing `content-query.config` or serializing arbitrary functions. V1 does not accept generic config-resident runtime processing callbacks through this option. Runtime-defined plugin/callback packaging is not implicitly solved by naming a setting `deferRender`.

Keep generated artifacts and runtime inputs bound to the same prepared revision. A render result's HTML and headings must be consistent with each other. Separate query/render calls can observe different revisions under the [operation-consistency rules](#explicit-body-access-and-built-in-rendering); public cross-operation snapshot scopes are deferred beyond v1.

A static-only deployment need not ship the content query/rendering runtime. Module embedding, cache layout and invalidation machinery, and internal initialization signatures are private. Persistent cache reuse is not a v1 guarantee.

### Cooperative cancellation

The library creates signals for loader attempts, watch sessions, and computed resolvers. When preparation becomes obsolete, abort the relevant attempt and discard its results independently of whether user code cooperates. Loaders can forward signals to source operations; computed resolvers can check them between processing steps. There are no source-body reader callbacks in v1.

Built-in body loading and rendering finish against the revision pinned by their operation. Publishing a newer revision does not abort them or make their results obsolete for their original caller. Cache or publish reusable output only under the revision that produced it, never under a newer revision. Cancellation/discarding of superseded preparation work is separate from user operations already in flight. Cancellation does not forcibly interrupt synchronous JavaScript or Markdown compilation, and source-access permissions do not expand because an operation has a signal. V1 adds no caller-supplied cancellation option to `content.render(...)` or `content.readBody(...)`.

## Backends

Status: implemented for in-memory and generated storage. Backend meanings, eager query data versus separately loaded inputs, portable ESM packaging, backend selection, collection-grouped query indexes and entry payloads, and synchronous devalue encoding were agreed on October 18, 2026. Module embedding, internal exports, adapter initialization, and revision/cache machinery are private implementation details.

Use the agreed [in-memory, generated, and SQLite backend definitions](#1-keep-the-public-api-independent-of-the-backend) and [shared behavior requirements](#2-keep-backend-behavior-consistent).

### Eager query data and separate item inputs

Prepare identity, validated metadata, computed fields, and relationship integrity before publishing a queryable revision. Metadata queries use this prepared data without importing body or rendering payloads. Body-derived query fields deliberately incur preparation work.

Keep retained raw text, any private compiler inputs, and supplied/compiled HTML plus heading metadata separate from the query index. Explicit body access or built-in rendering loads the relevant item payload. Lazy payload loading does not make the query fields lazy and does not dictate when Markdown compilation runs.

This is a logical boundary, not a file or chunk per field guarantee. A per-item payload may load more than one property needs, and `.select(...)` controls returned properties rather than physical reads. Preserve the [supported data values](#supported-data-values), references within serialized values, and [field-presence rules](#field-presence-and-undefined) across storage boundaries.

### Portable production packaging

The generated backend emits ordinary ESM files for one prepared query index per collection, a serializable collection manifest, and separate body/rendering payloads for entries that need them. Group each collection's index and payload modules in its own directory, following the [generated collection layout and encoding](#generated-collection-layout-and-encoding). The manifest contains collection identities, query/runtime descriptors, relationship mappings, rendering capabilities, applicable serializable settings, and artifact/codec compatibility information. The public server entry is `<outDir>/server.js`, exporting `content`, with `./.content-query` as the default output directory. Private filenames, descriptor layout, module embedding, and internal export names can evolve without changing collection definitions or queries.

The generated server entry initializes the query/rendering runtime from those artifacts and library-owned runtime modules. It must not import `content-query.config` or original collection definition objects, even indirectly through a shared definitions module. Source loaders, validation schemas, computed functions, build-only dependencies, and their initialization stay in the preparation graph. Stored values are restored without reapplying validation transforms.

Keep type information through generated declarations or erased type-only references to configuration. A type dependency does not justify a runtime config import. One user-exported registry is enough; tooling derives the runtime registry from its prepared manifest rather than asking users to maintain it twice.

Use literal imports so the host bundler can discover generated payload and rendering modules. A collection's index maps logical entry IDs to its local payload importers, for example `() => import("./entries/a81f4c9e.js")`, using a shortened illustrative opaque key. Declaring the importer does not load the item. This is a module-loading registry, not the browser import-map feature. Its representation is not public query API; a backend may instead load directly from memory, files, or SQLite.

With eager production rendering, per-item output includes supplied/compiled HTML/headings and applicable lightweight rendering modules. Raw text is publicly available according to `retainBody`. Deferred Markdown compilation packages any required private captured text, the library-owned processor, and needed dependencies even if public text retention is disabled. Neither path extracts arbitrary callbacks from configuration, invokes source loaders during SSR, or depends on original source paths.

The host may rewrite paths and combine or split chunks; literal imports do not guarantee one deployed chunk per entry or remove every unused item from a bundle. A static-only deployment need not ship runtime query/rendering code.

### Generated collection layout and encoding

Status: one metadata index per collection, colocated lazy entry payloads, opaque payload keys, synchronous devalue encoding, and private layout/grouping controls agreed on October 18, 2026. The generated backend implements this layout.

Use this initial layout under the configured output directory:

```text
.content-query/
  package.json
  types.d.ts         # Vite integration only
  server.js
  server.d.ts
  manifest.js
  collections/
    posts/
      index.js
      entries/
        <payload-key>.js
        <payload-key>.js
    authors/
      index.js
```

The default `.content-query/` directory holds generated runtime artifacts and Vite's `types.d.ts` directly; there is no nested `generated/` directory. Vite emits the registry declaration for either backend, while an in-memory backend emits no runtime artifacts. Standalone in-memory preparation writes no files. A custom `outDir` relocates generated backend artifacts; Vite's declaration remains at `.content-query/types.d.ts`.

Each collection index contains the prepared query data for all its entries and references that collection's payload modules through literal dynamic import functions. Querying metadata does not invoke those importers. Keep captured public bodies, required private compiler inputs, and supplied/compiled HTML plus headings in the separate payload modules. A payload may contain both raw and rendered values; this is not a separate file or chunk per field guarantee.

Emit an additional entry file only when an entry has a body, rendering output, or private rendering input to package. Metadata-only entries are represented entirely in their collection index. In the living example, `authors` therefore has an index without an `entries/` directory; both posts have payload modules. Colocating indexes and payloads preserves their module loading boundary while making generated output easier to inspect.

Only the server entry and its inferred typing surface are public application imports. The illustrated collection/manifest filenames, payload keys, internal exports, and module grouping remain private. Keep collection directory mapping filesystem-safe without conflating distinct logical collection names. V1 exposes no public file-grouping, hash-algorithm, or chunk-size settings. Later grouping of small payloads must preserve the query/body/rendering contracts and be justified by measurements.

#### Encoding boundaries

Use devalue's built-in synchronous encoding within the existing [supported-value contract](#supported-data-values). Generated modules carry encoded data and restore it with library-owned runtime decoding. The exact ESM embedding and matching `parse`/`unflatten` wiring remain private implementation details. Importer functions are ordinary generated module code outside the serialized data; schemas, computed resolvers, source loaders, custom reducers/revivers, and arbitrary functions are not encoded as entry values.

Serialize each entry's complete query-data record together, including its identity, validated metadata, and computed fields. Preserve cycles and repeated references within that record. Do not promise object identity across different entries, separately encoded payloads, or independent query results. Bodies and rendering values have their own payload boundary and do not become part of the eager query record.

Round-trip the agreed native/special values, explicit `undefined`, absent keys, nulls, array holes, and references without applying schema transforms again. Selection still creates each requested result property, including `undefined` for an absent optional value. Encoding preserves stored presence; query projection implements the selected-property contract.

Record artifact-format and codec compatibility information in the prepared manifest. Coordinate the preparation writer and runtime reader. Incompatible artifacts reject with `artifact-error` and require regeneration, without falling back to source loaders during requests. Codec upgrades invalidate incompatible generated/cache data rather than assuming upstream format stability. See [devalue's documentation](https://github.com/sveltejs/devalue#stringify-and-parse) and [version-compatibility limits](https://github.com/sveltejs/devalue#non-goals).

In-memory storage keeps the prepared values directly while enforcing the same supported-value rules; it emits no backend content files. A future SQLite backend may choose its own physical encoding and indexes while preserving the same public value/query contracts.

#### Opaque keys and revision publication

Generate filesystem-safe payload keys from an unambiguous combination of collection identity, entry ID, and encoded payload content, such as `hash([collection, id, encodedPayload])`. Applications still address entries by their actual collection names and IDs. The key is internal file wiring, not a replacement public ID or route. Exact hash algorithm/length and collision handling remain implementation details; distinct payloads must not silently overwrite one another.

Changing a payload produces a new key; unchanged payload bytes can reuse their module. Regenerate affected collection indexes/manifests as needed, write only changed artifacts, and publish a complete validated revision atomically after its artifacts are ready. Keep older payloads available while active operations may still load them through an earlier revision's importers. A new generated watch session removes obsolete collection modules from previous runs after its first successful publication; startup errors delay cleanup until a valid publication. Later watch publications retain superseded modules for the rest of the session. One-shot preparation also removes generated collection modules the new revision does not reference. Output directories belong to one host, with earlier consumers stopped before starting a new session or one-shot build. Artifact publications are serialized so startup pruning cannot race a newer attempt's writes. Next.js additionally removes previous-run development runtime entries after its first valid publication while retaining the current entry; repeated configuration evaluation reuses the session without cleaning again. Cleanup and host invalidation mechanisms must preserve the existing per-operation consistency and failure/recovery rules; they do not introduce a public snapshot handle.

Per-entry payloads add generated files and bundler modules, while enabling individual payload loading and updates. The host bundler controls deployed chunks; a source file per entry does not guarantee a chunk per entry. No redesign performance benchmark has been measured.

### Backend storage and module delivery

Physical files and virtual modules are integration mechanisms, not interchangeable names for the storage backends. The generated backend owns collection indexes and applicable entry payload files even when a Vite integration wraps their access in virtual modules. The in-memory backend emits no content files or database; transferring its prepared state into a separately built SSR process requires explicit host embedding or another integration mechanism. Do not silently switch it to generated storage.

SQLite remains a future backend over the same prepared data, field semantics, body access, and built-in rendering contract. Neither the ESM packaging strategy nor a module registry should be required by its query executor.

### Generated files and virtual-module tradeoffs

Generated files add disk writes and reads during preparation and can trigger filesystem watchers. Virtual modules can supply code directly to a bundler and integrate module invalidation without writing that code to disk. Both still require the underlying source loading, validation, and computed-field preparation. Write only changed generated files and preserve atomic revision publication; precise reuse and invalidation mechanisms are private.

There is no inherent production query penalty from using physical generated source files. Equivalent module contents and bundler output can produce equivalent runtime behavior. Actual costs depend on data layout, loading, serialization, chunking, and caching; no performance comparison has been measured for this redesign.

## Integrations

Status: framework independence, portable generated modules, optional Vite virtual-module wiring, server/client boundaries, and an initial Vite integration for VoidPress are agreed on October 18, 2026. The preparation API/CLI, defaults, generated server entry, `contentQuery(...)` Vite plugin, `content-query:server` facade, preparation-session handle, and absence of a public `target` option are also agreed. Session/watch defaults are specified below and implemented. Detailed TypeScript helper declarations and internal host hooks are private.

Follow the [integration boundary](#10-keep-integrations-and-site-policy-outside-the-core) and [server/client boundary](#4-enforce-the-serverclient-boundary). Framework and bundler integrations connect content preparation, development update notifications, and the query runtime to the host application while keeping routes, rendering, and site policy application-owned.

### Build API and defaults

Expose `buildContent(...)` from `content-query/build` and the `content-query build` CLI command. Both run preparation independently of Vite. A host build finishes preparation before consuming the resulting modules. Ordinary ESM output is the portable integration path for other bundlers, including a future Next.js integration. Vite virtual module IDs and Vite plugin hooks must not become requirements of collection definitions, queries, or core execution.

Choose a backend per content instance, outside `defineCollection(...)`. Use the same backend in development and production unless explicitly configured otherwise; do not silently substitute in-memory storage during development.

The defaults below apply to standalone preparation. The Vite plugin defaults to `backend: "in-memory"` in both development and production: it serves prepared state through virtual modules and bundles the runtime data with the application. `contentQuery({ backend: "generated" })` additionally publishes standalone artifacts. Vite writes its registry declaration with either backend. The Next.js adapter retains generated storage by default.

| Setting                | Agreed API/default                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration          | Omit `config` to discover one root `content-query.config.{ts,mts,cts,js,mjs,cjs}`; an explicit `config` selects an exact path. Consumes the named `collections` registry.               |
| Backend                | `backend: "generated"`, configurable to `"in-memory"`; SQLite remains future work.                                                                                                     |
| Generated output       | `outDir: "./.content-query"`, configurable; applications Git-ignore the generated directory. This is generated-backend storage, not a requirement for in-memory storage to write files. |
| Public generated entry | `<outDir>/server.js` exports an initialized `content`, with accompanying types. Applications do not call `createContent()` or register collections again.                              |
| Deployment target      | No public `target` setting. Follow `deferRender` and the integration's lifecycle as described below.                                                                                   |

Paths in these examples are relative to the application project root. Standalone commands use the current working directory; integrations establish their host's project root. Generated output must be a dedicated directory that contains neither the application root nor collection configuration, including through symlinks.

The CLI, standalone API, and Vite integration share configuration discovery. Support `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, and `.cjs`, with `.ts` used in documentation examples. Accept both ES module and CommonJS exports of the named `collections` registry. When `config` is omitted, require exactly one matching root file: report a useful missing-config error when none exists and an ambiguity error listing the matches when several exist. An explicit `config` or `--config` bypasses discovery and is loaded as that exact path, without extension guessing or fallback. JSON, YAML, and JSX/TSX configuration files are not discovered. Generated declarations refer to the selected file, and Vite's client-import guards cover each supported config filename.

```ts
// scripts/build-content.ts — development/build code, not an SSR import.
import { buildContent } from "content-query/build";

await buildContent({
  config: "./content-query.config.ts",
  backend: "generated",
  outDir: "./.content-query",
});
```

The equivalent default CLI preparation and its development watch mode are:

```sh
vp exec content-query build
vp exec content-query build --watch
```

The first command performs one-shot production preparation. `--watch` owns a development session and follows development rendering/update behavior. CLI overrides are `--config`, `--backend`, and `--out-dir`, corresponding to the preparation options. Resolve their relative paths from the application project root; overriding the config location does not change that root. Reject unknown flags and invalid backend values. Standalone commands use their working directory as the project root; integrations use the host's resolved project root.

Programmatic preparation returns `ContentSession<Collections>` with a `content` runtime and `dispose(): Promise<void>` for owned-resource cleanup. Direct typed access uses `buildContent<Collections>(...)`; bind `Collections` to the exported registry through an erased type-only import. A config path is a runtime loading instruction and cannot itself infer collection types. When callers omit the registry generic, expose an empty registered-key type rather than an `any`-based query surface; preparation-only callers may still run the function and ignore its content handle. Generated server entries and Vite facades retain their generated registry typing without a caller-supplied generic. No executable runtime config import or second registry is introduced.

`watch` defaults to `false`. One-shot preparation returns a session only after successful preparation; failures reject and clean up. With `watch: true`, establish subscriptions before loading and return the session after the first content attempt settles, even if that attempt fails source reading or content validation. Such a session exposes the current `ContentError` through terminal queries and body/render operations, keeps watching, and recovers on a later valid revision; it does not wait indefinitely for the first valid content. The CLI's `--watch` follows the same error-display/recovery behavior instead of exiting on a recoverable content failure.

Fatal configuration/import or watch-subscription setup failures reject initialization and clean up resources already established, because no usable watch session can be returned. A returned watch session owns its subscriptions and stops them during `dispose()`. Integrations own and dispose their session rather than requiring application server code to manage it. This is a preparation lifecycle handle, not a public cross-operation snapshot scope.

### Prepared server entry

Server/build application code imports the generated entry:

```ts
// From an application module at the project root.
import { content } from "./.content-query/server.js";
```

`content` provides the agreed query, raw-body access, and built-in rendering APIs. The entry initializes it from prepared artifacts and library runtime modules only. Its types may use generated declarations or erased type-only config references; its executable imports must not reach `content-query.config`, loaders, source schemas, computed callbacks, or original collection definition objects. The public entry path/export are fixed by this contract; private runtime factory names and internal artifact wiring are not application setup APIs.

### Vite plugin and server facade

Expose the optional `contentQuery(...)` plugin from `content-query/vite`. It accepts the same configuration path, backend, and output directory settings as preparation:

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";
import { contentQuery } from "content-query/vite";

export default defineConfig({
  plugins: [
    contentQuery({
      config: "./content-query.config.ts",
      backend: "generated",
      outDir: "./.content-query",
    }),
  ],
});
```

These are the defaults; `plugins: [contentQuery()]` is sufficient for that setup. The plugin owns preparation and development watching, so the application does not separately run the preparation CLI or start a competing watcher.

Server/build application modules can import the initialized runtime through the Vite facade:

```ts
import { content } from "content-query:server";
```

| Backend     | Facade behavior                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated` | Re-export `content` from `<outDir>/server.js`. The backend still writes its collection indexes and applicable entry payloads; the virtual facade does not replace their storage.                                                                                                                            |
| `in-memory` | Expose prepared state through virtual modules without writing backend content files or a database. During a production application build, embed that state and required payload/rendering modules in the application's server bundle. Application bundle output is distinct from generated-backend storage. |

Changing the plugin's `backend` keeps the same facade import, collection definitions, query semantics, and rendering contract. Both paths preserve inferred types and initialize from prepared data and library runtime only. Deployed requests do not import configuration, loaders, source schemas, or computed functions.

The physical `<outDir>/server.js` import remains the portable generated-backend entry for standalone preparation and other bundlers. Vite apps may use it directly, but the virtual facade is the import that works across both backends. An in-memory setup does not provide a generated server file. The virtual ID, plugin API, and Vite lifecycle hooks belong to this integration; core collection, loader, preparation, and query APIs remain independent of them.

### Development and host lifecycle

The Vite plugin wraps the same preparation flow. In development:

1. Establish source watching before initial loading, following the [loader lifecycle](#loader-lifecycle). Do not serve successful content before a valid initial revision exists. While initial content is invalid, expose the current preparation failure rather than keeping content operations pending; keep the watch session available for recovery and disposal.
2. Process source and configuration updates through preparation, validate them, and publish valid revisions atomically. Discard obsolete attempts.
3. Notify the host to invalidate affected modules/pages. Display failed preparation and reject new content reads until a valid replacement revision is published, following [development recovery](#development-failure-and-recovery).
4. Dispose subscriptions on configuration reload and development-server shutdown. Reestablish watching when a new configuration takes over.

Configuration changes are detected from the configuration's evaluated module graph, including modules outside the application root. Editing an unrelated application module must not reload content, discard prepared work, or reload pages. A configuration that fails to load does not take over; its predecessor's subscriptions stay active, and watching remains conservative until a load succeeds.

During production builds, the plugin finishes preparation before application modules consume content and makes required payload imports discoverable to the bundler. It rejects direct or transitive client imports of both `content-query:server` and the physical generated server entry. A shared application module must not bypass this boundary by re-exporting either entry to client code. Build hooks, import-graph checks, and deployment tracing are integration-owned mechanisms.

Non-Vite integrations connect equivalent build ordering, development watching, runtime initialization, and server/client checks through their host's facilities. Generating valid ESM alone does not provide those lifecycle hooks or establish a tested framework integration.

Both delivery paths preserve the same query semantics, body-loading behavior, rendering contract, and source-independent SSR. The integration consumes `content-query.config` only during preparation and exposes a ready-to-use server runtime based on prepared artifacts. Its generated runtime graph excludes configuration, loader implementations, source schemas, and computed callbacks. It does not rely on a bundler inferring that selected object properties are build-only.

### Compilation policy without a public target

Standalone `buildContent(...)` and one-shot CLI preparation do not infer whether their output will be used for SSG, SSR, or both. They follow each Markdown loader's `deferRender`: `false` eagerly compiles every deployable Markdown entry, and `true` packages captured inputs and the library-owned runtime renderer. This safe default supports entries that a prerendering pass never visits.

A pure SSG integration may let page generation drive rendering instead of performing an all-entry compilation pass. It already owns the host lifecycle and must finish requested rendering before producing a static-only deployment. That optimization is an integration detail, not a second user-facing deployment setting. A generic Vite plugin cannot assume that a build is static merely because it uses Vite; absent a host-established static-only lifecycle, it uses the safe production policy. SSR and mixed integrations honor eager preparation for all deployable entries when `deferRender` is false.

The backend setting does not communicate deployment mode. Generated files and in-memory state can both support static generation or SSR when their host handles delivery appropriately. Development watch sessions compile on explicit rendering as agreed in the [rendering lifecycle](#preparation-and-production-rendering).

### In-memory preparation and remaining integration details

In-memory preparation exposes usable content through `ContentSession.content` in its preparation process without writing backend content files or a database. Crossing into a separately built SSR process requires explicit integration-owned prepared-state embedding or transfer. The Vite plugin supplies `content-query:server` and embeds prepared state in the production application bundle as described above; it must not import configuration during requests or silently switch to generated storage. Type-only registry declarations retain inferred collection types; runtime adapter initialization is private.

Internal runtime factory names, deployment tracing, cache machinery, and host build hooks are implementation choices under the defaults below. They do not require another public API discussion. Public cross-operation snapshot scopes are deferred beyond v1. Implementation must preserve the build-only configuration boundary rather than asking the deployed application to import definitions again.

## Implementation defaults

Status: implemented with these v1 defaults, agreed on October 18, 2026. Follow Astro's conventions where they fit the selected contracts. Our documented query behavior, Standard Schema support, build-only configuration, public-URL asset boundary, backend meanings, and portable runtime take precedence over framework-specific Astro mechanisms. Internal helper signatures and mechanisms remain private.

| Concern                   | Default for implementation                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Query fields              | TypeScript checks field names, eligible operators, and argument types. No complete runtime schema field catalog or duplicate field declarations. Keep runtime query-structure/argument checks and preparation validation.                                                                                                                                                                                                      |
| Public type names         | Use the names already illustrated here: `Loader`, `LoaderContext`, `DataEntry`, `DataStore`, `MetaStore`, `LoaderConfig`, `LoaderLogger`, `LoaderWatcher`, `ContentHeading`, `RenderedContent`, `ContentRenderResult`, and `ContentSession`. Keep detailed generic/helper declarations implementer-owned.                                                                                                                      |
| Preparation session       | `buildContent<Collections>(...)` returns `ContentSession<Collections>` with `content` and asynchronous `dispose()`. Direct access binds a type-only registry; an omitted generic has no registered query keys. `watch: false` returns only on success. `watch: true` returns after the first content attempt, including an error state, and keeps watching; fatal configuration/subscription setup errors reject and clean up. |
| CLI and paths             | CAC parses `build`, `--config`/`-c`, `--backend`, `--out-dir`/`-o`, and `--watch`/`-w`. Help/version requests skip configuration and building; values support equals syntax. Preserve generated/config/output defaults and project-root-relative paths. Reject unknown/repeated build options, missing values, unexpected arguments, and invalid backend choices. No public `target`.                                          |
| Errors                    | Keep one public `ContentError` with the agreed codes and context. Use an options-object constructor and a `diagnostics` array for grouped preparation failures, preserving individual issues and causes. Export the runtime error from `content-query/runtime`; detailed helper declarations are private.                                                                                                                       |
| Rendering result          | Keep the agreed HTML/headings contract. No additional processor frontmatter, arbitrary metadata passthrough, or asset-processing metadata in v1.                                                                                                                                                                                                                                                                               |
| Public cancellation       | No caller-provided signal option for body/render operations in v1. Cancel/discard superseded preparation work. Existing query/body/render operations finish against their pinned revision; never reuse their output under another revision.                                                                                                                                                                                    |
| Dependencies and watching | Use native loader-context watcher callbacks and private integration filesystem wiring. No new public dependency-declaration API, managed source-reader helper, or generic dependency graph.                                                                                                                                                                                                                                    |
| Source retries            | Core surfaces source failures without automatic retries. A custom loader may own retries before settling its load attempt and should honor cancellation. Development watching still recovers on a later valid update.                                                                                                                                                                                                          |
| Asset URLs                | Preserve authored public image/link destinations; applications own asset delivery. No source-relative asset acquisition, copying, optimization, or URL rewriting.                                                                                                                                                                                                                                                              |
| Caching                   | Keep cached values internal and revision-aware; return detached selected values and rendering metadata. Cross-process/build persistence or sharing is not a v1 guarantee; expose no new public cache settings. Private reuse can evolve without changing behavior.                                                                                                                                                             |
| Internal mechanics        | Hash choice, codec embedding, private module exports, query representation/indexes, and host hooks are implementer-owned choices. Retain candidate source state separately from published content, publish only complete valid revisions, and retain old payloads for pinned operations. Queue/coalescing and cleanup must preserve these rules.                                                                               |

These defaults close the routine API/scope questions. Implement the selected contracts without treating remaining helper signatures or private mechanisms as approval gates. Future extensions remain deferred and are tracked in [TODO.md](./TODO.md#future-extensions).

## Conformance scenarios

These cases belong in the redesigned implementation's shared tests. The shared conformance, lifecycle, generated-consumer, and Vite integration suites exercise this acceptance contract.

| Scenario                                 | Required outcome                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Direct typed preparation                 | A type-only registry generic gives `session.content` the correct collection names, selected result types, and operator eligibility. Invalid fields/collections fail type checking. Omitting the generic does not expose an `any` query surface. Generated/facade imports retain their existing inferred types.                             |
| Invalid initial watch content            | After successful configuration/subscription setup, `watch: true` returns a disposable session after the initial failed content attempt. New content operations reject with its contextual preparation error. Correcting content publishes a valid revision and the same session recovers. The CLI watch process stays alive.               |
| One-shot or fatal initialization failure | One-shot content failures reject and release owned resources. Configuration/import or subscription setup failures reject even in watch mode and clean up already-established resources.                                                                                                                                                    |
| Publication during a query/read/render   | Start an operation on revision A, publish B, and complete the original operation against A without cancellation or mixed values. New operations use B. If newer preparation fails, previously started operations may still finish on A; new operations reject with that failure. Genuine operation failures keep their normal error codes. |
| Deferred payload retention               | An active operation on A can still load A's payload after B is published. Release old artifacts only when no pinned operation needs them; do not cache A's rendered output as B.                                                                                                                                                           |
| Cross-collection correction              | A post deletion initially fails because an author still references it. Retain that deletion and any accompanying post edits in candidate state. Removing the author's references later publishes both collections atomically without repeating the deletion batch or resurrecting the deleted post.                                        |
| Malformed updates                        | Duplicate upserts or overlapping upsert/remove IDs reject without modifying candidate or published state. Subsequent well-formed updates still recover normally.                                                                                                                                                                           |
| Returned-value isolation                 | Mutating a selected array/object, `Date`, `Map`, `Set`, binary view, or returned headings cannot alter prepared data, cached output, another operation's results, or subsequent operations. Preserve supported types, cycles, shared references within an entry graph, array holes, and selected own properties.                           |
| Unrelated application edit               | Editing an application module outside the configuration's evaluated module graph publishes no revision. Editing a module the configuration imports, inside or outside the root, reloads it.                                                                                                                                                |
| Snapshot request beside bad batch        | An `invalidate()` coalesced with a malformed batch is not lost: the next accepted update loads the fresh snapshot rather than republishing stale candidates.                                                                                                                                                                               |
| Unrelated file beside a glob             | Adding or editing a file no pattern can match, such as an image or editor swap file, publishes no revision. Adding a matching file publishes one.                                                                                                                                                                                          |
| Multiple invalid references              | Every dangling or ambiguous reference appears in one failure, with its value. Relationships touching a collection that failed validation are skipped rather than reported as dangling.                                                                                                                                                     |
| Superseded generated modules             | One-shot preparation removes collection modules its revision no longer references and keeps unrelated files. Watch sessions retain superseded modules for pinned operations.                                                                                                                                                               |
| Rendering collection names               | Every registered collection is accepted by the typed render API. An existing entry without supplied output or a supported rendering path rejects with `not-renderable`, as in the authors fixture.                                                                                                                                         |

## Approved query and authoring additions

Status: implemented October 18, 2026. These additions preserve the original loader, projection, runtime, and backend contracts. The [package guide](../packages/content-query/README.md#object-queries-and-adjacent-entries) contains complete callsites and the [TODO list](./TODO.md) tracks outstanding work and future design notes.

- `defineCollection({ source: "./content/posts", schema })` is shorthand for the built-in Markdown glob loader. Explicit source objects require `type` (`markdown`, `json`, `yaml`, or `toml`) and `directory`; optional include patterns and body/ID policies reuse glob behavior. `source` and `loader` are mutually exclusive.
- `content.findMany`, `findFirst`, and `count` accept object options. Their compiler and fluent builders share checked clauses, expression operators, normalized plans, and the pinned-revision executor. Relationships remain explicitly selected; a relationship-only projection also counts as selection in both APIs. Singular scopes cannot order or paginate. `findFirst` returns `undefined`; count operates before pagination. Conformance tests compare plan structure and results across both backends and type-check equivalent consumer projections.
- `select: { _adjacent: true }` and `.selectAdjacent()` add `{ previous: { id } | null, next: { id } | null }`. Shorthand uses the current scope's filters and stable order before pagination. Explicit `{ where?, orderBy?, select }` defines an independent sibling scope over the same collection; the fluent callback and options overload provide the same behavior. Each neighbor is projected from the same revision, boundaries and excluded current entries yield `null`, and siblings cannot paginate or select adjacency recursively. Authored relationship array order is retained in shorthand, with duplicate IDs treated as one neighbor position. `_adjacent` is reserved in metadata, computed fields, and relationships.
- Generated `server.d.ts` and `types.d.ts` export `CollectionKey`, `CollectionData<Name>`, and `Collections` (a map of collection data types). Type-only config references preserve inference; executable runtime code never imports configuration. Vite always writes its facade declarations to `.content-query/types.d.ts`; generated standalone preparation writes declarations beside its server entry. Apps include generated declarations in TypeScript and remove handwritten ambient duplicates.
- Vite's server facade is `content-query:server`. The browser-safe `content-query:client` module exports `onContentUpdate`, serializes revalidation callbacks, coalesces edits, cleans up subscriptions, and becomes a production no-op. Successful publication updates server modules before notifying clients. Subscribed routers refresh their data; clients without a bridge retain full-document reload fallback. Void's root bridge flushes cached data and refreshes with preserved state/scroll. Production compiler servers with watching disabled do not start content watchers. Runtime Markdown dependencies are optimized before initial server rendering to avoid optimizer-induced reloads.
- Real Void, React Router, TanStack Start, Next.js, and SvelteKit examples retain framework-owned routes, data loading, metadata, and HTML. Production integration tests exercise metadata-only indexes, rendered details, selected neighbors, nested routes, and source-independent output. Next.js uses `withContentQuery()` from `content-query/next`: one deduplicated development session publishes generated ESM for Next HMR, including body-only edits and recoverable error entries; production awaits a successful one-shot build and disposes it before compilation.

Link/route/publication policy remains application-owned.

## Living end-to-end example

Keep this example synchronized as decisions change. Update collection definitions, source content, queries, returned values, and execution notes together so they continue to describe the same API.

Status: v1 reference example, covered by consumer and conformance tests. `tests/integration/living-example.test.ts` asserts its documented values against both backends. Build-only configuration, Standard Schema validation, field/value/presence contracts, computed fields, the native named `load(context)`/store loader contract, optional captured bodies and supplied HTML, relationships, prepared runtime initialization, built-in Markdown rendering, and `deferRender` follow the agreed design. Built-in sources now use Astro-style `glob()`/`file()` options, slug-based default IDs, and JSON/YAML/TOML parsing. `buildContent` from `content-query/build`, the preparation CLI, generated-backend defaults, and `.content-query/server.js` exporting `content` are agreed. The optional `contentQuery(...)` plugin from `content-query/vite` and `content-query:server` facade work with either backend; Vite embeds in-memory state in its production server bundle. Standalone typed access binds `buildContent<Collections>` and `ContentSession<Collections>` through the registry type; sessions expose `content` and asynchronous `dispose()`, with `watch: false` by default. Watch startup can return an error-state session that recovers after correction. Applications own public asset URLs; asset packaging and URL rewriting are outside the library. There is no public `target` option. The public `ContentError` contract, diagnostic codes, grouped preparation failures, and automatic development recovery are agreed. Collection-grouped query indexes, colocated lazy entry payloads when needed, opaque keys, and synchronous devalue encoding follow the agreed generated storage design. The implementation defaults fix HTML/headings-only rendering, the conventional error/report shape, and routine session/CLI choices. Private module embedding/exports, adapter factories, and detailed helper declarations remain implementation details. Relationship ownership, optionality, singular filtering, and ID-array semantics follow the agreed rules. Raw-body access uses the agreed `content.readBody(collection, id)` operation. Lazy source readers and public snapshot scopes are outside v1. Zod is one example schema provider. Generic deferred field resolvers and `.resolve(...)` are outside v1.

### Define the collections

The example follows Astro's built-in loader APIs and default identity generation: `glob()` slugifies the Markdown filenames into `getting-started` and `upcoming-features`; `file()` uses each author's explicit ID. These lowercase, hyphenated fixture names keep the same IDs and query results. Both loaders implement native asynchronous `load(context)` and write validated entries to the collection store. Development filesystem watching is established before loading. Built-in sources use private dependency subscriptions; custom loaders register callbacks on `context.watcher`. Completed store changes pass through preparation before publication.

Keep all source loading, schemas, and computed functions in build-only `content-query.config.ts`. Export one registry, with each loader present at the collection-definition inference boundary:

```ts
// content-query.config.ts — development/build preparation only.
import { z } from "zod";
import { defineCollection } from "content-query";
import { file, glob } from "content-query/loaders";

const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: z.object({
    name: z.string().min(1),
    featuredPostIds: z.array(z.string()).default([]),
  }),
  relationships: {
    posts: {
      collection: "posts",
      type: "many",
      from: "id",
      to: "authorId",
      referenceSide: "to",
    },
    featuredPosts: {
      collection: "posts",
      type: "many",
      from: "featuredPostIds",
      to: "id",
      referenceSide: "from",
    },
  },
});

const posts = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./content/posts",
    retainBody: true, // Default: retain publicly accessible raw text.
    deferRender: false, // Default: eager compilation for production SSR.
  }),
  schema: z.object({
    title: z.string().min(1),
    subtitle: z.string().nullable().optional(),
    locale: z.string(),
    authorId: z.string(),
    publishedAt: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
  relationships: {
    author: {
      collection: "authors",
      type: "one",
      from: "authorId",
      to: "id",
      referenceSide: "from",
    },
  },
  computed: {
    slug: {
      schema: z.string(),
      resolve: ({ id }) => id,
    },
  },
});

export const collections = { authors, posts };
```

The computed slug matches this application's URL naming; the library does not assign routes. Source fields, computed `slug`, and relationship names remain distinct, with `id` reserved for entry identity. These fixtures have no raw `slug` override. Astro-style defaults also make `Guides/index.md` become `guides` and honor a raw frontmatter `slug` before validation; a custom `generateId({ entry, base, data })` can replace that generation. Changing an ID still requires its references to remain valid. HTML/headings are separate rendering output, not collection fields or custom result schemas. Headings include slugs matching the rendered HTML IDs.

Relationship targets use registered names, so definitions do not need cyclic variable references. Preparation validates those mappings against the complete registry and records their runtime descriptors. [Zod coercion](https://zod.dev/api) normalizes the date/defaulted boolean through Standard Schema. A different provider can supply equivalent schemas without changing queries; the schema objects and functions remain on the preparation side.

### Prepare once and expose the server runtime

The build command or integration consumes the single exported registry. For the generated backend, it runs loaders/validation/computed fields and emits per-collection query indexes, the collection manifest, captured bodies, and applicable compiled output. It then wires a server entry from prepared artifacts and library runtime modules.

For standalone preparation, run this script from the application project root before the application build consumes the generated modules:

```ts
// scripts/build-content.ts — build code only.
import { buildContent } from "content-query/build";

await buildContent({
  config: "./content-query.config.ts",
  backend: "generated",
  outDir: "./.content-query",
});
```

This explicitly selects the example's `content-query.config.ts`. Omitting `config`, as `vp exec content-query build` does, discovers that file or a single alternative using `.mts`, `.cts`, `.js`, `.mjs`, or `.cjs`. Multiple matching files require an explicit selection. Generated declarations reference the selected config. `vp exec content-query build --watch` owns a development watch session. Git-ignore `.content-query/`. A framework integration wraps the same flow and watching, so its users do not additionally run these commands. Choose a backend outside the collection definitions; generated storage is the default in both development and production.

There is no `target` argument. In this standalone example, `deferRender: false` prepares HTML/headings for both posts before production use. A pure SSG integration may instead render just the entries requested during page generation, using its host lifecycle to avoid a collection-wide compilation pass. Changing to `deferRender: true` packages captured input and the library-owned renderer for on-demand compilation.

Application server code imports the prepared entry, not `content-query.config.ts`, `posts`, `authors`, or a shared schema/field definition module. There is no second user-maintained collection registry or mandatory `content.runtime.ts`:

```ts
// From an application module at the project root; generated server entry.
import { content } from "./.content-query/server.js";
```

`content` is the initialized query/rendering runtime for the prepared collections. Its production dependency graph is generated data/manifest, body/rendering modules, and library runtime code. The types can refer to configuration through erased type-only imports, without importing it at execution time.

Application code does not call `createContent()` or repeat the collection registry. The generated directory is configurable, and the entry remains `server.js` exporting `content` within it. Direct programmatic use obtains the initialized runtime through `session.content` and disposes owned resources through `session.dispose()`. An in-memory backend exposes prepared content in-process without content files; its integration supplies an equivalent server facade and explicitly embeds/transfers prepared state when crossing processes. Private adapter APIs are implementation choices. Generated output is not a requirement to write files for every backend.

For direct in-process use, this is an alternative to the generated server import or Vite plugin setup:

```ts
import { buildContent } from "content-query/build";
import type { collections } from "./content-query.config";

const session = await buildContent<typeof collections>({
  config: "./content-query.config.ts",
  backend: "in-memory",
});

try {
  const summaries = await session.content.query("posts").select("id", "title").all();
  // Use the same prepared fixtures and query behavior without backend content files.
} finally {
  await session.dispose();
}
```

This uses the default `watch: false`, so initial preparation must succeed before the call returns. The type-only registry import is erased and binds `session.content` without a second runtime registry or executable config import; the config path alone cannot provide those TypeScript types. A long-running development integration can set `watch: true` and dispose its session at shutdown. After subscription setup, that mode returns a session even when the first content attempt fails. It is not a second watcher to add alongside the Vite plugin.

For an independent startup-failure scenario, begin with an empty post title. A watch session returns in the preparation-error state and its query/body/render operations reject. Correct the title through the watched source; the same session publishes the valid content and recovers. The handle remains disposable during the failure. One-shot preparation instead rejects and cleans up; neither scenario changes the valid fixtures below.

### Use the Vite integration

For a Vite application, use the plugin instead of the standalone preparation script/CLI:

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";
import { contentQuery } from "content-query/vite";

export default defineConfig({
  plugins: [contentQuery()],
});
```

This discovers the example's `./content-query.config.ts` using the same six-extension policy, and uses the generated backend and `./.content-query`. The plugin prepares content before consuming application modules, owns the development watcher, publishes valid updates atomically, and manages invalidation, preparation errors, recovery, and cleanup. It follows the same `deferRender` policy; generic Vite setup alone does not establish a pure SSG lifecycle.

Application server code uses the facade, which re-exports the generated runtime with these defaults:

```ts
import { content } from "content-query:server";
```

To use in-memory storage, change only the plugin call to `contentQuery({ backend: "in-memory" })`. The collection definitions and facade import stay the same. That backend creates no content files or database; Vite supplies prepared state through virtual modules in development and embeds it in the server bundle during the production application build. Neither backend imports `content-query.config` during deployed requests. The plugin rejects direct and transitive client imports through either the facade or the physical generated server entry.

The remaining queries in this example use the Vite facade. For standalone generated preparation or another bundler, use the earlier `./.content-query/server.js` import with the same query/body/render calls. There is no second runtime registry or application `createContent()` call in either setup.

### Example source content

If this example's Markdown includes `![Diagram](/images/diagram.png)`, the rendered image keeps `/images/diagram.png` as its URL. The application serves that public URL; content preparation does not read, copy, optimize, or package the image. The existing source fixtures and returned values below remain unchanged.

`content/authors.json` contains two authors:

```json
[
  { "id": "ada", "name": "Ada Lovelace" },
  {
    "id": "grace",
    "name": "Grace Hopper",
    "featuredPostIds": ["upcoming-features", "getting-started", "upcoming-features"]
  }
]
```

Grace has no authored posts, but she curates a separate ordered list of featured post IDs. Its duplicate is deliberate. Ada omits `featuredPostIds`, so the author schema defaults it to `[]`. `file()` extracts each transport `id` into entry identity before metadata validation. The same records could use ID-keyed JSON, YAML, or TOML with the corresponding filename/parser; these alternatives do not change the fixtures or query results. A custom synchronous or asynchronous `parser` can extract the records from a nested document.

The first file, `getting-started.md`, omits `draft` so the source schema supplies `false`:

```md
---
title: Getting started
locale: en
authorId: ada
publishedAt: "2026-10-17T00:00:00.000Z"
---

# Getting started

Welcome to **VoidPress**.

## Installation

Add your content.
```

The second file, `upcoming-features.md`, is a draft:

```md
---
title: Upcoming features
subtitle: null
locale: en
authorId: ada
publishedAt: "2026-10-18T00:00:00.000Z"
draft: true
---

# Upcoming features

Work in progress.
```

### Loader entry boundary

For `getting-started.md`, the Markdown loader supplies the following entry before schema validation and computed-field preparation:

```ts
const loadedPost = {
  id: "getting-started",
  source: "content/posts/getting-started.md",
  data: {
    title: "Getting started",
    locale: "en",
    authorId: "ada",
    publishedAt: "2026-10-17T00:00:00.000Z",
  },
  body: "# Getting started\n\nWelcome to **VoidPress**.\n\n## Installation\n\nAdd your content.\n",
};
```

Core validates `data`, converts `publishedAt` to a date, defaults `draft` to `false`, and computes `slug`. The raw body stays outside prepared query fields, and `source` provides diagnostic context without becoming a metadata field or registering a watched dependency. This loader retains the body from the same file read that extracted frontmatter. Computed preparation or built-in rendering can access that revision's text when needed. No Markdown compilation is needed to produce this loader entry.

If this post needs a snippet from another file, the Markdown or a custom loader must acquire it and incorporate its contents into the supplied body or data. Its update path must account for changes to that dependency. The built-in renderer processes the captured text and does not call `readFile()` on the snippet's original path.

The JSON loader supplies author entries such as `{ id: "ada", data: { name: "Ada Lovelace" }, source: "content/authors.json" }`, with no raw body. Its raw-body value is `undefined`, with no missing-body error or special collection type. Loaders supply captured strings rather than body-reader callbacks. Compilation is a separate stage governed by `deferRender` and deployment mode; public raw-text availability follows `retainBody`. SSR loads packaged inputs or supplied/compiled output through the backend, without source callbacks or loader imports.

For an independent development-update scenario, suppose the getting-started title changes and the draft is deleted. A loader's `watch` callback can submit the following batch using its context's `update` function; an integration can submit equivalent filesystem updates:

```ts
update({
  upsert: [
    {
      ...loadedPost,
      data: {
        ...loadedPost.data,
        title: "Getting started with VoidPress",
      },
    },
  ],
  remove: ["upcoming-features"],
});
```

The upsert replaces the complete loader entry, not just its title. Here its body remains unchanged. Core stages the batch and checks relationships. In these fixtures, Grace's `featuredPostIds` still references `upcoming-features`, so deleting that post fails integrity validation with `invalid-reference`, identifying the owning `authors` entry `grace`, its `featuredPosts` relationship, the source field `featuredPostIds`, and the missing post. No partial replacement/deletion revision is published. Retain the title edit and draft deletion in candidate source state while new content executions reject with the preparation failure. Remove every reference to the deleted post from Grace's source data; the next valid candidate revision atomically publishes that author correction together with the retained title edit and deletion. Do not require resending the posts batch or restore the deleted post from the last published revision. No cross-collection batch API is implied by this example.

For a valid batch, core validates and prepares affected data and invalidates affected rendering work before atomic publication. If only an unspecified change is known, call `invalidate()` and reload the snapshot. These callbacks report work rather than mutate existing query results. Queries and production packaging below use the original valid fixtures, without applying the independent update scenario.

### Query a listing through the prepared runtime

Use the server entry produced by preparation or the host integration. It already knows the collection names and backend through prepared data/manifest; application code does not register `posts` and `authors` again. The Vite facade below works with either backend. Standalone generated preparation uses the physical server entry shown earlier, with the same query behavior.

```ts
import { and, eq, gte, isNull, isUndefined, or } from "content-query/query";
import { content } from "content-query:server";

const summaries = await content
  .query("posts")
  .where((fields) => and(eq(fields.locale, "en"), eq(fields.draft, false)))
  .where((fields) => gte(fields.publishedAt, new Date("2026-10-01T00:00:00.000Z")))
  .select("id", "title", "slug")
  .orderBy("publishedAt", "desc")
  .limit(10)
  .all();
```

The inferred type is `{ id: string; title: string; slug: string }[]`, and the returned value is:

```ts
[
  {
    id: "getting-started",
    title: "Getting started",
    slug: "getting-started",
  },
];
```

The filters combine with AND and exclude the draft. The date comparison uses timestamps and admits posts published on or after October 1, 2026 UTC. `locale`, `draft`, and `publishedAt` influence matching or ordering but are absent from the result. `subtitle` is also absent because it was not selected. This query does not compile Markdown or load raw/rendered body payloads. In this example the computed slug also does not read the body.

### Branch from a shared query

Reuse a published-posts query to construct independent locale-specific queries:

```ts
const publishedPosts = content.query("posts").where((fields) => eq(fields.draft, false));

const englishPosts = publishedPosts.where((fields) => eq(fields.locale, "en"));
const frenchPosts = publishedPosts.where((fields) => eq(fields.locale, "fr"));

const englishTitles = await englishPosts.select("id", "title").all();
const frenchTitles = await frenchPosts.select("id", "title").all();

// With the content fixtures above:
// englishTitles: [{ id: "getting-started", title: "Getting started" }]
// frenchTitles: []
```

Each branch combines its locale condition with the base publication condition. `publishedPosts` retains only its publication filter, and constructing `frenchPosts` does not add a French locale filter to `englishPosts`. Every configuration method returns a new builder, so these branches do not need an explicit clone operation.

### Select optional fields

The getting-started post omits `subtitle`; the upcoming-features post explicitly sets it to `null`. Selecting that field makes the key present on both results:

```ts
const subtitles = await content
  .query("posts")
  .where((fields) => eq(fields.locale, "en"))
  .where((fields) => or(isUndefined(fields.subtitle), isNull(fields.subtitle)))
  .select("id", "subtitle")
  .all();

// Each result has this inferred type:
type Subtitle = {
  id: string;
  subtitle: string | null | undefined;
};

// Expected value, in the default ascending ID order:
[
  { id: "getting-started", subtitle: undefined },
  { id: "upcoming-features", subtitle: null },
];

subtitles.map((post) => Object.hasOwn(post, "subtitle")); // [true, true]
```

The two `.where(...)` calls combine with AND: entries must use locale `en` and have an undefined or null subtitle. Both fixtures match. This query includes the draft because it has no publication filter. Both objects own their selected `subtitle` key, and the inferred key is required even though its value can be `undefined`. Returning the same selection through generated or SQLite storage must preserve these values and property presence.

TypeScript accepts `subtitle` even if every source entry omits it and rejects a misspelled `.select("subtitel")`. If that typo bypasses TypeScript, runtime reads a missing property and returns selected `subtitel: undefined` rather than claiming to know the complete schema field list. An empty `posts` collection still produces `[]`. This illustrates the agreed field-check boundary without changing the valid fixture queries above.

### Read retained raw text

Only request raw text when the application needs to process it. The original Markdown fixture uses `retainBody: true`:

```ts
const rawMarkdown = await content.readBody("posts", "getting-started");
// string | undefined; for this fixture, the captured Markdown string.
rawMarkdown?.startsWith("# Getting started"); // true

const authorBody = await content.readBody("authors", "ada");
// undefined: Ada exists, but the JSON author entry has no body.
```

Both collection names are valid regardless of whether their entries have bodies. The Markdown text excludes frontmatter because that is the body captured by this loader. No Markdown compilation, source fetch, or schema transformation occurs. These calls do not add a `body` property to earlier query results.

Changing the Markdown loader to `retainBody: false` makes the first call return `undefined`; an empty retained body would instead return `""`. Calling `content.readBody("posts", "missing-post")` rejects with `ContentError` code `entry-not-found`. Each call uses its own prepared revision, with no v1 cross-operation snapshot scope.

### Look up and render a page

A server-side route can query the application's slug/locale and explicitly select its metadata:

```ts
const post = await content
  .query("posts")
  .where((fields) =>
    and(eq(fields.slug, "getting-started"), eq(fields.locale, "en"), eq(fields.draft, false)),
  )
  .select("id", "title", "publishedAt")
  .first();

if (post === undefined) {
  throw new Error("Post not found"); // Application-owned 404 handling.
}

const { html, headings } = await content.render("posts", post.id);
```

The selected `post` type is `{ id: string; title: string; publishedAt: Date }`. Its date represents `2026-10-17T00:00:00.000Z`. The separate render result has the library-defined type:

```ts
type ContentRenderResult = {
  html: string;
  headings: { depth: number; slug: string; text: string }[];
};
```

`html` contains:

```html
<h1 id="getting-started">Getting started</h1>
<p>Welcome to <strong>VoidPress</strong>.</p>
<h2 id="installation">Installation</h2>
<p>Add your content.</p>
```

`headings` contains:

```ts
[
  { depth: 1, slug: "getting-started", text: "Getting started" },
  { depth: 2, slug: "installation", text: "Installation" },
];
```

The query prepares no rendering output. In production SSR with the example's default `deferRender: false`, `content.render(...)` loads HTML/headings compiled during the build. In development and pure SSG it can compile when requested. To opt into production request-time compilation, change only the loader option:

```ts
loader: glob({
  pattern: "**/*.md",
  base: "./content/posts",
  deferRender: true,
}),
```

The same render call then uses captured text and the library-owned renderer when no reusable result is available. It never reads original source files or imports configuration. This is built-in Markdown processing, not a generic runtime callback from the collection definition.

Rendered values are not added to `post`, cannot be filtered or sorted as implicit query fields, and do not require user-supplied result schemas. The application owns HTML insertion and decides what selected/rendered data to pass to a client. `content.render(...)` returns data rather than an Astro/React component.

Within the query, selected metadata and relationships use one revision; within the render operation, HTML/headings use one revision. The two calls may observe different revisions if development content changes between them. Public cross-operation snapshot scopes are outside v1; this example does not claim that an ID pins the metadata query's revision. The fixture values above assume unchanged source content. Each operation finishes against its own pinned revision if an update arrives while it is running. Returned values are detached: mutating a selected `publishedAt` date, Grace's selected `featuredPostIds`, or a returned headings array affects only that result, without changing future queries/rendering.

### Handle errors and development failures

The examples below use the unchanged valid fixtures. A query miss is an ordinary value, independently of explicit lookup failures:

```ts
await content
  .query("posts")
  .where((fields) => eq(fields.id, "missing-post"))
  .select("id")
  .first(); // undefined

await content.readBody("authors", "ada"); // undefined: entry exists, no body
```

These separate operations demonstrate library failures; they are not a script that proceeds past an unhandled rejection:

```ts
await content.readBody("posts", "missing-post");
// Rejects with ContentError code "entry-not-found".
```

```ts
await content.render("authors", "ada");
// Rejects with ContentError code "not-renderable".
```

```ts
content.query("posts").select("id").limit(-1);
// Throws synchronously with ContentError code "invalid-query".
```

Applications import the public error from `content-query/runtime`. Grouped preparation failures expose independent diagnostics through `error.diagnostics`, retaining each code, context, validation issues, and cause under the single `ContentError` contract.

For an independent invalid-source scenario, change `getting-started`'s `publishedAt` to `"not-a-date"` and `upcoming-features`'s `title` to `""`. Preparation reports both independent `validation-error` diagnostics together, with collection/entry/source/field context and the original validation issues. The date diagnostic identifies `posts/getting-started` and `["publishedAt"]`; the title diagnostic identifies `posts/upcoming-features` and `["title"]`. Provider messages may differ. Computed work requiring invalid metadata is skipped, rather than generating follow-on failures.

Publish neither invalid entry nor a partial revision. The integration displays the current preparation failure, and new query executions, `readBody()`, and `render()` reject until a valid replacement preparation succeeds. Watching stays active; correcting both values lets preparation publish atomically and recover automatically. A previous valid revision may remain internally for already-started operations and recovery, but new operations cannot read it as successful current content during the failure.

These failure scenarios do not alter the baseline fixtures or expected query results in the rest of this example. The route example's query-miss 404 remains application-owned. An actual stored-payload read failure instead uses `artifact-error`, and a compiler failure uses `render-error`, preserving their causes rather than pretending content is absent.

### Load related entries in both directions

Posts can explicitly request selected author data:

```ts
const postsWithAuthors = await content
  .query("posts")
  .where((fields) => eq(fields.draft, false))
  .select("id", "title")
  .with("author", (author) => author.select("name"))
  .all();
```

For this fixture, the result is:

```ts
[
  {
    id: "getting-started",
    title: "Getting started",
    author: { name: "Ada Lovelace" },
  },
];
```

The source `authorId` and the related author's `id` are absent because neither was selected. The source schema requires an `authorId`, preparation validates that it points to exactly one author, and this query applies no filter to the author. Each result has this type:

```ts
type PostWithAuthor = {
  id: string;
  title: string;
  author: { name: string };
};
```

If a post supplies `authorId: missing-author`, preparation fails even if a query excludes that post as a draft. `referenceSide: "from"` makes the post the owner of this authored reference. The inverse `authors.posts` uses `"to"`, so an author having no posts is valid.

In an independent optional-author variation, change only the validated source field:

```ts
authorId: z.string().nullable().optional(),
```

The mapping needs no optionality flag. An omitted, undefined, or null author ID then returns `author: null`; an actually supplied missing ID still fails preparation. The unfiltered result type becomes `author: { name: string } | null`. The main fixture retains required `authorId: z.string()` and its non-null unfiltered author type.

A query can also filter a required singular reference:

```ts
const postsWithMatchingAuthors = await content
  .query("posts")
  .where((fields) => eq(fields.draft, false))
  .select("id")
  .with("author", (author) =>
    author.select("name").where((fields) => eq(fields.name, "Grace Hopper")),
  )
  .all();

// [{ id: "getting-started", author: null }]
```

Ada exists and is the valid target, but does not pass this nested filter. The parent remains. This query's author type includes `null`, despite the required source reference. Its singular builder exposes selection, filtering, and further relationships rather than ordering or pagination.

Authors can request their posts through the inverse mapping using the same fluent query syntax:

```ts
const authorsWithPosts = await content
  .query("authors")
  .select("id", "name")
  .with("posts", (posts) =>
    posts
      .select("id", "title")
      .where((fields) => eq(fields.draft, false))
      .orderBy("publishedAt", "desc")
      .limit(5),
  )
  .all();
```

The returned value is:

```ts
[
  {
    id: "ada",
    name: "Ada Lovelace",
    posts: [{ id: "getting-started", title: "Getting started" }],
  },
  {
    id: "grace",
    name: "Grace Hopper",
    posts: [],
  },
];
```

The draft is filtered from Ada's nested posts. Grace remains in the parent result with an empty array. The limit applies independently to each author's posts. These queries use prepared query data and do not compile Markdown or load body/rendering payloads. Within each operation, parent and related data use the same content revision.

### Load an authored ID array

Grace's `featuredPosts` maps her `featuredPostIds` to post IDs with `referenceSide: "from"`. It is independent of the inverse `posts` relationship representing authorship:

```ts
const graceWithFeaturedPosts = await content
  .query("authors")
  .where((fields) => eq(fields.id, "grace"))
  .select("id")
  .with("featuredPosts", (posts) => posts.select("id", "title"))
  .first();

// {
//   id: "grace",
//   featuredPosts: [
//     { id: "upcoming-features", title: "Upcoming features" },
//     { id: "getting-started", title: "Getting started" },
//     { id: "upcoming-features", title: "Upcoming features" },
//   ],
// }
```

Authored order and duplicate positions survive projection. The first ID is not moved behind `getting-started` by the ordinary ascending-ID default. This query deliberately has no publication filter, so the draft is included. If its nested builder adds `.where((fields) => eq(fields.draft, false))`, only `getting-started` remains. Explicit `.orderBy(...)` instead overrides authored order while preserving duplicate positions; filtering precedes offset/limit.

All supplied IDs must exist, even if a later query would exclude them. The source `featuredPostIds` and author name are absent because neither was selected. Ada's defaulted empty array would produce `featuredPosts: []` if requested. An additional `.with("featuredPosts", ...)` at the same scope or a second `.select(...)` is rejected rather than implicitly merged; different relationship names and independent builder branches remain allowed.

### Loader-supplied HTML and body retention

The Markdown example uses `retainBody: true`, so `content.readBody("posts", "getting-started")` returns its captured Markdown. Changing the loader option to `retainBody: false` makes that public value `undefined` after preparation; computed fields can still use the captured source text while preparing query data.

The default eager SSR policy still serves the compiled HTML/headings. With `deferRender: true`, retain private Markdown input for compilation even when public raw-text access is disabled. The same `content.readBody(...)` call returns `undefined` when public raw-text retention is disabled, even if the renderer still needs private captured input.

A custom loader can also supply prepared HTML directly. The following is an independent CMS-entry example and does not change the post/author fixtures or query results above:

```ts
const loadedNotice = {
  id: "service-notice",
  data: { title: "Service notice" },
  rendered: {
    html: '<h1 id="service-notice">Service notice</h1><p>All systems operational.</p>',
    metadata: {
      headings: [{ depth: 1, slug: "service-notice", text: "Service notice" }],
    },
  },
};
```

If written with `context.store.set(loadedNotice)` by a registered `notices` loader, `content.render("notices", "service-notice")` returns that HTML and heading metadata without Markdown compilation. `content.readBody("notices", "service-notice")` returns `undefined` because the entry supplies no `body`. If metadata/headings were omitted, rendering would return `headings: []`. The loader function stays in preparation; deployed runtime loads only its prepared data.

### Package the example for production

The generated backend writes one index per collection and groups each collection's entry payloads beside its index. `authors/index.js` contains validated author names and `featuredPostIds`, including Ada's defaulted empty array and Grace's ordered duplicates. `posts/index.js` contains both posts' validated metadata and computed `slug`, including the draft. The payload keys below are shortened illustrations; actual key generation is internal:

```text
.content-query/
  server.js
  server.d.ts
  manifest.js
  collections/
    authors/
      index.js
    posts/
      index.js
      entries/
        a81f4c9e.js
        6d02b7a1.js
```

The authors have no body or rendering payload, so they need no separate entry files. `a81f4c9e.js` represents `posts/getting-started`'s payload and `6d02b7a1.js` represents `posts/upcoming-features`'s payload. Their logical IDs and query results do not change. Keep retained raw Markdown, private compiler inputs, and supplied/compiled HTML/headings outside the query indexes. Under the example's `retainBody: true` default, raw Markdown remains available independently of compiled output.

Use synchronous devalue encoding for each complete entry query record and for payload data, preserving `publishedAt` as a `Date`, defaulted `draft`, supported values, and stored property presence without rerunning schema transforms. The missing optional subtitle remains absent in source data while query selection materializes it as an own property with `undefined`; the other post's explicit null remains null. References/cycles within one encoded entry are preserved, without promising cross-entry object identity.

The manifest records `authors`/`posts`, their relationship mappings and `referenceSide` ownership, and which collections support Markdown rendering. These serializable descriptors replace runtime registration from the definition objects. Generated type declarations preserve inferred query types without executable config imports.

For production SSR with `deferRender: false`, compile both posts into rendering payloads before deployment. The draft's metadata filter does not exclude it from the runtime's deployable collection; a later explicit render request could address its ID. Publication/access policy remains application-owned. With `deferRender: true`, capture both raw bodies and package the library-owned renderer instead of requiring every compiled output in advance.

Each collection index references its local payload modules through literal importers. This illustrates the private exports inside `.content-query/collections/posts/index.js`; hashes are shortened and the export name is not public API:

```ts
// Alongside the encoded query data in the posts collection index.
export const payloadModules = {
  "getting-started": () => import("./entries/a81f4c9e.js"),
  "upcoming-features": () => import("./entries/6d02b7a1.js"),
};
```

Importing the collection index does not invoke these payload importers. `content.readBody("posts", "getting-started")` and `content.render("posts", "getting-started")` explicitly load the applicable item payload; querying titles or dates uses only prepared query data. The eager path's payload contains HTML/headings or applicable library-generated rendering code, not an extracted user-defined resolver. The deferred path uses packaged captured text and the library runtime processor. A host may combine or split final chunks.

A changed post payload receives a new opaque key derived from collection, ID, and encoded payload bytes; the new collection index references it. Reuse unchanged payload modules, and retain older ones while operations using the previous revision still need them. Publish the new validated revision after all its artifacts are ready. Manifest format/codec incompatibility produces `artifact-error` and requires regeneration; no SSR source/config import is a fallback.

The generated server entry connects these artifacts to the library runtime. Its executable imports must not lead to `content-query.config.ts`, its loader imports, Zod schemas, computed functions, or a shared collection definitions module. Adding a generated wrapper that imports the original config would violate this boundary. The build command/integration owns runtime initialization, so application code does not maintain another `{ posts, authors }` registry.

Vite can supply virtual-module wiring; other bundlers consume real generated ESM files. The in-memory backend emits no files and instead needs explicit host-provided prepared-state transfer/embedding for a separate SSR process. Both paths keep configuration on the preparation side.

### Static generation and SSR

With a pure SSG integration, the page code queries selected metadata and calls the built-in renderer for the pages it produces. The getting-started page gets its HTML/headings during that build. The integration can avoid an additional compilation pass for entries the application never renders. A static-only deployment ships the resulting pages rather than the content runtime. The standalone preparation script above uses the safe eager policy instead: with `deferRender: false`, it compiles both posts even if later consumed only for SSG. This distinction requires no public `target` setting.

An SSR or mixed deployment also supports requests outside the prerendered set. The default eager SSR policy therefore compiles the deployable Markdown collection during build preparation. `deferRender: true` instead permits request-time compilation from captured inputs and library-owned processing code. Both use the same explicit render call and lazy body/output loading; neither runs original loaders or source schemas on a request.

Render compilation errors fail preparation/prerendering when encountered there. Under deferred SSR compilation, an unvisited entry can fail its first rendering request. Reusable output may avoid later processing, but persistent caches or sharing between build and SSR are not assumed. Private cache/artifact mechanics follow the implementation defaults and agreed collection layout.

### When work happens

| Operation                                   | Work in this example                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acquire source inputs                       | Loaders discover/read JSON and Markdown and supply metadata plus captured body strings or supplied rendered HTML. Additional source dependencies belong here.                |
| Prepare query data                          | Validate author/frontmatter data, normalize `publishedAt`, default `draft`, and compute `slug`. The source schemas/functions stay in preparation.                            |
| Validate relationships                      | Check supplied reference IDs/cardinality before publishing a revision. Both posts reference Ada; Grace's featured IDs also resolve. Grace having no authored posts is valid. |
| Build runtime metadata                      | Record names, mappings, capabilities, and serializable renderer settings in a prepared manifest; derive server-entry wiring and types from the single registry.              |
| Prepare production SSR, default             | Capture required inputs and compile deployable Markdown into separate item rendering payloads. Keep output outside the query index.                                          |
| Prepare production SSR, `deferRender: true` | Capture needed inputs and package the library-owned renderer/dependencies. Do not invoke every body's renderer merely to produce query metadata.                             |
| List or look up posts                       | Filter, order, paginate, and project prepared fields. Load no body or rendered payload.                                                                                      |
| Load related data with `.with(...)`         | Match prepared fields/IDs and return selected related fields. No rendering occurs.                                                                                           |
| Explicitly render an entry                  | Load supplied/compiled HTML plus headings with slugs, or process captured Markdown according to context and policy. The render result uses one revision.                     |
| Change development content/configuration    | Preparation invalidates affected work and atomically publishes valid changes. Rendering results are invalidated for the affected revision.                                   |
| Initialize production runtime               | Consume prepared artifacts or embedded prepared state; do not import configuration, loaders, source schemas, or original definition objects.                                 |

The same query, manifest, body access, and built-in rendering contracts apply to in-memory, generated, and eventual SQLite backends. The preparation entry point, public generated server entry, session/watch API, and implementation defaults are agreed. Private adapter factories, detailed helper declarations, module embedding, and cache mechanics are private implementation details under those defaults. The collection-grouped layout and devalue encoding are agreed. The public `ContentError` contract and failure/recovery behavior are agreed. Public snapshot scopes and source-body reader callbacks are deferred beyond v1. The v1 ownership, startup/recovery, candidate-state, and per-operation revision rules follow the conformance scenarios above and preserve the build-only configuration boundary.
