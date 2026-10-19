---
title: Computed fields
description: Derive queryable values from validated metadata during preparation.
section: defining-content
order: 12
---

Computed fields become ordinary queryable metadata. Add them alongside a collection's schema:

```ts
computed: {
  upperTitle: {
    schema: z.string(),
    resolve: ({ data }) => data.title.toUpperCase(),
  },
}
```

## When computation runs

Resolvers run during preparation and can be asynchronous. Their results are validated by the field schema and stored for runtime queries.

Resolvers receive the entry's `id`, validated `data`, and captured `readBody()` text when available. They work on one entry; collection-wide calculations belong in application queries.

Use [field selection](/docs/querying-content#field-selection) to request a computed field in your query results.
