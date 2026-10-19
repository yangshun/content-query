---
title: Collections and schemas
description: Define the shape of related content and generate useful TypeScript types.
section: defining-content
order: 10
---

A collection groups entries with shared metadata. Export your collections from `content-query.config.ts` at the application root.

## Define a collection

```ts
import { defineCollection } from "content-query";
import { z } from "zod";

export const collections = {
  posts: defineCollection({
    source: "./content/posts",
    schema: z.object({
      title: z.string(),
      draft: z.boolean().default(false),
    }),
  }),
};
```

## Validation and types

Schemas follow Standard Schema V1; these examples use Zod. Validation runs during preparation, and validated outputs determine the query types. Async validation is supported.

Each entry has a top-level `id`. Keep `id` out of the metadata schema, and use distinct names for source fields, [computed fields](/docs/computed-fields), and [relationships](/docs/relationships).

Choose exactly one of `source` or `loader`. See [sources and loaders](/docs/sources-and-loaders) for input formats.
