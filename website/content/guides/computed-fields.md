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

Resolvers receive the registry key `collection`, entry `id`, validated `data`, optional loader-defined `source` metadata, captured `readBody()` text when available, and cancellation `signal`. They work on one entry; collection-wide calculations belong in application queries.

## Loader-specific source metadata

The loader determines the shape of `source`. Built-in `glob()` and collection `source` shorthand provide `{ filePath }`. Multi-record `file()` also provides `key`, the original object key or array index as a string. Paths are relative to the application root and use forward slashes, such as `content/posts/hello-world.md`. They preserve the original filename even when the entry has a custom ID.

For example, store the source location as queryable metadata:

```ts
computed: {
  sourceFile: {
    schema: z.string().optional(),
    resolve: ({ source }) => source?.filePath,
  },
  entryKey: {
    schema: z.string(),
    resolve: ({ collection, id }) => `${collection}/${id}`,
  },
}
```

For a custom loader, declare its source metadata type once:

```ts
import { defineCollection } from "content-query";
import type { Loader } from "content-query/loaders";
import { z } from "zod";

const cms: Loader<{ documentId: string; url: string }> = {
  name: "my-cms",
  async load({ store }) {
    store.set({
      id: "hello",
      data: { title: "Hello" },
      source: { documentId: "doc-123", url: "https://example.com/hello" },
    });
  },
};

const posts = defineCollection({
  loader: cms,
  schema: z.object({ title: z.string() }),
  computed: {
    canonicalUrl: {
      schema: z.string().optional(),
      resolve: ({ source }) => source?.url,
    },
  },
});
```

`source` is inferred from the loader, while `data` is inferred from the collection schema. Source metadata is optional, so use a presence check or optional chaining. A file path is not a field on this CMS source type. Metadata from untyped loaders remains `unknown` until narrowed.

Optional source metadata is a ContentQuery extension. Existing Astro loaders work unchanged and may omit it; Astro's own store does not retain this extra field. The standard Astro `filePath` entry field remains separate. Loader authors validate external metadata and provide only supported data values. Each resolver receives its own detached metadata copy, and only explicitly computed results enter deployed content.

Metadata-only updates recompute affected entries. As with Astro, an unchanged supplied digest skips a store update; loader digests must therefore include source metadata used by computed fields.

Use [field selection](/docs/querying-content#field-selection) to request a computed field in your query results.
