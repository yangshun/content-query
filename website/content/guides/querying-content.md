---
title: Querying content
description: Select metadata with equivalent fluent and object query APIs.
section: querying
order: 20
---

Import `content` from `content-query:server` in Vite server modules, or from the prepared `.content-query/server.js` entry in other hosts.

## Field selection

Row queries require explicit selection. These queries return the same fields:

```ts
const posts = await content.query("posts").select("id", "title").all();

const samePosts = await content.findMany("posts", {
  select: { id: true, title: true },
});
```

Neither query loads bodies or HTML. Use `first()` or `findFirst()` for one entry; they return `undefined` when nothing matches.

## Filtering

```ts
import { eq } from "content-query/query";

const published = await content
  .query("posts")
  .where((fields) => eq(fields.draft, false))
  .select("id", "title")
  .all();

const samePublished = await content.findMany("posts", {
  where: { draft: false },
  select: { id: true, title: true },
});
```

Combine predicates with `and`, `or`, and `not`, or object `AND`, `OR`, and `NOT`. See the [operator reference](/docs/reference/queries-and-operators) for comparisons, string matching, arrays, and presence checks.

## Sorting, pagination, and counts

Use `.orderBy("title").offset(0).limit(10)` or object options `orderBy: { title: "asc" }, offset: 0, limit: 10`. IDs break ordering ties deterministically.

`count()` counts filtered entries before pagination and does not require selection. Query builders are immutable, so you can reuse a base query for a listing and its count.

## Related content

For the [author relationship](/docs/relationships), `.with("author", (author) => author.select("name"))` corresponds to:

```ts
select: {
  id: true,
  title: true,
  author: { select: { name: true } },
}
```

## Previous and next entries

Use `.selectAdjacent()` or object `select: { id: true, _adjacent: true }` for neighbors in the ordered result. Detail pages can give adjacency its own sibling scope, independent of the current ID filter:

```ts
const post = await content
  .query("posts")
  .where((fields) => eq(fields.id, "hello"))
  .select("id", "title")
  .selectAdjacent((siblings) => siblings.orderBy("title").select("id", "title"))
  .first();
```

Neighbors are returned in `_adjacent.previous` and `_adjacent.next`, with `null` at each boundary.
