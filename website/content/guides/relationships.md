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

## Load related entries

Every level selects its own data; nothing is included implicitly, not even `id`. The fluent API selects fields independently at each level:

```ts
const posts = await content
  .from("posts")
  .select("id", "title")
  .with("author", (author) => author.select("name"))
  .all();
```

The relational API uses `with` and nested `columns`:

```ts
const posts = await content.query.posts.findMany({
  columns: { id: true, title: true },
  with: { author: { columns: { name: true } } },
});
```

An included relationship must select data, so `with: { author: true }` is rejected; use `false` to omit a relationship. A parent `where: { author: { name: "Ada" } }` filters posts by author; a `where` inside `with.author` filters only the included author.

ContentQuery checks authored references during preparation. Dangling references, ambiguous matches, and invalid singular cardinality fail validation.

Many relationships support per-parent filtering, ordering, and pagination. A singular relationship can be filtered and returns `null` when its target is excluded. See [querying related content](/docs/querying-content#related-content) for the equivalent relational query.
