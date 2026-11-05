---
title: Relationships
description: Connect collections and select related entries with their own query scope.
section: defining-content
order: 13
---

For posts with an `authorId` string field, declare an author relationship alongside the post schema. The `authors` collection contains entries with a `name` field.

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

## Supply related collections

Each collection's entry loads only that collection, so queries never follow a relationship implicitly. Import the target collection and pass it to `using()` where a query follows the relationship:

```ts
import { posts } from "content-query:collections/posts";
import { authors } from "content-query:collections/authors";

const postsWithAuthors = posts.using(authors);
```

`using()` returns a handle over `posts` that can also follow relationships into `authors`. Because each call site names its targets, a module's imports show every collection its queries load, and a route that never follows the relationship never imports `authors`. `using()` only supplies relationship targets; query authors themselves through `authors`.

Every hop is explicit. For `with: { author: { with: { publisher: ... } } }`, pass both targets: `posts.using(authors, publishers)`. Relationships from a collection to itself need nothing. Handles are reusable, so a module can create `posts.using(authors)` once and share it; ContentQuery caches each combination.

A relationship whose target was not supplied is a type error at the relationship, in `with`, relational `where`, and fluent `has()`. Running the query anyway throws an `invalid-query` error: `Relationship "author" targets the authors collection, which this query has not loaded. Pass it to using(), such as posts.using(authors).`

## Load related entries

Every level selects its own data; nothing is included implicitly, not even `id`. The fluent API selects fields independently at each level:

```ts
const entries = await posts
  .using(authors)
  .select("id", "title")
  .with("author", (author) => author.select("name"))
  .all();
```

The relational API uses `with` and nested `columns`:

```ts
const sameEntries = await posts.using(authors).findMany({
  columns: { id: true, title: true },
  with: { author: { columns: { name: true } } },
});
```

An included relationship must select data, so `with: { author: true }` is rejected; use `false` to omit a relationship. A parent `where: { author: { name: "Ada" } }` filters posts by author; a `where` inside `with.author` filters only the included author.

ContentQuery checks authored references during preparation. Dangling references, ambiguous matches, and invalid singular cardinality fail validation.

Many relationships support per-parent filtering, ordering, and pagination. A singular relationship can be filtered and returns `null` when its target is excluded. See [querying related content](/docs/querying-content#related-content) for the equivalent relational query.
