---
title: Custom payloads
description: Resolve large per-entry data during the build and load it only when a query asks for it.
section: defining-content
order: 14
---

Metadata is what lists, filters, and sorting need. Some entries also carry larger data that only a detail page reads, such as an exercise's hints in each language. Declare that data as a payload. ContentQuery resolves and validates it during preparation, stores each value in its own module, and loads it only when a query requests it.

## Declare a payload

Each payload has a `schema` and a `resolve()` function:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineCollection } from "content-query";
import { glob } from "content-query/loaders";
import { schema } from "content-query/schema";

/** Reads a file beside an exercise's manifest. */
const read = (filePath: string, ...segments: string[]) =>
  readFile(path.join(path.dirname(filePath), ...segments), "utf8");

const coding = defineCollection({
  loader: glob({
    base: "./content/coding",
    pattern: "*/exercise.json",
    generateId: ({ entry }) => entry.split("/")[0]!,
  }),
  schema: schema.object({ title: schema.string(), locales: schema.array(schema.string()) }),
  payloads: {
    detail: {
      schema: schema.object({ hints: schema.string() }),
      variants: { locale: "locales" },
      resolve: async ({ source, variant }) => ({
        hints: await read(source!.filePath, "hints", `${variant.locale}.md`),
      }),
    },
    walkthrough: {
      schema: schema.string(),
      resolve: ({ source }) => read(source!.filePath, "walkthrough.md"),
    },
  },
});
```

A resolver receives the entry's `collection`, `id`, `data` (validated metadata plus [computed fields](/docs/computed-fields)), loader `source` metadata, the `variant` being resolved, `readBody()`, and an abort `signal`. Its result is validated against the payload's schema and must use the same serializable values as metadata.

Payload names cannot start with `_`, which built-in payloads such as `_rendered` use, and cannot repeat a computed field or relationship name.

## Variants

A payload can vary by keys such as a locale. Each key lists its values in one of two ways:

- Name a string-array field of the entry's data, including a computed field, to read values per entry. A missing field means the entry has no values for that key.
- Give a fixed list, such as `["easy", "hard"]`.

ContentQuery resolves every combination of the keys' values. To resolve only some combinations, return them from `combinations()`:

```ts
variants: { locale: "locales", level: ["easy", "hard"] },
combinations: ({ variants }) => variants.locale.map((locale) => ({ locale, level: "easy" })),
```

Derive values that need logic in a computed field, then name that field.

## Request a payload

Request payloads by name. A payload with variants needs every variant key; a payload without variants takes `true`:

```ts
const exercise = await content.query.coding.findFirst({
  where: { id: "two-sum" },
  columns: { title: true },
  payloads: { detail: { locale: "fr-FR" }, walkthrough: true },
});
const hints = exercise?._payloads.detail.hints;

const sameExercise = await content
  .from("coding")
  .select("title")
  .where((fields) => eq(fields.id, "two-sum"))
  .withPayload("detail", { locale: "fr-FR" })
  .withPayload("walkthrough")
  .first();
```

Each request loads only the modules it names, and catalog queries load none. Requesting a combination that an entry lacks, such as `fr-FR` for an exercise with only English hints, rejects with `variant-not-found`. The error's `payload` and `variant` properties name what was missing.

## Types

Payload values and variant keys are inferred from the declaration, so queries check payload names and variant keys. Generated declarations also export `CollectionPayload`:

```ts
import type { CollectionPayload } from "content-query:server";

type Detail = CollectionPayload<"coding", "detail">; // { hints: string }
```

`content-query` exports `PayloadData` and `VariantOf` for helpers that take a collection definition.

## Errors

A resolver failure or schema violation fails preparation. Each diagnostic names the collection, entry, source, `payload`, and `variant`, plus the field `path` for schema issues. The CLI prints them together, for example `coding two-sum <source path> detail[locale=fr-FR] at hints`. See [errors](/docs/reference/errors).

## Development updates

A payload is resolved again when its entry changes. ContentQuery does not yet track other files a resolver reads, such as `hints/fr-FR.md`, so edit the entry or restart development to pick up changes to them.
