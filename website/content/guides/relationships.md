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

Select fields independently at every level:

```ts
const posts = await content
  .query("posts")
  .select("id", "title")
  .with("author", (author) => author.select("name"))
  .all();
```

ContentQuery checks authored references during preparation. Dangling references, ambiguous matches, and invalid singular cardinality fail validation.

Many relationships support per-parent filtering, ordering, and pagination. A singular relationship can be filtered and returns `null` when its target is excluded. See [querying related content](/docs/querying-content#related-content) for the equivalent object query.
