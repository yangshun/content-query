# ContentQuery payloads

A framework-free example that builds a small static site from prepared content. It shows each way to request payloads, which are per-entry data such as a Markdown body or its rendered HTML. Payloads are stored and loaded separately from query metadata, and a query loads them only when it asks for them.

## Run it

Use the repository's Node.js 24.21.0 runtime and Vite+ CLI. From the repository root:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @content-query/example-payloads build
```

The build script runs `content-query build`, then `node src/site.ts`, which writes HTML pages, Markdown sources, and a JSON feed to `dist/`. Node.js runs the TypeScript script directly.

## Collections

`content-query.config.ts` declares three collections:

- `articles` uses the Markdown `source` shorthand, so its entries offer the built-in `_body` and `_rendered` payloads. It also declares a custom `excerpt` payload with a `length` variant listing `short` and `long`, resolved from each body's first paragraph during the build.
- `authors` uses `file()`. Its entries are data records, so requesting a payload from it is a type error and an `invalid-query` at runtime.
- `announcements` uses a custom loader that supplies finished HTML, as a CMS would. Its `_rendered` payload needs no Markdown compilation, and its `_body` payload is `undefined`.

## Payload patterns

`src/site.ts` imports each collection from its own generated entry, such as `.content-query/collections/articles/server.js`, and uses each pattern once. Queries that follow a relationship pass its target collection to `using()`:

| Page               | Query                                                                                                                | Loads                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Index list         | `articles.using(authors).findMany({ columns, orderBy, with })`                                                       | Metadata only                                        |
| Index "Latest"     | `articles.select("id", "title").orderBy(...).withPayload("_rendered").first()`                                       | One article's HTML                                   |
| Index announcement | `announcements.findFirst({ payloads: { _rendered: true, _body: true } })`                                            | Supplied HTML; `_body` is `undefined`                |
| Article pages      | `articles.using(authors).findFirst({ where: { id }, with: { author }, payloads: { _rendered: true, _body: true } })` | HTML, headings, and the raw Markdown, from one query |
| JSON feed          | `articles.findMany({ columns, orderBy, payloads: { excerpt: { length: "long" } } })`                                 | One custom payload variant per article               |
| Author pages       | `authors.using(articles).findMany({ with: { articles: { limit: 1, payloads: { _rendered: true } } } })`              | Each author's newest article only                    |

Requested values appear under `_payloads` on each row:

```ts
const article = await articles.findFirst({
  where: { id },
  payloads: { _rendered: true, _body: true },
});
const { _rendered: rendered, _body: body } = article!._payloads;
```

Payloads load after filtering, ordering, and pagination, from the same revision as the rest of the result. Counts and adjacent entries cannot request them.

## Verification

```sh
vp run check
vp test run examples/payloads
```

`tests/site.integration.test.ts` copies the example into a temporary directory and builds the content. It then deletes the sources and configuration and runs `src/site.ts`. It checks the following:

- The index holds no article bodies.
- Each article page includes its rendered HTML, a contents list from its headings, and a byte-identical Markdown file.
- Author pages include only each author's newest article.
- Unsupported payload requests reject with `invalid-query`.
