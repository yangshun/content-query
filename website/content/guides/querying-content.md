---
title: Querying content
description: Select exactly the metadata you need with collection-first fluent queries and collection-scoped relational queries.
section: querying
order: 20
---

Each collection has its own entry, so a module imports only the collections it queries. Import `posts` from `content-query:collections/posts` in Vite server modules, from `#content-query/posts` through the [Next.js alias](/docs/integrations/next#add-a-runtime-import-alias), or from the generated `.content-query/collections/posts/server.js` entry in other hosts:

```ts
import { posts } from "content-query:collections/posts";
```

## Field selection

Fluent queries start from the collection and select fields with `.select(...fields)`. The relational API is the collection's `findMany()`, `findFirst()`, and `paginate()`. These queries return the same fields:

```ts
const entries = await posts.select("id", "title");

const sameEntries = await posts.findMany({ columns: { id: true, title: true } });
```

Later `.select()` calls add fields, so a shared selection can grow where a page needs more. A field selected again appears once:

```ts
const postLink = posts.select("id", "title");

const links = await postLink;
const cards = await postLink.select("publishedAt");
```

Queries return only the data they select. Nothing is implicit, not even `id`, so each query shows the data its page needs, and unrequested fields stay out of loader data and client payloads. A query must select fields, include a relationship, request a payload, or select adjacent entries. Otherwise it fails to type-check, and running it throws an `invalid-query` error:

```ts
await posts.orderBy("title"); // Error: nothing is selected.
await posts.findMany({ where: { draft: false } }); // Error: filters select nothing.
```

Counts return no rows, so they need no selection. Bodies and HTML load only as requested [payloads](/docs/rendering-content).

Relational `columns` lists fields to include with `true`; there are no exclusions. `columns: {}` selects no fields, for queries that only need relationships, payloads, or adjacent entries. Explicitly selected optional fields are present with value `undefined` when absent.

Fluent queries can also start with `byId`, `where`, `orderBy`, `limit`, `offset`, `with`, `withPayload`, or `selectAdjacent`. Field names and result types are checked against the collection from the first call, so editors complete field names in `.select()`. Builders are immutable and reusable. Await a selected builder directly, or call `.all()` or `.execute()` for an array. Use `.first()` or relational `.findFirst()` for one entry; they return `undefined` when nothing matches.

## Filtering

```ts
import { eq } from "content-query/query";

const published = await posts.select("id", "title").where((fields) => eq(fields.draft, false));

const samePublished = await posts.findMany({
  columns: { id: true, title: true },
  where: { draft: false },
});
```

Combine fluent predicates with `and`, `or`, and `not`, or relational filters with `AND`, `OR`, and `NOT`. See the [operator reference](/docs/reference/queries-and-operators) for comparisons, string matching, arrays, and presence checks.

For detail pages, start with `posts.byId(id)`. Awaiting it returns the entry or `undefined`, without `.first()`:

```ts
const post = await posts.byId("hello").select("id", "title");

const samePost = await posts.findFirst({
  columns: { id: true, title: true },
  where: { id: "hello" },
});
```

A `byId()` query returns one entry, so it has no `.orderBy()`, `.limit()`, `.offset()`, `.paginate()`, or `.all()`. `.first()` and `.execute()` return the same entry, `.count()` returns `0` or `1`, and later `.where()` filters also apply: `posts.byId(id).where((fields) => eq(fields.draft, false))` finds the post only when it is published.

`byId()`, `.where((fields) => eq(fields.id, id))`, and relational `where: { id }` use a lazy ID index for the current collection revision. Other filters and query options still apply, and development updates use the new revision's records.

## Sorting, limits, and counts

Use `.orderBy("title").offset(0).limit(10)` or relational options `orderBy: { title: "asc" }, offset: 0, limit: 10`. IDs break ordering ties deterministically.

Both fluent `.count()` and `posts.count({ where: { draft: false } })` count matching parents before pagination, and `posts.count()` counts every entry. They do not load relationships or bodies.

## Pagination

`paginate()` returns one page with the details that page links need, from a single query. Use page numbers for archive routes and cursors for "load more" lists:

```ts
const published = posts
  .select("id", "title")
  .where((fields) => eq(fields.draft, false))
  .orderBy("publishedAt", "desc");

const archive = await published.paginate({ page: 2, size: 10 });
// { items, total, page, pageCount, hasNextPage, hasPreviousPage }

const first = await published.paginate({ size: 10 });
const next = await published.paginate({ size: 10, after: first.endCursor });
// { items, startCursor, endCursor, hasNextPage, hasPreviousPage }
```

The relational API takes the same options next to its query options: `posts.paginate({ columns: { id: true }, orderBy: { publishedAt: "desc" }, page: 2, size: 10 })`. Items match what `all()` or `findMany()` would return for that page, so `.all()` and `findMany()` still return plain arrays.

- **Page numbers** start at 1. `pageCount` is at least 1, so the first page renders even when nothing matches, and a page past the end returns no items. Read `pageCount` from page 1 to generate static archive routes.
- **Cursors** are opaque strings. Pass `endCursor` as `after` for the next page and `startCursor` as `before` for the previous one; `before: null` starts from the last page. Add `total: true` to also get the matching total. Cursors keep working when filters change or the boundary entry is removed, but a cursor from a different collection or sort order rejects with `invalid-cursor`.
- `paginate()` sets the limit and offset itself, so it is unavailable after `.limit()` or `.offset()`, and relational `paginate()` rejects `limit` and `offset`.

Type page props with `NumberedPage` or `CursorPage` from `content-query/query` and the collection's [entry type](/docs/reference/runtime#generated-types), for example `NumberedPage<ContentPost<"id" | "title">>`.

## Related content

Queries that follow a relationship supply its target collection with [`using()`](/docs/relationships#supply-related-collections). For the [author relationship](/docs/relationships), `posts.using(authors).select("id", "title").with("author", (author) => author.select("name"))` corresponds to:

```ts
import { authors } from "content-query:collections/authors";

const entries = await posts.using(authors).findMany({
  columns: { id: true, title: true },
  with: { author: { columns: { name: true } } },
});
```

Each relationship selects its own data, so list the related fields you need; `with: { author: true }` is rejected.

To filter the parent posts by their author, use fluent `has()` or a relational relationship filter:

```ts
import { eq, has } from "content-query/query";

const byAda = await posts
  .using(authors)
  .select("id", "title")
  .where((fields) => has(fields.author, (author) => eq(author.name, "Ada")));

const sameByAda = await posts.using(authors).findMany({
  columns: { id: true, title: true },
  where: { author: { name: "Ada" } },
});
```

`has(fields.author)` and relational `author: true` match posts with any author; wrap `has()` in `not()`, or use `author: false`, for posts without one. A filter inside `with.author` filters only the included author, leaving the parent results unchanged.

## Previous and next entries

Neighbors select their own fields, like any other data. Name the fields to find neighbors within the query's own filtered and ordered results, before pagination:

```ts
const entries = await posts.select("id", "title").orderBy("title").selectAdjacent("id", "title");

const sameEntries = await posts.findMany({
  columns: { id: true, title: true },
  orderBy: { title: "asc" },
  adjacent: { scope: "results", columns: { id: true, title: true } },
});
```

Inside a relationship, results-scope neighbors come from the parent's related entries, such as a course's lessons in authored order. Detail pages can give adjacency its own sibling scope, independent of the current ID filter:

```ts
const post = await posts.findFirst({
  columns: { id: true, title: true },
  where: { id: "hello" },
  adjacent: {
    columns: { id: true, title: true },
    orderBy: { title: "asc" },
  },
});

const samePost = await posts
  .byId("hello")
  .select("id", "title")
  .selectAdjacent((siblings) => siblings.orderBy("title").select("id", "title"));
```

Neighbors are returned in `_adjacent.previous` and `_adjacent.next`, with `null` at each boundary. Sibling scopes cannot paginate or recursively request adjacency.

## Choosing a style

Both APIs compile to the same query plan and run on the same executor, so equivalent queries return the same results at the same cost. Mixing them in one application is safe, but readers then follow two filter vocabularies. Pick one style as the default and use the other for a specific reason.

Both APIs support the same filters, including `like`-style patterns, `arrayContained`, and filters through relationships, so either style can express every query.

Fluent builders are immutable, so one base query can serve a page of results and its total without repeating the filter:

```ts
const published = posts.where((fields) => eq(fields.draft, false));

const page = await published.select("id", "title").orderBy("title").offset(0).limit(10);
const total = await published.count();
```

Relational options are plain objects. Share them across modules and check them with `satisfies QueryOptions<...>` from `content-query/query`, which keeps literal column selections.

Operator names differ between the styles; see the [operator reference](/docs/reference/queries-and-operators#filter-operators). Take care with `arrayContains`: fluent `arrayContains(fields.tags, "news")` matches one item, while relational `tags: { arrayContains: ["news", "guide"] }` requires every listed item, like fluent `arrayContainsAll`.

To enforce one style, export `queryStyle` from the config. Type checks and the runtime then reject the other API; see [query style](/docs/reference/configuration#query-style).
