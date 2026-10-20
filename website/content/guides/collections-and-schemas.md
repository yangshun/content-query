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
import { schema } from "content-query/schema";

export const collections = {
  posts: defineCollection({
    source: "./content/posts",
    schema: schema.object({
      title: schema.string(),
      draft: schema.boolean().default(false),
    }),
  }),
};
```

## Validation and types

ContentQuery includes Zod-backed builders through `content-query/schema`; no separate Zod installation is needed. The `schema` namespace supplies `object`, `string`, `number`, `boolean`, `bigint`, `date`, `array`, `enum`, `literal`, `union`, `record`, and `unknown`, plus primitive coercion through `schema.coerce`.

Returned schemas support Zod's chaining methods, including `.optional()`, `.nullable()`, `.default()`, `.refine()`, and `.transform()`. Nested composition follows Zod's rules. Provider-level parsing utilities, error classes, and configuration are outside the namespace.

Schemas follow Standard Schema V1, so other compatible validators also work for collection metadata and computed fields. Validation runs during preparation, and validated outputs determine the query types. Async validation is supported. Generated runtime JavaScript imports neither schemas nor Zod.

Use `schema.input<Validator>` for the input type and `schema.output<Validator>` or `schema.infer<Validator>` for validated output. These type helpers accept any Standard Schema V1 provider:

```ts
const postSchema = schema.object({
  title: schema.string(),
  draft: schema.boolean().default(false),
});
type PostInput = schema.input<typeof postSchema>; // draft is optional.
type Post = schema.infer<typeof postSchema>; // draft is boolean.
```

Each entry has a top-level `id`. Keep `id` out of the metadata schema, and use distinct names for source fields, [computed fields](/docs/computed-fields), and [relationships](/docs/relationships).

Choose exactly one of `source` or `loader`. See [sources and loaders](/docs/sources-and-loaders) for input formats.
