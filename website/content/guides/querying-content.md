---
title: Querying content
description: Select exactly the metadata you need with collection-first fluent queries and collection-scoped relational queries.
section: querying
order: 20
---

Import `content` from `content-query:server` in Vite server modules, or from the prepared `.content-query/server.js` entry in other hosts.

## Field selection

Fluent queries start from a collection, `content.from(collection)`, and select fields with `.select(...fields)`. The relational API lives under `content.query.<collection>`. These queries return the same fields:

```ts
const posts = await content.from("posts").select("id", "title");

const samePosts = await content.query.posts.findMany({ columns: { id: true, title: true } });
```

Queries return only the data they select. Nothing is implicit, not even `id`, so each query shows the data its page needs, and unrequested fields stay out of loader data and client payloads. A query must select fields, include a relationship, request a payload, or select adjacent entries. Otherwise it fails to type-check, and running it throws an `invalid-query` error:

```ts
await content.from("posts"); // Error: nothing is selected.
await content.query.posts.findMany({ where: { draft: false } }); // Error: filters select nothing.
```

Counts return no rows, so they need no selection. Bodies and HTML load only as requested [payloads](/docs/rendering-content).

Relational `columns` lists fields to include with `true`; there are no exclusions. `columns: {}` selects no fields, for queries that only need relationships, payloads, or adjacent entries. Explicitly selected optional fields are present with value `undefined` when absent.

Fluent field names and result types are checked as soon as `from()` names the collection, so editors complete field names in `.select()`. Builders are immutable and reusable. Await a selected builder directly, or call `.all()` or `.execute()` for an array. Use `.first()` or relational `.findFirst()` for one entry; they return `undefined` when nothing matches.

## Filtering

```ts
import { eq } from "content-query/query";

const published = await content
  .from("posts")
  .select("id", "title")
  .where((fields) => eq(fields.draft, false));

const samePublished = await content.query.posts.findMany({
  columns: { id: true, title: true },
  where: { draft: false },
});
```

Combine fluent predicates with `and`, `or`, and `not`, or relational filters with `AND`, `OR`, and `NOT`. See the [operator reference](/docs/reference/queries-and-operators) for comparisons, string matching, arrays, and presence checks.

For detail pages, `.where((fields) => eq(fields.id, id))` and relational `where: { id }` use a lazy ID index for the current collection revision. Other filters and query options still apply, and development updates use the new revision's records.

## Sorting, pagination, and counts

Use `.orderBy("title").offset(0).limit(10)` or relational options `orderBy: { title: "asc" }, offset: 0, limit: 10`. IDs break ordering ties deterministically.

Both fluent `.count()` and `content.count("posts", { where: { draft: false } })` count matching parents before pagination. They do not load relationships or bodies.

## Related content

For the [author relationship](/docs/relationships), `.with("author", (author) => author.select("name"))` corresponds to:

```ts
const posts = await content.query.posts.findMany({
  columns: { id: true, title: true },
  with: { author: { columns: { name: true } } },
});
```

Each relationship selects its own data, so list the related fields you need; `with: { author: true }` is rejected.

To filter the parent posts by their author, use fluent `has()` or a relational relationship filter:

```ts
import { eq, has } from "content-query/query";

const byAda = await content
  .from("posts")
  .select("id", "title")
  .where((fields) => has(fields.author, (author) => eq(author.name, "Ada")));

const sameByAda = await content.query.posts.findMany({
  columns: { id: true, title: true },
  where: { author: { name: "Ada" } },
});
```

`has(fields.author)` and relational `author: true` match posts with any author; wrap `has()` in `not()`, or use `author: false`, for posts without one. A filter inside `with.author` filters only the included author, leaving the parent results unchanged.

## Previous and next entries

Neighbors select their own fields, like any other data. Name the fields to find neighbors within the query's own filtered and ordered results, before pagination:

```ts
const posts = await content
  .from("posts")
  .select("id", "title")
  .orderBy("title")
  .selectAdjacent("id", "title");

const samePosts = await content.query.posts.findMany({
  columns: { id: true, title: true },
  orderBy: { title: "asc" },
  adjacent: { scope: "results", columns: { id: true, title: true } },
});
```

Inside a relationship, results-scope neighbors come from the parent's related entries, such as a course's lessons in authored order. Detail pages can give adjacency its own sibling scope, independent of the current ID filter:

```ts
const post = await content.query.posts.findFirst({
  columns: { id: true, title: true },
  where: { id: "hello" },
  adjacent: {
    columns: { id: true, title: true },
    orderBy: { title: "asc" },
  },
});

const samePost = await content
  .from("posts")
  .select("id", "title")
  .where((fields) => eq(fields.id, "hello"))
  .selectAdjacent((siblings) => siblings.orderBy("title").select("id", "title"))
  .first();
```

Neighbors are returned in `_adjacent.previous` and `_adjacent.next`, with `null` at each boundary. Sibling scopes cannot paginate or recursively request adjacency.

## Choosing a style

Both APIs compile to the same query plan and run on the same executor, so equivalent queries return the same results at the same cost. Mixing them in one application is safe, but readers then follow two filter vocabularies. Pick one style as the default and use the other for a specific reason.

Both APIs support the same filters, including `like`-style patterns, `arrayContained`, and filters through relationships, so either style can express every query.

Fluent builders are immutable, so one base query can serve a page of results and its total without repeating the filter:

```ts
const published = content.from("posts").where((fields) => eq(fields.draft, false));

const page = await published.select("id", "title").orderBy("title").offset(0).limit(10);
const total = await published.count();
```

Relational options are plain objects. Share them across modules and check them with `satisfies QueryOptions<...>` from `content-query/query`, which keeps literal column selections.

Operator names differ between the styles; see the [operator reference](/docs/reference/queries-and-operators#filter-operators). Take care with `arrayContains`: fluent `arrayContains(fields.tags, "news")` matches one item, while relational `tags: { arrayContains: ["news", "guide"] }` requires every listed item, like fluent `arrayContainsAll`.

To enforce one style, export `queryStyle` from the config. Type checks and the runtime then reject the other API; see [query style](/docs/reference/configuration#query-style).
