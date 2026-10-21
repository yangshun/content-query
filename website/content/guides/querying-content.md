---
title: Querying content
description: Select metadata with SQL-ordered fluent queries and collection-scoped relational queries.
section: querying
order: 20
---

Import `content` from `content-query:server` in Vite server modules, or from the prepared `.content-query/server.js` entry in other hosts.

## Field selection

The fluent API follows SQL order: `content.select(...fields).from(collection)`. The relational API lives under `content.query.<collection>`. These queries return the same fields:

```ts
const posts = await content.select("id", "title").from("posts");

const samePosts = await content.query.posts.findMany({ columns: { id: true, title: true } });
```

Use `content.select().from("posts")` or `content.query.posts.findMany()` for all prepared metadata, including IDs and computed fields. Neither query loads bodies or HTML. Relationships are included only when requested.

Relational `columns` supports inclusion (`{ title: true }`), exclusion (`{ draft: false }`), and no scalar fields (`{}`). When any column is `true`, only the `true` columns are returned. Explicitly selected optional fields are present with value `undefined` when absent; default metadata results preserve stored property presence.

Fluent field names and result types are checked once `.from()` binds the collection. Builders are immutable and reusable. Await a builder directly, or call `.all()` or `.execute()` for an array. Use `.first()` or relational `.findFirst()` for one entry; they return `undefined` when nothing matches.

## Filtering

```ts
import { eq } from "content-query/query";

const published = await content
  .select("id", "title")
  .from("posts")
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

Use `with: { author: true }` to include all author metadata. To filter the parent posts by their author, use `where: { author: { name: "Ada" } }`. A filter inside `with.author` filters only the included author, leaving the parent results unchanged.

## Previous and next entries

Use `.selectAdjacent()` or relational `adjacent: true` for neighbor IDs in the ordered result. Detail pages can give adjacency its own sibling scope, independent of the current ID filter:

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
  .select("id", "title")
  .from("posts")
  .where((fields) => eq(fields.id, "hello"))
  .selectAdjacent((siblings) => siblings.orderBy("title").select("id", "title"))
  .first();
```

Neighbors are returned in `_adjacent.previous` and `_adjacent.next`, with `null` at each boundary. Sibling scopes cannot paginate or recursively request adjacency.
