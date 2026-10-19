---
title: Sources and loaders
description: Read local Markdown, structured files, or content supplied by a loader.
section: defining-content
order: 11
---

A string `source` recursively scans a Markdown directory. An object source selects a format explicitly:

```ts
source: { type: "json", directory: "./content/authors" }
```

## File formats

Markdown frontmatter becomes metadata, with its body captured separately. JSON, YAML, and TOML sources contain one record per file. Use `file()` for a file containing multiple entries:

```ts
import { file } from "content-query/loaders";

const authors = defineCollection({
  loader: file("./content/authors.json"),
  schema: z.object({ name: z.string() }),
});
```

Here, `defineCollection` and `z` use the imports from [collections and schemas](/docs/collections-and-schemas).

## IDs and custom sources

Built-in paths resolve from the application root. Default IDs derive from relative filenames, with a frontmatter `slug` override and trailing `/index` removal.

ContentQuery also accepts native Astro-compatible content loaders. Custom loaders implement `load(context)` and write entries into `context.store`. See the [collection and loader reference](/docs/reference/collections-and-loaders).
