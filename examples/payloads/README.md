# ContentQuery payloads

A framework-free example that builds a small static site from prepared content. It shows each way to request payloads, which are per-entry data such as a Markdown body or its rendered HTML. Payloads are stored and loaded separately from query metadata, and a query loads them only when it asks for them.

## Run it

Use the repository's Node.js 24.21.0 runtime and Vite+ CLI. From the repository root:

```sh
vp install --frozen-lockfile
vp run --filter content-query build
vp run --filter @content-query/example-payloads build
```

The build script runs `content-query build`, then `node src/site.ts`, which writes HTML and Markdown files to `dist/`. Node.js runs the TypeScript script directly.

## Collections

`content-query.config.ts` declares three collections:

- `articles` uses the Markdown `source` shorthand, so its entries offer the built-in `_body` and `_rendered` payloads.
- `authors` uses `file()`. Its entries are data records, so requesting a payload from it is a type error and an `invalid-query` at runtime.
- `announcements` uses a custom loader that supplies finished HTML, as a CMS would. Its `_rendered` payload needs no Markdown compilation, and its `_body` payload is `undefined`.

## Payload patterns

`src/site.ts` uses each pattern once:

| Page               | Query                                                                                                       | Loads                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Index list         | `query.articles.findMany({ columns, orderBy, with })`                                                       | Metadata only                                        |
| Index "Latest"     | `select("id", "title").from("articles").orderBy(...).withPayload("_rendered").first()`                      | One article's HTML                                   |
| Index announcement | `query.announcements.findFirst({ payloads: { _rendered: true, _body: true } })`                             | Supplied HTML; `_body` is `undefined`                |
| Article pages      | `query.articles.findFirst({ where: { id }, with: { author }, payloads: { _rendered: true, _body: true } })` | HTML, headings, and the raw Markdown, from one query |
| Author pages       | `query.authors.findMany({ with: { articles: { limit: 1, payloads: { _rendered: true } } } })`               | Each author's newest article only                    |

Requested values appear under `_payloads` on each row:

```ts
const article = await content.query.articles.findFirst({
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
